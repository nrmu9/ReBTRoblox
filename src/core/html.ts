export const htmltemplate = function(pieces: any, ...args: any[]): HTMLTemplateElement {
	if(!Array.isArray(pieces)) { pieces = [pieces] }
	
	const trimWhitespace = s => s.replace(/\b\n\s*\b/g, " ").replace(/\n[^\S ]*/g, "")
	
	let result = trimWhitespace(pieces[0])

	for(let i = 0, len = args.length; i < len; i++) {
		result += `!btr${i}!` + trimWhitespace(pieces[i + 1])
	}
	
	const template = document.createElement("template")
	template.innerHTML = result
	
	const replaceRegex = new RegExp(`!btr(\\d+)!`, "g")
	const replaceFn = (_, i) => args[parseInt(i, 10)]
	
	const replaceInserts = node => {
		if(node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			if(node.attributes) {
				for(const attr of node.attributes) {
					replaceInserts(attr)
				}
			}
			
			for(const child of node.childNodes) {
				replaceInserts(child)
			}
		} else if(node.nodeType === Node.ATTRIBUTE_NODE) {
			if(!node.nodeName.toLowerCase().startsWith("on")) {
				node.nodeValue = node.nodeValue.replace(replaceRegex, replaceFn)
			}
		} else if(node.nodeType === Node.TEXT_NODE) {
			node.nodeValue = node.nodeValue.replace(replaceRegex, replaceFn)
		}
	}
	
	replaceInserts(template.content)
	
	return template
}

export const html = function(...args: any[]): any {
	const template = htmltemplate(args[0], ...args.slice(1))
	
	const elem = template.content.firstElementChild || template.content.firstChild
	if(elem) { elem.remove() }

	return elem
}
