import fs from "fs"

const p = "Z:/T/Agentario/apps/vscode/package.json"
const j = JSON.parse(fs.readFileSync(p, "utf8"))

j.version = "0.14.30"
j.author = { name: "Agentario" }
j.keywords = [...new Set([...(j.keywords || []).filter((k) => k !== "cline"), "agentario"])]

delete j.contributes.icons

if (j.contributes.walkthroughs?.[0]) {
	j.contributes.walkthroughs[0].id = "AgentarioWalkthrough"
}

function walk(o) {
	if (Array.isArray(o)) {
		o.forEach(walk)
		return
	}
	if (!o || typeof o !== "object") return
	for (const [k, v] of Object.entries(o)) {
		if (typeof v === "string") {
			if (v.includes("cline.isGeneratingCommit")) {
				o[k] = v.replaceAll("cline.isGeneratingCommit", "agentario.isGeneratingCommit")
			}
			if (v.includes("$(cline-icon)")) {
				o[k] = v.replaceAll("$(cline-icon)", "$(rocket)")
			}
		} else {
			walk(v)
		}
	}
}

walk(j.contributes)

fs.writeFileSync(p, `${JSON.stringify(j, null, 4)}\n`)
console.log(
	JSON.stringify(
		{
			version: j.version,
			author: j.author,
			walkthrough: j.contributes.walkthroughs?.[0]?.id,
			hasIcons: !!j.contributes.icons,
			clineIconLeft: JSON.stringify(j).includes("cline-icon"),
			clineWhenLeft: JSON.stringify(j).includes("cline.isGeneratingCommit"),
		},
		null,
		2,
	),
)
