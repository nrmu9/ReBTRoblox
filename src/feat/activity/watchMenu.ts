import { onList, setOnList } from "@/feat/activity/lists"

// "Watch activity" in the ... menu on someone's profile, among Roblox's own
// entries, so watching someone does not need their activity open first.

/** Adds the entry to the profile menu of `userId` each time it opens. */
export const addWatchMenuItem = (userId: number): void => {
	// The menu is a portal react draws on demand, told apart by its links to
	// this person's pages, whose labels are translated but whose addresses are not.
	document.$watchAll(
		`.foundation-web-menu:has(a[role=menuitem][href="/users/${userId}/inventory"])`,
		(menu: HTMLElement) => {
			const template = menu.$find<HTMLElement>("button[role=menuitem]")
			const links = menu.$findAll("a[role=menuitem]")
			const after = links[links.length - 1]

			if (!template || !after || menu.$find(".btr-watch-menu-item")) {
				return
			}

			// A copy of Roblox's own entry keeps its look.
			const item = template.cloneNode(true) as HTMLElement
			item.classList.add("btr-watch-menu-item")
			item.removeAttribute("data-radix-collection-item")

			const title = item.$find(".foundation-web-menu-item-title")
			if (title) {
				title.textContent = onList("watched", userId) ? "Stop watching" : "Watch activity"
			}

			item.$on("click", () => {
				setOnList("watched", userId, !onList("watched", userId))
				// The menu only closes itself for its own entries. A tick later, as
				// the item would no longer reach this handler once detached.
				setTimeout(() =>
					menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
				)
			})

			after.after(item)
		},
	)
}
