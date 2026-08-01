import urllib.request, json, os, sys

run_dir = sys.argv[1] if len(sys.argv) > 1 else r'z:\T\Agentario\Exports\lab-run-20260801-065130'
subdir = sys.argv[2] if len(sys.argv) > 2 else ''

target_dir = os.path.join(run_dir, subdir) if subdir else run_dir
os.makedirs(target_dir, exist_ok=True)

def api_get(path):
    resp = urllib.request.urlopen(f'http://localhost:19231{path}')
    return resp.read().decode('utf-8')

def save(name, data):
    path = os.path.join(target_dir, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(data)
    print(f'  Saved {name} ({len(data)} bytes)')

# Messages
save('messages.json', api_get('/api/messages?limit=200'))

# Context
save('context.txt', api_get('/api/context'))

# Status
save('status.json', api_get('/api/status'))

# Chat export
save('chat-export.md', api_get('/api/export_chat'))

# Extension logs
save('extension-logs.txt', api_get('/api/logs?tail=500'))

# Compaction files index
save('compaction-index.json', api_get('/api/compaction_files'))

# Full session collect
collect_result = api_get(f'/api/collect?outDir={target_dir}')
save('collect_result.json', collect_result)

print(f'Done: collected to {target_dir}')
