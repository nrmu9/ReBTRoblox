import { SETTINGS } from "@/feat/settings"

// The order of the top bar and sidebar items, as you set it. Roblox renders
// these lists with react, so its nodes are left where they are and only their
// CSS order changes: all three lists are flex containers. Items are told apart
// by our own markers, or by where they link, which stays the same across
// renders. Anything new keeps its place next to whatever came before it.

export const NAV_LISTS = [
	{ name: "links", label: "Top bar links", selector: "ul.rbx-navbar" },
	{ name: "icons", label: "Top bar icons", selector: "ul.navbar-right" },
	{ name: "sidebar", label: "Sidebar", selector: "#left-navigation-container nav ul" },
] as const

export type NavListName = (typeof NAV_LISTS)[number]["name"]

const linkKey = (href: string) => {
	try {
		const url = new URL(href, location.href)
		// Ids in a path, like your own user id, differ between people and pages.
		const path = url.pathname
			.toLowerCase()
			.split("/")
			.filter((part) => part && !/^\d+$/.test(part))
			.join("/")

		return `${url.hostname === "www.roblox.com" ? "" : url.hostname}/${path}`
	} catch {
		return null
	}
}

/** What an item is, the same across renders: our marker, its link, its id, or its class. */
const keyOf = (item: Element): string => {
	const marker = [...item.classList].find((name) => name.startsWith("btr-nav-node-"))

	if (marker) {
		return `btr:${marker.slice(13)}`
	}

	const href = item.querySelector("a[href]")?.getAttribute("href")
	const link = href && !href.startsWith("#") ? linkKey(href) : null

	if (link) {
		return `link:${link}`
	}

	if (item.id) {
		return `id:${item.id}`
	}

	const name = [...item.classList].find((name) => !name.startsWith("btr-"))
	return name ? `class:${name}` : `text:${(item.textContent ?? "").trim().toLowerCase().slice(0, 40)}`
}

/** Keys for a list's items in page order, made unique where two items look alike. */
const keysOf = (items: Element[]) => {
	const seen = new Map<string, number>()

	return items.map((item) => {
		const key = keyOf(item)
		const count = seen.get(key) ?? 0
		seen.set(key, count + 1)
		return count ? `${key}#${count}` : key
	})
}

export const readOrder = (): Partial<Record<NavListName, string[]>> => {
	try {
		const order = JSON.parse(SETTINGS.get("navigation.order") || "{}")
		return order instanceof Object && !Array.isArray(order) ? order : {}
	} catch {
		return {}
	}
}

export const saveOrder = (list: NavListName, keys: string[] | null) => {
	const order = readOrder()

	if (keys) {
		order[list] = keys
	} else {
		delete order[list]
	}

	SETTINGS.set("navigation.order", Object.keys(order).length ? JSON.stringify(order) : "")
}

/**
 * Keys in the order the items show before any of this: some already carry an
 * order of their own, like the Home link we add, which puts it first.
 */
const naturalKeys = (items: HTMLElement[], keys: string[]) =>
	items
		.map((item, i) => ({
			key: keys[i],
			i,
			order: Number(item.dataset.btrOrigOrder ?? item.style.order) || 0,
		}))
		.toSorted((a, b) => a.order - b.order || a.i - b.i)
		.map(({ key }) => key)

/**
 * The saved order with anything it does not know put back after the item it
 * follows on the page, or first if nothing does.
 */
const merge = (saved: string[], keys: string[]) => {
	const result = saved.filter((key) => keys.includes(key))

	keys.forEach((key, i) => {
		if (result.includes(key)) {
			return
		}

		let at = 0

		for (let j = i - 1; j >= 0; j--) {
			const index = result.indexOf(keys[j])

			if (index !== -1) {
				at = index + 1
				break
			}
		}

		result.splice(at, 0, key)
	})

	return result
}

/** A list's items with their keys, in the order they show. */
export const currentItems = (list: NavListName) => {
	const selector = NAV_LISTS.find((entry) => entry.name === list)!.selector
	// The copy on screen, where the top bar has one for each screen width.
	const found = [...document.querySelectorAll<HTMLElement>(selector)]
	const container = found.find((element) => element.offsetParent !== null) ?? found[0]

	if (!container) {
		return null
	}

	const items = [...container.children] as HTMLElement[]
	const keys = keysOf(items)
	const order = merge(readOrder()[list] ?? [], naturalKeys(items, keys))

	return order.map((key) => ({ key, item: items[keys.indexOf(key)] }))
}

const apply = (list: NavListName, container: Element) => {
	const items = [...container.children] as HTMLElement[]
	const saved = readOrder()[list]

	if (!saved?.length) {
		// Back to how it was, including an order we had set before this did.
		for (const item of items) {
			if ("btrOrigOrder" in item.dataset) {
				item.style.order = item.dataset.btrOrigOrder ?? ""
				delete item.dataset.btrOrigOrder
			}
		}

		return
	}

	const keys = keysOf(items)
	const order = merge(saved, naturalKeys(items, keys))

	items.forEach((item, i) => {
		if (!("btrOrigOrder" in item.dataset)) {
			item.dataset.btrOrigOrder = item.style.order
		}

		item.style.order = String(order.indexOf(keys[i]))
	})
}

export const initNavOrder = () => {
	// Every copy of a list: the top bar has one for wide screens and one for narrow.
	const containers: Array<[NavListName, Element]> = []

	const applyAll = () => {
		for (const [list, container] of containers) {
			if (container.isConnected) {
				apply(list, container)
			}
		}
	}

	for (const { name, selector } of NAV_LISTS) {
		document.$watchAll(selector, (container: Element) => {
			containers.push([name, container])
			apply(name, container)

			// React adds and swaps items, and fills in or changes their links after
			// they go in, and our own markers come later too, so any of those
			// places them again. Only these: our own writes are to style.
			new MutationObserver(() => apply(name, container)).observe(container, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["href", "class"],
			})
		})
	}

	SETTINGS.onChange("navigation.order", applyAll)
}
