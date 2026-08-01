path = r'z:\T\Agentario\apps\vscode\src\sdk\SdkController.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add getProviderScale method after getProviderConfigStore
old = '''	getProviderConfigStore(): ProviderConfigStore {
		return this.providerConfigStore
	}'''
new = '''	getProviderConfigStore(): ProviderConfigStore {
		return this.providerConfigStore
	}

	/** EMA scale: provider tokensIn / char-estimate. Delegates to MessageTranslatorState. */
	getProviderScale(): number {
		return this.messageTranslatorState.getProviderScale()
	}'''
content = content.replace(old, new)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
