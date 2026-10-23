"use strict"

// Writes the GitHub release notes for a tag: the commits since the last
// release, grouped by kind, each linked, followed by GitHub's own generated
// part, which credits pull requests and new contributors and links the full
// changelog. Commits that change nothing for users (tests, docs, builds and
// dev tooling) are left out.
//
//   node dev/releaseNotes.js v4.5.0 > notes.md
//
// The generated part needs gh signed in, or GH_TOKEN in CI. Without it only
// the changelog link is added.

const { execFileSync } = require("node:child_process")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")

const GROUPS = [
	["feat", "Features"],
	["fix", "Fixes"],
	["perf", "Performance"],
]

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()

const tag = process.argv[2] || `v${require(path.join(ROOT, "package.json")).version}`

let previous = null
try {
	previous = git("describe", "--tags", "--abbrev=0", `${tag}^`)
} catch {}

const repo =
	process.env.GITHUB_REPOSITORY ||
	git("remote", "get-url", "origin")
		.replace(/^.*github\.com[:/]/, "")
		.replace(/\.git$/, "")

const commits = git(
	"log",
	previous ? `${previous}..${tag}` : tag,
	"--no-merges",
	"--reverse",
	"--format=%H%x1f%s",
)
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const [sha, subject] = line.split("\x1f")
		const match = subject.match(/^(\w+)(?:\(([^)]*)\))?!?: (.+)$/)
		return { sha, type: match?.[1], scope: match?.[2], text: match?.[3] ?? subject }
	})

const out = []

for (const [type, label] of GROUPS) {
	const items = commits.filter((commit) => commit.type === type && commit.scope !== "dev")

	if (items.length) {
		out.push(`## ${label}`, "")

		for (const { sha, scope, text } of items) {
			const link = `[\`${sha.slice(0, 7)}\`](https://github.com/${repo}/commit/${sha})`
			out.push(`* ${scope ? `**${scope}:** ` : ""}${text} (${link})`)
		}

		out.push("")
	}
}

let generated = previous ? `**Full Changelog**: https://github.com/${repo}/compare/${previous}...${tag}` : ""

try {
	generated = execFileSync(
		"gh",
		[
			"api",
			"-X",
			"POST",
			`repos/${repo}/releases/generate-notes`,
			"-f",
			`tag_name=${tag}`,
			...(previous ? ["-f", `previous_tag_name=${previous}`] : []),
			"--jq",
			".body",
		],
		{ cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	).trim()
} catch {}

out.push(generated, "")
process.stdout.write(out.join("\n"))
