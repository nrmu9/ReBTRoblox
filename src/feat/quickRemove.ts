import { html } from "@/core/html"
import { RobloxApi } from "@/rbx/RobloxApi"
import { waitForRobloxResponse } from "@/feat/robloxResponses"

// A button on your own friends and communities to unfriend or leave from the
// list, asking first in place. It shows on hover or focus.

const ICONS = {
	unfriend: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M16 11h6",
	leave: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h11",
}

const icon = (path: string) =>
	html`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
		<path
			d="${path}"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>`

interface Removal {
	/** Unfriend, Leave: the action's name, on its buttons. */
	verb: string
	/** Unfriended, Left: what the card says once done. */
	done: string
	/** Read when asked, as the card can show a placeholder until names load. */
	name: () => string
	icon: string
	run: () => Promise<boolean>
}

/**
 * Adds the button to `host`, which holds the card. Asking covers the card
 * with the question and two buttons; Escape or a click elsewhere backs out.
 */
const addButton = (host: HTMLElement, removal: Removal) => {
	host.classList.add("btr-quick-host")

	const button = html<HTMLButtonElement>`<button
		type="button"
		class="btr-quick-remove"
		aria-label="${removal.verb}"
		title="${removal.verb}"
	></button>`
	button.append(icon(removal.icon))

	const label = () => button.setAttribute("aria-label", `${removal.verb} ${removal.name()}`)
	button.addEventListener("focus", label)
	button.addEventListener("pointerenter", label)

	let confirm: HTMLElement | null = null

	const close = () => {
		confirm?.remove()
		confirm = null
		document.removeEventListener("pointerdown", outside, true)
		document.removeEventListener("keydown", escape, true)
	}

	const outside = (ev: Event) => {
		if (confirm && !confirm.contains(ev.target as Node)) {
			close()
		}
	}

	const escape = (ev: KeyboardEvent) => {
		if (ev.key === "Escape") {
			close()
			button.focus()
		}
	}

	button.$on("click", (ev: MouseEvent) => {
		ev.preventDefault()
		ev.stopPropagation()

		confirm = html`<div class="btr-quick-confirm" role="group">
			<span class="btr-quick-question"></span>
			<div class="btr-quick-actions">
				<button type="button" class="btr-quick-yes">${removal.verb}</button>
				<button type="button" class="btr-quick-no">Cancel</button>
			</div>
		</div>`

		// In a community row the card is a link, which clicks here must not follow.
		confirm.$on("click", (event: MouseEvent) => {
			event.preventDefault()
			event.stopPropagation()
		})

		confirm.$req(".btr-quick-question").textContent = `${removal.verb} ${removal.name()}?`
		confirm.setAttribute("aria-label", `${removal.verb} ${removal.name()}?`)

		const yes = confirm.$req<HTMLButtonElement>(".btr-quick-yes")
		const no = confirm.$req<HTMLButtonElement>(".btr-quick-no")

		no.$on("click", (event: MouseEvent) => {
			event.preventDefault()
			close()
			button.focus()
		})

		yes.$on("click", async (event: MouseEvent) => {
			event.preventDefault()
			yes.disabled = no.disabled = true
			yes.textContent = "..."

			const ok = await removal.run().catch(() => false)

			if (ok) {
				close()
				button.remove()
				host.classList.add("btr-quick-removed")
				host.append(html`<span class="btr-quick-done">${removal.done}</span>`)
			} else {
				confirm!.$req(".btr-quick-question").textContent = `Couldn't ${removal.verb.toLowerCase()}`
				yes.textContent = "Retry"
				yes.disabled = no.disabled = false
			}
		})

		host.append(confirm)
		yes.focus()
		document.addEventListener("pointerdown", outside, true)
		document.addEventListener("keydown", escape, true)
	})

	host.append(button)
}

/** Unfriend buttons on your own friends list, on its Friends tab only. */
export const addUnfriendButtons = (ownUserId: number): void => {
	// Your list is /users/friends, or your own id in the address.
	const onFriendsTab = () => {
		const listOf = location.pathname.match(/^\/users\/(\d+)\/friends/)?.[1]

		return (
			(!listOf || Number(listOf) === ownUserId) &&
			(!location.hash || /^#!\/friends(\/|$)/.test(location.hash))
		)
	}

	// The tabs share their cards, so the buttons go when another tab or list opens.
	const tidy = () => {
		if (!onFriendsTab()) {
			for (const button of document.querySelectorAll(".avatar-card .btr-quick-remove")) {
				button.remove()
			}
		}
	}

	window.addEventListener("hashchange", tidy)
	window.addEventListener("popstate", tidy)

	document.$watchAll(".avatar-cards > li.avatar-card", (card: HTMLElement) => {
		const userId = Number(card.id)
		const box = card.$find<HTMLElement>(".avatar-card-container")

		if (!onFriendsTab() || !Number.isSafeInteger(userId) || userId <= 0 || !box) {
			return
		}

		if (box.$find(":scope > .btr-quick-remove")) {
			return
		}

		addButton(box, {
			verb: "Unfriend",
			done: "Unfriended",
			name: () => card.$find(".avatar-name")?.textContent?.trim() || "them",
			icon: ICONS.unfriend,
			run: () => RobloxApi.friends.unfriend(userId),
		})
	})
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
			verb: "Leave",
			done: "Left",
			name: () => item.$find(".text-title-medium")?.textContent?.trim() || "this community",
			icon: ICONS.leave,
			run: () => RobloxApi.groups.leave(groupId, userId),
		})
	})
}
