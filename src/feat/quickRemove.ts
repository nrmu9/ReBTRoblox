import { backgroundScript } from "@/core/messaging"
import { html } from "@/core/html"
import { RobloxApi } from "@/rbx/RobloxApi"
import { waitForRobloxResponse } from "@/feat/robloxResponses"

// A ... menu on your own friends, following and communities to unfriend,
// unfollow or leave from the list, asking first in place. The button and menu
// are built from Roblox's own Foundation classes, the way its top bar menu is.

const ICON_BUTTON =
	"relative clip group/interactable focus-visible:outline-focus cursor-pointer flex items-center justify-center padding-none stroke-none select-none size-800 radius-circle bg-none"
const STATE_LAYER =
	"absolute inset-[0] transition-colors group-hover/interactable:bg-[var(--color-state-hover)] group-active/interactable:bg-[var(--color-state-press)]"
const MENU =
	"foundation-web-menu bg-surface-100 stroke-standard stroke-default shadow-transient-high radius-large"
const MENU_ITEM =
	"relative clip group/interactable focus-visible:outline-focus foundation-web-menu-item flex items-center text-truncate-split cursor-pointer stroke-none bg-none text-align-x-left width-full text-body-large padding-x-large padding-y-medium gap-x-large radius-medium"

interface Removal {
	/** Unfriend, Unfollow, Leave community: the menu item. */
	item: string
	/** Unfriend, Unfollow, Leave: the action's name, on its buttons. */
	verb: string
	/** Unfriended, Unfollowed, Left: what the card says once done. */
	done: string
	/** Read when asked, as the card can show a placeholder until names load. */
	name: () => string
	run: () => Promise<boolean>
}

/** Keeps clicks inside `element` from reaching the card, which can be a link. */
const contain = (element: HTMLElement) =>
	element.$on("click", (event: MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
	})

/**
 * Adds the ... button to `host`, which holds the card. Its menu has the one
 * action; picking it covers the card with the question and two buttons.
 * Escape or a click elsewhere backs out of either.
 */
const addButton = (host: HTMLElement, removal: Removal) => {
	host.classList.add("btr-quick-host")

	const button = html<HTMLButtonElement>`<button
		type="button"
		class="${ICON_BUTTON} btr-quick-remove"
		aria-label="More"
		aria-haspopup="menu"
		aria-expanded="false"
	>
		<div aria-hidden="true" class="${STATE_LAYER}"></div>
		<span
			class="icon icon-regular-three-dots-horizontal size-500 content-emphasis"
			aria-hidden="true"
		></span>
	</button>`

	let open: HTMLElement | null = null

	const dismiss = () => {
		open?.remove()
		open = null
		button.setAttribute("aria-expanded", "false")
		document.removeEventListener("pointerdown", outside, true)
		document.removeEventListener("keydown", escape, true)
	}

	const outside = (ev: Event) => {
		if (open && !open.contains(ev.target as Node) && !button.contains(ev.target as Node)) {
			dismiss()
		}
	}

	const escape = (ev: KeyboardEvent) => {
		if (ev.key === "Escape") {
			dismiss()
			button.focus()
		}
	}

	const show = (element: HTMLElement) => {
		dismiss()
		open = element
		host.append(element)
		document.addEventListener("pointerdown", outside, true)
		document.addEventListener("keydown", escape, true)
	}

	const ask = () => {
		const confirm = html`<div class="btr-quick-confirm" role="group">
			<span class="btr-quick-question"></span>
			<div class="btr-quick-actions">
				<button type="button" class="btr-quick-yes">${removal.verb}</button>
				<button type="button" class="btr-quick-no">Cancel</button>
			</div>
		</div>`

		contain(confirm)

		confirm.$req(".btr-quick-question").textContent = `${removal.verb} ${removal.name()}?`
		confirm.setAttribute("aria-label", `${removal.verb} ${removal.name()}?`)

		const yes = confirm.$req<HTMLButtonElement>(".btr-quick-yes")
		const no = confirm.$req<HTMLButtonElement>(".btr-quick-no")

		no.$on("click", () => {
			dismiss()
			button.focus()
		})

		yes.$on("click", async () => {
			yes.disabled = no.disabled = true
			yes.textContent = "..."

			const ok = await removal.run().catch(() => false)

			if (ok) {
				dismiss()
				button.remove()
				host.classList.add("btr-quick-removed")
				host.append(html`<span class="btr-quick-done">${removal.done}</span>`)
			} else {
				confirm.$req(".btr-quick-question").textContent = `Couldn't ${removal.verb.toLowerCase()}`
				yes.textContent = "Retry"
				yes.disabled = no.disabled = false
			}
		})

		show(confirm)
		yes.focus()
	}

	button.$on("click", (ev: MouseEvent) => {
		ev.preventDefault()
		ev.stopPropagation()

		if (open) {
			dismiss()
			return
		}

		const menu = html`<div role="menu" class="${MENU} btr-quick-menu">
			<div role="group" class="padding-small">
				<button type="button" role="menuitem" class="${MENU_ITEM}">
					<div aria-hidden="true" class="${STATE_LAYER}"></div>
					<span class="foundation-web-menu-item-title text-no-wrap content-system-alert"></span>
				</button>
			</div>
		</div>`

		contain(menu)

		const item = menu.$req<HTMLButtonElement>("[role=menuitem]")
		item.$req(".foundation-web-menu-item-title").textContent = removal.item
		item.$on("click", ask)

		show(menu)
		button.setAttribute("aria-expanded", "true")
		item.focus()
	})

	host.append(button)
}

