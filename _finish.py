import urllib.request, json, os

RUN_DIR = r'z:\T\Agentario\Exports\lab-run-20260801-072536'
BASE = 'http://localhost:19231'

def api_get(path):
    resp = urllib.request.urlopen(f'{BASE}{path}', timeout=30)
    return resp.read().decode('utf-8')

def api_json(path):
    return json.loads(api_get(path))

def save(name, data, subdir=''):
    d = os.path.join(RUN_DIR, subdir) if subdir else RUN_DIR
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name)
    if isinstance(data, str):
        with open(path, 'w', encoding='utf-8') as f:
            f.write(data)
    else:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    print(f'  Saved {name}')

# Collect full compact data
save('messages.json', api_json('/api/messages?limit=200'), 'compact-full')
save('context.txt', api_get('/api/context'), 'compact-full')
save('status.json', api_json('/api/status'), 'compact-full')
save('chat-export.md', api_get('/api/export_chat'), 'compact-full')
save('extension-logs.txt', api_get('/api/logs?tail=500'), 'compact-full')
save('compaction-index.json', api_json('/api/compaction_files'), 'compact-full')
collect_r = api_json('/api/collect?outDir=' + os.path.join(RUN_DIR, 'compact-full'))
save('collect_result.json', collect_r, 'compact-full')
print('Collection #3 done')

# Save final status
save('final-status.json', api_json('/api/status'))

# Close chat
req = urllib.request.Request(f'{BASE}/api/clear', data=b'{}', headers={'Content-Type': 'application/json'})
urllib.request.urlopen(req)
print('Chat closed')

# Verify home
st = api_json('/api/status')
print(f'Home: taskId={st.get("taskId")} busy={st.get("busy")}')
