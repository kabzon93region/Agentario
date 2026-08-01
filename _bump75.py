import json

# Update package.json version
path = r'z:\T\Agentario\apps\vscode\package.json'
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
data['version'] = '0.14.75'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('package.json bumped to 0.14.75')
