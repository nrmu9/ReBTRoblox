import { watch, waitFor } from "@/core/hook"

const results: { name: string, pass: boolean, detail: string }[] = []
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail })
const tick = () => new Promise(r => setTimeout(r, 10))

const add = (cls: string, hidden = false) => {
	const el = document.createElement("div")
	el.className = cls
	if(hidden) { el.style.display = "none" }
	document.body.append(el)
	return el
}

const report = (extra = "") => {
	const lines = results.map(r => (r.pass ? "PASS " : "FAIL ") + r.name + (r.detail ? " (" + r.detail + ")" : ""))
	const out = document.createElement("pre")
	out.id = "results"
	out.textContent = lines.join("\n") + extra
	document.body.append(out)
	document.title = extra ? "ERROR" : results.every(r => r.pass) ? "ALL PASS" : "SOME FAIL"
}

const run = async () => {
	add("t-existing")
	let hits = 0
	watch(".t-existing", () => hits++)
	check("detects pre-existing element", hits === 1, "hits=" + hits)

	let dyn = 0
	watch(".t-dyn", () => dyn++)
	add("t-dyn")
	await tick()
	check("detects inserted visible element", dyn === 1, "hits=" + dyn)

	let hidden = 0
	watch(".t-hidden", () => hidden++)
	add("t-hidden", true)
	await tick()
	check("detects display:none element via fallback", hidden === 1, "hits=" + hidden)

	let dup = 0
	watch(".t-dup", () => dup++)
	add("t-dup")
	await tick()
	await tick()
	check("no duplicate delivery", dup === 1, "hits=" + dup)

	let once = 0
	watch(".t-once", () => once++, { once: true })
	add("t-once")
	add("t-once")
	await tick()
	check("once fires exactly once", once === 1, "hits=" + once)

	let after = 0
	const stop = watch(".t-stop", () => after++)
	stop()
	add("t-stop")
	await tick()
	check("dispose stops delivery", after === 0, "hits=" + after)

	try {
		const pending = waitFor(".t-wait", { timeout: 2000 })
		setTimeout(() => add("t-wait"), 50)
		await pending
		check("waitFor resolves", true)
	} catch(err) {
		check("waitFor resolves", false, String(err))
	}

	try {
		await waitFor(".t-never", { timeout: 100 })
		check("waitFor times out", false, "resolved unexpectedly")
	} catch(err) {
		check("waitFor times out", true)
	}

	const sheetEl = document.querySelector("style[data-btr-hook]") as HTMLStyleElement
	const sheet = sheetEl.sheet as CSSStyleSheet
	const before = sheet.cssRules.length
	const stop2 = watch(".t-rules", () => {})
	const during = sheet.cssRules.length
	stop2()
	const restored = sheet.cssRules.length
	check("css rules added and removed", during === before + 2 && restored === before, before + "/" + during + "/" + restored)

	report()
}

run().catch(err => report("\nTHREW: " + String((err && err.stack) || err)))
