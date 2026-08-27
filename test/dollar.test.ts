import { installExtensions } from "@/core/extend"
import { find, findAll } from "@/core/query"
import { on, off } from "@/core/events"

installExtensions()

const results: { name: string; pass: boolean; detail: string }[] = []
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail })
const tick = () => new Promise((r) => setTimeout(r, 20))

const frag = (html: string): HTMLElement => {
	const box = document.createElement("div")
	box.innerHTML = html
	document.body.append(box)
	return box
}

const run = async () => {
	// --- query ---
	const box = frag(
		`<ul class="list"><li class="a">1</li><li class="b">2<span class="deep">x</span></li></ul>`,
	)

	check("$find returns first match", box.$find(".a")?.textContent === "1")
	check("$findAll returns all", box.$findAll("li").length === 2)
	check("$find returns null when absent", box.$find(".nope") === null)

	// > means direct child, via :scope
	const list = box.$find(".list")!
	check("leading > scopes to direct children", list.$findAll(">li").length === 2)
	check("leading > excludes descendants", list.$findAll(">span").length === 0)
	check("comma selectors scope each branch", list.$findAll(">li, >span").length === 2)
	check("module find matches prototype", find(box, ".a") === box.$find(".a"))
	check("module findAll matches prototype", findAll(box, "li").length === box.$findAll("li").length)

	// --- direct events ---
	const btn = frag(`<button id="btn">go</button>`).$find("#btn")!
	let direct = 0
	const handler = () => direct++
	btn.$on("click", handler)
	btn.dispatchEvent(new Event("click", { bubbles: true }))
	check("$on direct handler fires", direct === 1, "hits=" + direct)

	btn.$off("click", handler)
	btn.dispatchEvent(new Event("click", { bubbles: true }))
	check("$off removes direct handler", direct === 1, "hits=" + direct)

	// --- delegation ---
	const root = frag(`<div id="root"><p class="item">a</p></div>`).$find("#root")!
	let delegated = 0
	let seenTarget: Element | null = null
	root.$on("click", ".item", (ev: Event) => {
		delegated++
		seenTarget = ev.currentTarget as Element
	})

	root.$find(".item")!.dispatchEvent(new Event("click", { bubbles: true }))
	check("delegated handler fires", delegated === 1, "hits=" + delegated)
	check("currentTarget is the matched node", (seenTarget as any)?.className === "item")

	// delegation covers nodes added later
	const added = document.createElement("p")
	added.className = "item"
	root.append(added)
	added.dispatchEvent(new Event("click", { bubbles: true }))
	check("delegation covers later nodes", delegated === 2, "hits=" + delegated)

	// --- bubbling through ancestors + stopPropagation ---
	const nest = frag(`<div id="nest" class="lvl"><div class="lvl"><b class="leaf">x</b></div></div>`).$find(
		"#nest",
	)!
	const order: number[] = []
	nest.$on("click", ".lvl", function (this: any, ev: Event) {
		order.push((ev.currentTarget as Element).className === "lvl" ? order.length : -1)
	})
	nest.$find(".leaf")!.dispatchEvent(new Event("click", { bubbles: true }))
	check("walks up through matching ancestors", order.length === 2, "levels=" + order.length)

	const stopNest = frag(
		`<div id="stop" class="lvl"><div class="lvl"><b class="leaf">x</b></div></div>`,
	).$find("#stop")!
	let stopCount = 0
	stopNest.$on("click", ".lvl", (ev: Event) => {
		stopCount++
		ev.stopPropagation()
	})
	stopNest.$find(".leaf")!.dispatchEvent(new Event("click", { bubbles: true }))
	check("stopPropagation halts the walk", stopCount === 1, "hits=" + stopCount)

	// --- once ---
	const onceEl = frag(`<div id="once"><i class="t">x</i></div>`).$find("#once")!
	let onceHits = 0
	onceEl.$on("click", ".t", () => onceHits++, { once: true })
	onceEl.$find(".t")!.dispatchEvent(new Event("click", { bubbles: true }))
	onceEl.$find(".t")!.dispatchEvent(new Event("click", { bubbles: true }))
	check("once fires a single time", onceHits === 1, "hits=" + onceHits)

	// --- $watch ---
	const host = frag(`<div id="host"></div>`).$find("#host")!
	let watched: Element | null = null
	host.$watch(".late", (el: Element) => {
		watched = el
	})
	const late = document.createElement("span")
	late.className = "late"
	host.append(late)
	await tick()
	check("$watch resolves for later nodes", watched === late)

	// --- $watch chaining ---
	const chain = frag(`<div id="chain"></div>`).$find("#chain")!
	let chained: Element | null = null
	chain
		.$watch("#outer")
		.$then()
		.$watch(".inner", (el: Element) => {
			chained = el
		})
	const outer = document.createElement("div")
	outer.id = "outer"
	chain.append(outer)
	await tick()
	const inner = document.createElement("div")
	inner.className = "inner"
	outer.append(inner)
	await tick()
	check("$watch().$then().$watch() chains", chained === inner)

	// --- $watchAll ---
	const many = frag(`<div id="many"></div>`).$find("#many")!
	let seen = 0
	many.$watchAll(".row", () => seen++)
	for (let i = 0; i < 3; i++) {
		const row = document.createElement("div")
		row.className = "row"
		many.append(row)
	}
	await tick()
	check("$watchAll fires per element", seen === 3, "hits=" + seen)

	// --- $onRemove ---
	const doomed = frag(`<div id="doomed"></div>`).$find("#doomed")!
	let removed = false
	doomed.$onRemove(() => {
		removed = true
	})
	doomed.remove()
	await tick()
	check("$onRemove fires on detach", removed)

	// --- Date extensions ---
	const d = new Date(2020, 0, 2, 3, 4, 5)
	check("$format renders tokens", d.$format("YYYY-MM-DD") === "2020-01-02", d.$format("YYYY-MM-DD"))
	check("$since reports elapsed", /ago|Just now/.test(new Date().$since()), new Date().$since())

	// --- module on/off parity ---
	const parity = frag(`<div id="parity"></div>`).$find("#parity")!
	let parityHits = 0
	const pf = () => parityHits++
	on(parity, "click", pf)
	parity.dispatchEvent(new Event("click"))
	off(parity, "click", pf)
	parity.dispatchEvent(new Event("click"))
	check("module on/off parity", parityHits === 1, "hits=" + parityHits)

	// Regression: delivery is synchronous when the element already exists, which
	// previously hit a TDZ on the disposer and the timeout handle.
	const pre = frag(`<div id="pre"><b class="already">x</b></div>`).$find("#pre")!
	let syncHit: Element | null = null
	pre.$watch(".already", (el: Element) => {
		syncHit = el
	})
	await tick()
	check("$watch delivers for nodes that already exist", syncHit !== null)

	let syncChain = false
	pre.$watch(".already").$then(() => {
		syncChain = true
	})
	await tick()
	check("$watch chain resolves for existing nodes", syncChain)

	// Regression: > scoped selectors must not reach querySelectorAll unscoped.
	const scoped = frag(`<div id="sc"><i class="kid">a</i><span><i class="kid">b</i></span></div>`).$find(
		"#sc",
	)!
	let scopedHits = 0
	scoped.$watch(">.kid", () => {
		scopedHits++
	})
	await tick()
	check("$watch handles > scoped selectors", scopedHits === 1, "hits=" + scopedHits)

	let lateScoped = 0
	scoped.$watchAll(">.late", () => {
		lateScoped++
	})
	const lateKid = document.createElement("i")
	lateKid.className = "late"
	scoped.append(lateKid)
	await tick()
	check("$watchAll handles > scoped selectors", lateScoped === 1, "hits=" + lateScoped)

	// Regression: the continuous path delivers synchronously for existing nodes,
	// and the callback receives its own stop function. Both hit a TDZ before.
	const cont = frag(`<div id="cont"><u class="pre">a</u><u class="pre">b</u></div>`).$find("#cont")!
	let contHits = 0
	let stopFn: any = null
	cont.$watchAll(".pre", (el: Element, stop: any) => {
		contHits++
		stopFn = stop
	})
	check("$watchAll delivers for existing nodes", contHits === 2, "hits=" + contHits)
	check("$watchAll passes a usable stop", typeof stopFn === "function")

	// calling the provided stop must halt further delivery
	let stopped = 0
	cont.$watchAll(".later", (el: Element, stop: any) => {
		stopped++
		stop()
	})
	for (let i = 0; i < 3; i++) {
		const u = document.createElement("u")
		u.className = "later"
		cont.append(u)
	}
	await tick()
	check("stop halts continuous delivery", stopped === 1, "hits=" + stopped)

	report()
}

const report = (extra = "") => {
	const lines = results.map(
		(r) => (r.pass ? "PASS " : "FAIL ") + r.name + (r.detail ? " (" + r.detail + ")" : ""),
	)
	const out = document.createElement("pre")
	out.id = "results"
	out.textContent = lines.join("\n") + extra
	document.body.append(out)
	const failed = results.filter((r) => !r.pass).length
	document.title = extra ? "ERROR" : failed ? failed + " FAIL" : "ALL PASS"
}

run().catch((err) => report("\nTHREW: " + String((err && err.stack) || err)))
