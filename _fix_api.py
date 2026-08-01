path = r'z:\T\Agentario\apps\vscode\src\dev\agentario-api-server.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update token calculations to use providerScale
old = '''		const ctxBeforeChars = (ctxBefore && ctxBefore.messages) ? JSON.stringify(ctxBefore.messages).length : 0
		const ctxBeforeTokens = ctxBeforeChars ? estimateTokens(ctxBeforeChars) : 0'''
new = '''		const ctxBeforeChars = (ctxBefore && ctxBefore.messages) ? JSON.stringify(ctxBefore.messages).length : 0
		const providerScale = controller.getProviderScale?.() ?? 1
		const ctxBeforeTokens = ctxBeforeChars ? Math.round(estimateTokens(ctxBeforeChars) * providerScale) : 0'''
content = content.replace(old, new)

old2 = '''		const ctxAfterChars = (ctxAfter && ctxAfter.messages) ? JSON.stringify(ctxAfter.messages).length : 0
		const ctxAfterTokens = ctxAfterChars ? estimateTokens(ctxAfterChars) : 0'''
new2 = '''		const ctxAfterChars = (ctxAfter && ctxAfter.messages) ? JSON.stringify(ctxAfter.messages).length : 0
		const ctxAfterTokens = ctxAfterChars ? Math.round(estimateTokens(ctxAfterChars) * providerScale) : 0'''
content = content.replace(old2, new2)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
