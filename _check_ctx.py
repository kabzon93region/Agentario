import urllib.request, json

resp = urllib.request.urlopen('http://localhost:19231/api/context')
ctx = json.loads(resp.read())
msgs = ctx.get('messages', [])
print(f'Context messages: {len(msgs)}')
for m in msgs:
    role = m.get('role', '')
    content = m.get('content', [])
    for c in content:
        if isinstance(c, dict) and c.get('type') == 'text':
            text = c.get('text', '')[:150]
            print(f'  [{role}] {text}')
