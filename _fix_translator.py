import sys

path = r'z:\T\Agentario\apps\vscode\src\sdk\message-translator.ts'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and update first call site (context budget notice, around line 1660)
for i, line in enumerate(lines):
    if 'const budget = parseContextBudgetMetadata(event.metadata)' in line and i > 1600:
        indent = line[:len(line) - len(line.lstrip())]
        lines.insert(i+1, f"{indent}const ps = typeof event.metadata.providerScale === 'number' ? event.metadata.providerScale : undefined\n")
        break

# Find and update the first setPendingContextBudget(budget) call after line 1660
for i, line in enumerate(lines):
    if 'state.setPendingContextBudget(budget)' in line and i > 1650:
        lines[i] = line.replace('state.setPendingContextBudget(budget)', 'state.setPendingContextBudget(budget, ps)')
        break

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Done')
