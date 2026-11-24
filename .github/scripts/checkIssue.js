"use strict"

// Reads the version from a bug report and, when it is older than the latest
// release, says so on the issue and labels it. Editing the issue runs it again:
// the comment is updated in place, and both go once the version is current.
//
// Runs from .github/workflows/issues.yml. The issue body comes in through the
// environment, never the command line, as anyone can write it.
//
//   DRY_RUN=1 ISSUE_BODY="..." LATEST=4.7.3 node .github/scripts/checkIssue.js

const MARKER = "<!-- rebtroblox-issue-check -->"
const LABEL = "outdated version"

const { ISSUE_BODY = "", ISSUE_NUMBER, REPO, GH_TOKEN, DRY_RUN, LATEST } = process.env

/** The text under a form heading, up to the next one. */
const section = (body, heading) => {
	const lines = body.replace(/\r/g, "").split("\n")
	const start = lines.findIndex((line) => line.trim() === `### ${heading}`)

	if (start === -1) {
		return null
	}

	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => line.startsWith("### "))
	return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim()
}

const parseVersion = (text) => {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
	return match ? match.slice(1, 4).map(Number) : null
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

const api = async (method, path, body) => {
	const res = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${GH_TOKEN}`,
			"x-github-api-version": "2022-11-28",
			...(body ? { "content-type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	})

	if (!res.ok && res.status !== 404 && res.status !== 422) {
		throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
	}

	return res.status === 204 || !res.ok ? null : res.json()
}

/** What to say about the version, or null when there is nothing to say. */
const verdict = (reported, latest) => {
	const version = parseVersion(reported)

	if (!version) {
		// Only echoed back when it is plainly a short version-ish string.
		const shown = /^[\w .-]{1,20}$/.test(reported) ? ` from "${reported}"` : ""
		return {
			outdated: false,
			text: `I couldn't read a version${shown}. It should look like ${latest.join(".")}. You can find it at the top of the ReBTRoblox settings.`,
		}
	}

	if (compare(version, latest) < 0) {
		return {
			outdated: true,
			text: [
				`Thanks for the report. You're on ${version.join(".")}, but the latest version is ${latest.join(".")}. It might already fix this.`,
				"",
				"Firefox usually updates within a day. Chrome can take a few more days because of the store review. Once you have the latest version, please check again and update the version in your report.",
			].join("\n"),
		}
	}

	return null
}

const main = async () => {
	const reported = section(ISSUE_BODY, "ReBTRoblox version")

	if (reported === null) {
		console.log("not a bug report form, nothing to check")
		return
	}

	const latest = parseVersion(
		LATEST ?? (await api("GET", `/repos/${REPO}/releases/latest`))?.tag_name ?? "",
	)

	if (!latest) {
		console.log("no latest release to compare with")
		return
	}

	const result = verdict(reported, latest)
	console.log(`reported "${reported}", latest ${latest.join(".")}: ${result ? result.text : "fine"}`)

	if (DRY_RUN) {
		return
	}

	const issue = `/repos/${REPO}/issues/${ISSUE_NUMBER}`
	const comments = (await api("GET", `${issue}/comments?per_page=100`)) ?? []
	const ours = comments.find((comment) => comment.user?.type === "Bot" && comment.body?.includes(MARKER))

	if (result) {
		const body = `${result.text}\n\n<sub>Checked automatically.</sub>\n${MARKER}`

		if (ours) {
			await api("PATCH", `/repos/${REPO}/issues/comments/${ours.id}`, { body })
		} else {
			await api("POST", `${issue}/comments`, { body })
		}
	} else if (ours) {
		await api("DELETE", `/repos/${REPO}/issues/comments/${ours.id}`)
	}

	if (result?.outdated) {
		// Made the first time it is needed. A 422 means it exists already.
		await api("POST", `/repos/${REPO}/labels`, {
			name: LABEL,
			color: "fbca04",
			description: "Reported on an older version than the latest release",
		})
		await api("POST", `${issue}/labels`, { labels: [LABEL] })
	} else {
		await api("DELETE", `${issue}/labels/${encodeURIComponent(LABEL)}`)
	}
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
