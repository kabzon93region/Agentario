#!python
"""
Приведение окончаний строк к CRLF (Windows) для текстовых файлов проекта.

Сканирует репозиторий и перезаписывает файлы с расширениями программ, скриптов,
конфигов и логов, приводя \\n к \\r\\n. Пропускает .git, venv, __pycache__, бинарники.

Оптимизации:
  - os.walk вместо sorted rglob (без сбора всех путей в память)
  - ThreadPoolExecutor для параллельного I/O (по умолчанию 8 воркеров)
  - Быстрый byte-level check: файлы уже в CRLF пропускаются без decode
  - mtime-кэх (.crlf_cache.json): тёплый прогон проверяет только изменённые файлы
  - Прогрессбар: спиннер при сканировании, бар при обработке

Запуск из корня проекта:
  python scripts/normalize_line_endings_crlf.py
  python scripts/normalize_line_endings_crlf.py --dry-run
  python scripts/normalize_line_endings_crlf.py --workers 16
  python scripts/normalize_line_endings_crlf.py --no-cache   # игнорировать кэх
  python scripts/normalize_line_endings_crlf.py --no-bar     # без прогрессбара
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Корень проекта (скрипт в scripts/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Файл кэша mtime
CACHE_FILE = ".crlf_cache.json"

# Расширения текстовых файлов для нормализации
TEXT_EXTENSIONS = {
    ".py", ".cmd", ".bat", ".ps1", ".sh",
    ".yaml", ".yml", ".json", ".md", ".txt", ".log",
    ".html", ".css", ".js", ".ts", ".proto",
    ".xml", ".ini", ".cfg", ".conf", ".env.example",
}

# Каталоги, которые не сканируем
SKIP_DIRS = {
    ".git", "venv", ".venv", "env", "__pycache__", ".mypy_cache",
    "node_modules", ".tox", "dist", "build", "SDK",
}

# Максимальный размер файла (5 MiB)
MAX_FILE_SIZE = 5 * 1024 * 1024

# Символы спиннера
_SPINNER = "|/-\\"
_CLEAR_LINE = "\r\033[K"


def _enable_ansi_windows() -> None:
    """Включает ANSI escape-коды в Windows консоли."""
    if sys.platform == "win32":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
        except Exception:
            pass


def _should_skip_dir(name: str) -> bool:
    if name in SKIP_DIRS:
        return True
    if name.startswith(".") and name != ".env.example":
        return True
    if name.endswith(".egg-info"):
        return True
    return False


def _is_already_crlf(raw: bytes) -> bool:
    """
    Быстрая проверка на байтовом уровне:
    файл уже CRLF, если после удаления \\r\\n не остаётся \\n или \\r.
    """
    stripped = raw.replace(b"\r\n", b"")
    return b"\n" not in stripped and b"\r" not in stripped


def _normalize_file(path: Path, dry_run: bool) -> bool:
    """
    Нормализует один файл. Возвращает True если файл был изменён.
    """
    try:
        stat = path.stat()
    except OSError:
        return False

    # Пропуск пустых и слишком больших
    if stat.st_size == 0 or stat.st_size > MAX_FILE_SIZE:
        return False

    try:
        raw = path.read_bytes()
    except OSError:
        return False

    # Пропуск бинарников (нулевые байты)
    if b"\0" in raw:
        return False

    # Быстрый пропуск — файл уже CRLF
    if _is_already_crlf(raw):
        return False

    # Декодируем
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("cp1251")
        except UnicodeDecodeError:
            return False

    new_text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")
    if new_text == text:
        return False

    if not dry_run:
        path.write_text(new_text, encoding="utf-8", newline="")
    return True


def _collect_files_with_mtime(root: Path) -> list[tuple[Path, float]]:
    """
    Сбор файлов + mtime за один проход os.walk.
    Возвращает [(path, mtime), ...].
    """
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not _should_skip_dir(d)]
        dirnames.sort()

        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in TEXT_EXTENSIONS:
                continue
            full = Path(dirpath) / fname
            try:
                mtime = os.path.getmtime(full)
            except OSError:
                continue
            files.append((full, mtime))
    return files


def _load_cache(root: Path) -> dict[str, float]:
    """Загружает mtime-кэх из .crlf_cache.json."""
    cache_path = root / CACHE_FILE
    if not cache_path.exists():
        return {}
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        return data.get("mtimes", {})
    except (OSError, json.JSONDecodeError, KeyError):
        return {}


def _save_cache(root: Path, mtimes: dict[str, float]) -> None:
    """Сохраняет mtime-кэх в .crlf_cache.json."""
    cache_path = root / CACHE_FILE
    try:
        cache_path.write_text(
            json.dumps({"mtimes": mtimes}, indent=None, separators=(",", ":")),
            encoding="utf-8",
        )
    except OSError:
        pass


class ProgressBar:
    """
    Прогрессбар с перезаписью строки через \\r.
    Поддерживает два режима:
      - spinner: вращающийся символ + счётчик (для сканирования)
      - bar: полоса прогресса с процентами (для обработки)
    """

    def __init__(self, enabled: bool = True, file=None):
        self.enabled = enabled
        self._file = file or sys.stderr
        self._lock = threading.Lock()
        self._spinner_idx = 0
        self._last_len = 0

    def _write(self, text: str) -> None:
        if not self.enabled:
            return
        with self._lock:
            # Дополняем пробелами чтобы затереть остатки предыдущей строки
            pad = max(0, self._last_len - len(text))
            self._file.write(_CLEAR_LINE + text + " " * pad)
            self._file.flush()
            self._last_len = len(text)

    def spinner(self, found: int, elapsed: float) -> None:
        """Спиннер при сканировании: [|] Найдено файлов: 1234 (2.1s)"""
        ch = _SPINNER[self._spinner_idx % len(_SPINNER)]
        self._spinner_idx += 1
        self._write(f"[{ch}] Найдено файлов: {found} ({elapsed:.1f}s)")

    def bar(self, done: int, total: int, changed: int, elapsed: float) -> None:
        """Полоса прогресса: [################....] 50.0% | 3000/6000 | +3 CRLF (5.2s)"""
        if total == 0:
            return
        pct = done / total
        width = 30
        filled = int(width * pct)
        bar_str = "#" * filled + "." * (width - filled)
        self._write(
            f"[{bar_str}] {pct * 100:5.1f}% "
            f"| {done}/{total} "
            f"| +{changed} CRLF "
            f"({elapsed:.1f}s)"
        )

    def finish_line(self) -> None:
        """Завершает строку переносом."""
        if self.enabled:
            self._file.write("\n")
            self._file.flush()
            self._last_len = 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Приведение окончаний строк к CRLF (Windows)")
    parser.add_argument("--dry-run", action="store_true", help="Только показать файлы, не менять")
    parser.add_argument("--root", default=None, help="Корень для сканирования (по умолчанию корень проекта)")
    parser.add_argument("-q", "--quiet", action="store_true", help="Минимум вывода (только итог)")
    parser.add_argument("-w", "--workers", type=int, default=8, help="Потоков для параллельного I/O (по умолчанию 8)")
    parser.add_argument("--no-cache", action="store_true", help="Игнорировать mtime-кэх, проверить все файлы")
    parser.add_argument("--no-bar", action="store_true", help="Без прогрессбара (простой вывод)")
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else PROJECT_ROOT
    if not root.is_dir():
        print(f"Каталог не найден: {root}", file=sys.stderr)
        return 1

    _enable_ansi_windows()

    use_bar = not args.no_bar and not args.quiet and sys.stderr.isatty()
    bar = ProgressBar(enabled=use_bar)

    print(f"Корень сканирования: {root}")
    print(f"Расширения: {', '.join(sorted(TEXT_EXTENSIONS))}")
    print(f"Потоков: {args.workers}")

    # Загружаем mtime-кэх
    cache = {} if args.no_cache else _load_cache(root)
    use_cache = bool(cache) and not args.no_cache
    if use_cache:
        print(f"Кэх загружен: {len(cache)} записей")

    # === Этап 1: Сканирование (спиннер) ===
    if use_bar:
        bar._write("[>] Сканирование файлов...")
    else:
        print("Сканирование файлов...", flush=True)

    t0 = time.time()

    # Запускаем спиннер в отдельном потоке пока os.walk работает
    scan_done = threading.Event()

    def _scan_spinner():
        idx = 0
        while not scan_done.is_set():
            ch = _SPINNER[idx % len(_SPINNER)]
            idx += 1
            elapsed = time.time() - t0
            bar._write(f"[{ch}] Сканирование... ({elapsed:.1f}s)")
            scan_done.wait(0.1)

    if use_bar:
        spinner_thread = threading.Thread(target=_scan_spinner, daemon=True)
        spinner_thread.start()

    all_files = _collect_files_with_mtime(root)
    t_scan = time.time() - t0
    scan_done.set()

    if use_bar:
        bar._write(f"[OK] Найдено файлов: {len(all_files)} ({t_scan:.1f}s)")
        bar.finish_line()
    else:
        print(f"Найдено файлов: {len(all_files)} ({t_scan:.1f}s)", flush=True)

    if not all_files:
        print("Нет файлов для проверки.")
        return 0

    # Фильтруем по mtime-кэху
    if use_cache:
        files_to_check = []
        skipped_cached = 0
        for p, mtime in all_files:
            rel = str(p.relative_to(root))
            cached_mtime = cache.get(rel)
            if cached_mtime is not None and abs(cached_mtime - mtime) < 0.001:
                skipped_cached += 1
            else:
                files_to_check.append(p)
        print(f"Пропуск по кэху: {skipped_cached}, к проверке: {len(files_to_check)}")
    else:
        files_to_check = [p for p, _ in all_files]

    if not files_to_check:
        print("Все файлы уже нормализованы (кэх актуален).")
        return 0

    # === Этап 2: Обработка файлов (прогрессбар) ===
    if use_bar:
        bar._write(f"[>] Обработка {len(files_to_check)} файлов...")
        bar.finish_line()

    changed = []
    checked = 0
    lock = threading.Lock()
    t0 = time.time()

    def _process(path: Path) -> tuple[bool, Path | None]:
        try:
            if _normalize_file(path, args.dry_run):
                return True, path
        except Exception as e:
            print(f"\nОшибка {path}: {e}", file=sys.stderr)
        return False, None

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_process, p): p for p in files_to_check}
        for future in as_completed(futures):
            ok, path = future.result()
            with lock:
                checked += 1
                if ok and path is not None:
                    changed.append(path)
                # Обновляем бар каждые 50 файлов или при изменении
                if use_bar:
                    if checked % 50 == 0 or ok:
                        bar.bar(checked, len(files_to_check), len(changed), time.time() - t0)
                elif not args.quiet and checked % 100 == 0:
                    pct = checked / len(files_to_check) * 100
                    print(f"  {checked}/{len(files_to_check)} ({pct:.0f}%)", flush=True)

    t_write = time.time() - t0

    # Финальное состояние бара
    if use_bar:
        bar.bar(len(files_to_check), len(files_to_check), len(changed), t_write)
        bar.finish_line()

    # Обновляем mtime-кэх после успешного прохода
    if not args.dry_run:
        new_cache = {str(p.relative_to(root)): mtime for p, mtime in all_files}
        _save_cache(root, new_cache)

    print()
    if args.dry_run:
        print("Режим --dry-run: файлы не изменялись.")
    print(f"Проверено файлов: {checked} ({t_write:.1f}s)")
    print(f"Приведено к CRLF: {len(changed)}")
    if changed:
        changed.sort()
        if args.quiet or len(changed) <= 30:
            for p in changed:
                try:
                    print(f"  {p.relative_to(root)}")
                except ValueError:
                    print(f"  {p}")
        else:
            print("Список изменённых файлов см. выше по выводу.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
