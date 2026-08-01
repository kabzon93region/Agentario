import urllib.request, json

req = urllib.request.Request('http://localhost:19231/api/clear', data=b'{}', headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req)
result = json.loads(resp.read().decode('utf-8'))
print(json.dumps(result, indent=2, ensure_ascii=False))

resp2 = urllib.request.urlopen('http://localhost:19231/api/status')
status = json.loads(resp2.read().decode('utf-8'))
tid = status.get('taskId')
idle = status.get('idle')
busy = status.get('busy')
print(f'After clear: taskId={tid} idle={idle} busy={busy}')
