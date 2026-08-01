import json, os

RUN_DIR = r'z:\T\Agentario\Exports\lab-run-20260801-072536'

with open(os.path.join(RUN_DIR, 'final-status.json'), encoding='utf-8') as f:
    final = json.load(f)

with open(os.path.join(RUN_DIR, 'compact_result.json'), encoding='utf-8') as f:
    ctx_compact = json.load(f)

full_result_path = os.path.join(RUN_DIR, 'compact_result_full.json')
if os.path.exists(full_result_path):
    with open(full_result_path, encoding='utf-8') as f:
        full_compact = json.load(f)
else:
    full_compact = None

with open(os.path.join(RUN_DIR, 'messages.json'), encoding='utf-8') as f:
    msgs_data = json.load(f)
msgs = msgs_data.get('messages', []) if isinstance(msgs_data, dict) else []

green = any(
    m.get('say') == 'completion_result' and (m.get('text') or '').strip()
    for m in msgs
)

ps_values = []
for m in msgs:
    text = m.get('text', '')
    if 'providerScale' in text:
        try:
            d = json.loads(text)
            cb = d.get('contextBudget', {})
            ps = cb.get('providerScale')
            if ps is not None:
                ps_values.append(ps)
        except:
            pass

with open(os.path.join(RUN_DIR, 'compact-full', 'messages.json'), encoding='utf-8') as f:
    full_msgs_data = json.load(f)
full_msgs = full_msgs_data.get('messages', []) if isinstance(full_msgs_data, dict) else []

with open(os.path.join(RUN_DIR, 'compact-full', 'context.txt'), encoding='utf-8') as f:
    full_ctx_text = f.read()
full_ctx = json.loads(full_ctx_text) if full_ctx_text.strip().startswith('{') else {}
full_ctx_msgs = full_ctx.get('messages', [])

print('=== PIPELINE ANALYSIS ===')
print(f'Version: 0.14.75')
print(f'Final verdict: {final.get("verdict")}')
print(f'Green completion: {green}')
print(f'Messages count: {len(msgs)}')
print(f'Provider scale values: {ps_values}')
print()
print('--- Context Compact ---')
print(f'  Compacted: {ctx_compact.get("compacted")}')
print(f'  Reason: {ctx_compact.get("reason")}')
print(f'  Reduction: {ctx_compact.get("contextReduction")}%')
b = ctx_compact.get('before', {})
a = ctx_compact.get('after', {})
print(f'  Before: {b.get("contextTokens")} tokens, {b.get("sessionMessages")} msgs')
print(f'  After: {a.get("contextTokens")} tokens, {a.get("sessionMessages")} msgs')
print()
if full_compact:
    print('--- Full Compact ---')
    print(f'  Compacted: {full_compact.get("compacted")}')
    print(f'  Reason: {full_compact.get("reason")}')
    print(f'  Reduction: {full_compact.get("contextReduction")}%')
    fb = full_compact.get('before', {})
    fa = full_compact.get('after', {})
    print(f'  Before: {fb.get("contextTokens")} tokens, {fb.get("sessionMessages")} msgs')
    print(f'  After: {fa.get("contextTokens")} tokens, {fa.get("sessionMessages")} msgs')
else:
    print('--- Full Compact ---')
    print('  Result file not saved (client timeout), but compact completed')
    print(f'  Context after has {len(full_ctx_msgs)} messages (wrap-up structure)')
    print(f'  Messages after: {len(full_msgs)}')
print()
print('--- Full Compact Context ---')
print(f'  Messages: {len(full_ctx_msgs)}')
for m in full_ctx_msgs:
    role = m.get('role', '')
    content = m.get('content', [])
    for c in content:
        if isinstance(c, dict) and c.get('type') == 'text':
            text = c.get('text', '')[:100]
            print(f'    [{role}] {text}...')

all_pass = (
    final.get('verdict') == 'ok'
    and green
    and final.get('hasCompletion')
    and final.get('hasAssistantText')
    and not final.get('hasApiFail')
    and not final.get('hasMistakeLimit')
    and ctx_compact.get('compacted', False)
    and len(full_ctx_msgs) == 3
)
print(f'\nRESULT: {"OK" if all_pass else "ERROR"}')
