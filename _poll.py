import urllib.request, json, time, os

run_dir = r'z:\T\Agentario\Exports\lab-run-20260801-065130'
snap_dir = os.path.join(run_dir, 'snapshots')
os.makedirs(snap_dir, exist_ok=True)
start = time.time()
timeout = 600
poll_interval = 15
last_msg_count = 0
snapshot_idx = 0

while True:
    elapsed = time.time() - start
    if elapsed > timeout:
        print('TIMEOUT')
        break

    resp = urllib.request.urlopen('http://localhost:19231/api/status')
    status = json.loads(resp.read().decode('utf-8'))

    msg_count = status.get('messageCount', 0)
    phase = status.get('phase', '')
    busy = status.get('busy', False)
    idle = status.get('idle', True)
    verdict = status.get('verdict', '')

    print(f'[{int(elapsed)}s] phase={phase} busy={busy} idle={idle} msgs={msg_count} verdict={verdict}')

    # Save snapshot on message count change
    if msg_count != last_msg_count and msg_count > 0:
        last_msg_count = msg_count
        snapshot_idx += 1
        with open(os.path.join(snap_dir, f'status-{snapshot_idx}.json'), 'w', encoding='utf-8') as f:
            json.dump(status, f, ensure_ascii=False, indent=2)
        try:
            msgs_resp = urllib.request.urlopen('http://localhost:19231/api/messages?limit=200')
            msgs_data = msgs_resp.read().decode('utf-8')
            with open(os.path.join(snap_dir, f'messages-{snapshot_idx}.json'), 'w', encoding='utf-8') as f:
                f.write(msgs_data)
        except Exception as e:
            print(f'  snapshot save error: {e}')

    # Check idle conditions
    if (idle and not busy and phase not in ('streaming', 'awaiting_approval') and msg_count >= 3 and elapsed > 30):
        print(f'First idle at {int(elapsed)}s, confirming in 5s...')
        time.sleep(5)
        resp2 = urllib.request.urlopen('http://localhost:19231/api/status')
        status2 = json.loads(resp2.read().decode('utf-8'))
        v2 = status2.get('verdict', '')
        if status2.get('idle') and not status2.get('busy') and status2.get('messageCount', 0) >= 3:
            print(f'IDLE CONFIRMED: verdict={v2}')
            with open(os.path.join(run_dir, 'final-status.json'), 'w', encoding='utf-8') as f:
                json.dump(status2, f, ensure_ascii=False, indent=2)
            break
        else:
            print(f'  Re-check failed: idle={status2.get("idle")} busy={status2.get("busy")} msgs={status2.get("messageCount")}')

    time.sleep(poll_interval)