/**
 * Buttons on your own friends list: unfriend on its Friends tab, unfollow on
 * Following. Other tabs and other people's lists get none.
 */
export const addFriendListButtons = (ownUserId: number): void => {
	const tab = (): "friends" | "following" | null => {
		// Your list is /users/friends, or your own id in the address.
		const listOf = location.pathname.match(/^\/users\/(\d+)\/friends/)?.[1]

		if (listOf && Number(listOf) !== ownUserId) {
			return null
		}

		if (!location.hash || /^#!\/friends(\/|$)/.test(location.hash)) {
			return "friends"
		}

		return /^#!\/following(\/|$)/.test(location.hash) ? "following" : null
	}

	const addTo = (card: HTMLElement) => {
		const userId = Number(card.id)
		const box = card.$find<HTMLElement>(".avatar-card-container")
		const current = tab()

		if (!current || !Number.isSafeInteger(userId) || userId <= 0 || !box) {
			return
		}

		if (box.$find(":scope > .btr-quick-remove")) {
			return
		}

		const name = () => card.$find(".avatar-name")?.textContent?.trim() || "them"

		addButton(
			box,
			current === "friends"
				? {
						item: "Unfriend",
						verb: "Unfriend",
						done: "Unfriended",
						name,
						run: () => {
							backgroundScript.send("ownFriendAction", userId, "unfriend")
							return RobloxApi.friends.unfriend(userId)
						},
					}
				: {
						item: "Unfollow",
						verb: "Unfollow",
						done: "Unfollowed",
						name,
						run: () => RobloxApi.friends.unfollow(userId),
					},
		)
	}

	const cards = ".avatar-cards > li.avatar-card"

	// The tabs share their cards, so a tab change takes the buttons off and
	// gives the cards the new tab's.
	const retab = () => {
		for (const element of document.querySelectorAll(
			".avatar-card .btr-quick-remove, .avatar-card .btr-quick-menu, .avatar-card .btr-quick-confirm",
		)) {
			element.remove()
		}

		for (const card of document.querySelectorAll<HTMLElement>(cards)) {
			addTo(card)
		}
	}

	window.addEventListener("hashchange", retab)
	window.addEventListener("popstate", retab)
	document.$watchAll(cards, addTo)
}

/** Leave buttons on the communities list, for ones you are in and do not own. */
export const addLeaveButtons = (userId: number): void => {
	// Roblox asks for your communities for this list, and that answer says
	// which you are in, so the buttons never go on someone else's list.
	const url = `https://groups.roblox.com/v1/users/${userId}/groups/roles`
	const memberOf = waitForRobloxResponse((responseUrl) => responseUrl.includes(url))
		.then((json) => json ?? fetch(url, { credentials: "include" }).then((res) => res.json()))
		.then(
			(json) =>
				new Map<number, number>(
					(json?.data ?? []).map((entry: any) => [entry.group?.id, entry.role?.rank ?? 0]),
				),
		)
		.catch(() => new Map<number, number>())

	// The rows share one wrapper, so the button goes in the row's own link.
	document.$watchAll("a.groups-list-item", async (item: HTMLAnchorElement) => {
		const groupId = Number(item.getAttribute("href")?.match(/\/communities\/(\d+)/)?.[1])

		if (!Number.isSafeInteger(groupId) || item.$find(":scope > .btr-quick-remove")) {
			return
		}

		const rank = (await memberOf).get(groupId)

		// Owners cannot leave, they have to hand the community over first.
		if (
			rank === undefined ||
			rank >= 255 ||
			item.$find("[data-testid='groups-list-item-owned-marker']")
		) {
			return
		}

		addButton(item, {
			item: "Leave community",
			verb: "Leave",
			done: "Left",
			name: () => item.$find(".text-title-medium")?.textContent?.trim() || "this community",
			run: () => RobloxApi.groups.leave(groupId, userId),
		})
	})
}
