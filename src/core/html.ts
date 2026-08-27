import { assert } from "@/core/util"

/**
 * Builds a detached <template> from a tagged literal.
 *
 * Interpolated values never reach the html parser. Each one is replaced by a
 * `!btrN!` marker first, the markup is parsed with only those markers in it,
 * and the values are substituted afterwards by walking the parsed tree and
 * writing them into text nodes and attribute values, where they stay data. So
 * a value cannot introduce an element or an attribute however it is written,
 * and the innerHTML below only ever sees literals from this codebase.
 *
 * AMO's scanner flags that assignment as an unsafe innerHTML anyway, since it
 * cannot see where the string came from.
 */
export const htmltemplate = function (
	pieces: TemplateStringsArray | string,
	...args: unknown[]
): HTMLTemplateElement {
	const parts: readonly string[] = typeof pieces === "string" ? [pieces] : pieces

	const trimWhitespace = (s: string) => s.replace(/\b\n\s*\b/g, " ").replace(/\n[^\S ]*/g, "")

	let result = trimWhitespace(parts[0])

	for (let i = 0, len = args.length; i < len; i++) {
		result += `!btr${i}!` + trimWhitespace(parts[i + 1])
	}

	const template = document.createElement("template")
	template.innerHTML = result

	const replaceRegex = new RegExp(`!btr(\\d+)!`, "g")
	const replaceFn = (_: string, i: string) => String(args[parseInt(i, 10)])

	const replaceInserts = (node: Node) => {
		if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			if (node instanceof Element) {
				for (const attr of node.attributes) {
					replaceInserts(attr)
				}
			}

			for (const child of node.childNodes) {
				replaceInserts(child)
			}
		} else if (node.nodeType === Node.ATTRIBUTE_NODE) {
			if (!node.nodeName.toLowerCase().startsWith("on")) {
				node.nodeValue = node.nodeValue?.replace(replaceRegex, replaceFn) ?? null
			}
		} else if (node.nodeType === Node.TEXT_NODE) {
			node.nodeValue = node.nodeValue?.replace(replaceRegex, replaceFn) ?? null
		}
	}

	replaceInserts(template.content)

	return template
}

/**
 * Builds a node from markup. Every call site in this codebase produces an
 * element, so an empty template is a programming error rather than a value
 * every caller has to guard.
 */
export const html = function <T extends Element = HTMLElement>(
	pieces: TemplateStringsArray | string,
	...args: unknown[]
): T {
	const template = htmltemplate(pieces, ...args)
	const elem = template.content.firstElementChild ?? template.content.firstChild

	assert(elem, "html template produced no node")
	elem.remove()

	return elem as unknown as T
}
