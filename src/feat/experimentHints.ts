/**
 * Reads Roblox's own scripts for how each experiment parameter is used, so the
 * editor can offer real choices: whether the site reads a parameter at all,
 * whether it treats it as an on/off flag, and the values it compares it
 * against, including every member of an enum it falls back to. They are
 * suggestions, read from minified code, and only gathered on demand.
 */
export interface ExperimentHint {
	/** Some loaded script reads it. */
	used: boolean
	/** Compared to true or false, or negated. */
	flag: boolean
	/** Values as JSON text, the form the editor saves them in. */
	values: string[]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// A literal in minified code: a string, a number, or !0 and !1 for booleans.
const LITERAL = String.raw`("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|!0|!1)`
const COMPARE = String.raw`(?:===|!==|==|!=)`

const AFTER_COMPARE = new RegExp(String.raw`^\s*${COMPARE}\s*${LITERAL}`)
const BEFORE_COMPARE = new RegExp(String.raw`${LITERAL}\s*${COMPARE}\s*[\w$.()]*$`)
const BEFORE_FLAG = /(?:!0\s*===?\s*|!!)[\w$.()]*$/
const AFTER_FLAG = /^\s*===?\s*!0/
// A fallback when the value is missing: (t = x.key) ? t : Enum.member, or ??.
const AFTER_ENUM = /^\)?\s*(?:\?\s*[\w$]+\s*:|\?\?)\s*([\w$]+)\.([\w$]+)/

const toJson = (literal: string): string | null => {
	if (literal === "!0") {
		return "true"
	}

	if (literal === "!1") {
		return "false"
	}

	try {
		return JSON.stringify(JSON.parse(literal))
	} catch {
		return null
	}
}

/** Members of a minified enum: Name=((h=Name||{}).a="a",h.b="b",h). */
const enumMembers = (text: string, name: string): string[] => {
	const head = new RegExp(String.raw`[,;\s(]${escape(name)}=\(\(([\w$]+)=${escape(name)}\|\|\{\}\)`).exec(
		text,
	)

	if (!head) {
		return []
	}

	const body = text.slice(head.index, head.index + 4000)
	// The first member hangs off the parenthesis, (h=Name||{}).a="a", the rest off h.
	const member = new RegExp(String.raw`(?:${escape(head[1])}|\))\.[\w$]+=("(?:[^"\\]|\\.)*"|-?\d+)`, "g")
	const values: string[] = []

	for (let match = member.exec(body); match; match = member.exec(body)) {
		const value = toJson(match[1])

		if (value) {
			values.push(value)
		}

		// The enum ends where the comma chain does.
		if (body[member.lastIndex] !== ",") {
			break
		}
	}

	return values
}

const scripts = new Map<string, Promise<string>>()

/**
 * Every Roblox script the page has loaded, each read once from the cache. The
 * list is taken again on every call, as Roblox keeps loading scripts after the
 * page has, and the first call can come while it still is.
 */
const loadSources = async () => {
	if (document.readyState !== "complete") {
		await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }))
	}

	// The timing log stops at 250 entries, which Roblox pages pass, so the
	// script tags count too.
	const urls = [
		...performance.getEntriesByType("resource").map((entry) => entry.name),
		...[...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((script) => script.src),
	].filter((url) => /\.js(?:\?|$)/.test(url) && /\.rbxcdn\.com\//.test(url))

	for (const url of urls) {
		if (!scripts.has(url)) {
			scripts.set(
				url,
				fetch(url).then(
					(res) => (res.ok ? res.text() : ""),
					() => "",
				),
			)
		}
	}

	return Promise.all(scripts.values())
}

export const discoverExperimentHints = async (keys: string[]): Promise<Record<string, ExperimentHint>> => {
	const texts = await loadSources()
	const hints: Record<string, ExperimentHint> = {}

	for (const key of new Set(keys)) {
		const hint: ExperimentHint = { used: false, flag: false, values: [] }
		const values = new Set<string>()
		const access = new RegExp(String.raw`\.${escape(key)}(?![\w$])|["']${escape(key)}["']`, "g")

		for (const text of texts) {
			if (!text.includes(key)) {
				continue
			}

			access.lastIndex = 0

			for (let match = access.exec(text); match; match = access.exec(text)) {
				hint.used = true

				const end = match.index + match[0].length
				const before = text.slice(Math.max(0, match.index - 80), match.index)
				const after = text.slice(end, end + 120)

				if (BEFORE_FLAG.test(before) || AFTER_FLAG.test(after)) {
					hint.flag = true
				}

				const literal = AFTER_COMPARE.exec(after)?.[1] ?? BEFORE_COMPARE.exec(before)?.[1]
				const value = literal ? toJson(literal) : null

				if (value) {
					values.add(value)
				}

				const fallback = AFTER_ENUM.exec(after)

				if (fallback) {
					for (const member of enumMembers(text, fallback[1])) {
						values.add(member)
					}
				}
			}
		}

		if ([...values].every((value) => value === "true" || value === "false")) {
			hint.flag ||= values.size > 0
		}

		hint.values = [...values]
		hints[key] = hint
	}

	return hints
}
