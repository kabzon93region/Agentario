path = r'z:\T\Agentario\apps\vscode\src\sdk\SdkController.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add getProviderScale to SdkCompactionCoordinator constructor
old = '''			createTempHost: async () => {
				const host = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
				return { host, dispose: () => host.dispose("compactHistoryTask") }
			},
		})'''
new = '''			createTempHost: async () => {
				const host = await VscodeSessionHost.create({ mcpHub: this.mcpHub })
				return { host, dispose: () => host.dispose("compactHistoryTask") }
			},
			getProviderScale: () => this.messageTranslatorState.getProviderScale(),
		})'''
content = content.replace(old, new)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
