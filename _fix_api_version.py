path = r'z:\T\Agentario\apps\vscode\src\dev\agentario-api-server.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('const VERSION = "0.14.74"', 'const VERSION = "0.14.75"')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('API version updated to 0.14.75')
