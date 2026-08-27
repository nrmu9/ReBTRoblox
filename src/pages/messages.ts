import { html } from "@/core/html"
import { pageInit } from "@/core/page"
import { SETTINGS } from "@/feat/settings"
import { onPageLoad, onPageReset } from "@/pages/common"
import { RobloxApi } from "@/rbx/RobloxApi"
import { query } from "@/core/query"

/**
 * The action bar buttons nest their label a couple of levels down, so write to
 * the node that actually holds the text and leave the structure alone.
 */
const setButtonLabel = (button: HTMLElement, text: string) => {
	let target: HTMLElement = button

	while (target.children.length === 1) {
		const child = target.children[0]
		if (!(child instanceof HTMLElement) || !child.textContent?.trim()) {
			break
		}
		target = child
	}

	target.textContent = text
}

/** The pager labels itself "3 / 18"; the second number is the page count. */
const readTotalPages = (pager: HTMLElement) => {
	for (const node of pager.children) {
		const match = node.textContent?.match(/^\s*\d+\s*\/\s*(\d+)\s*$/)
		if (match) {
			return Number(match[1])
		}
	}

	return 0
}

/** Paging lives in the hash as #!/<tab>?page=N, so keep whichever tab is open. */
const currentTab = () => location.hash.match(/^#!\/([a-z]+)/i)?.[1] ?? "inbox"

class MarkAllAsReadAction {
	[key: string]: any

	constructor() {
		this.messagesPerReadRequest = 20 // more than this errors
		this.threadCount = 5

		this.unreadMessagesTotal = 0
		this.unreadMessagesLeft = 0
		this.unreadMessageIds = []
		this.pagesToCheck = []
		this.totalPages = 0
		this.running = false
	}

	setButtonText(text: string) {
		const elem = query<HTMLElement>(".btr-markAllAsReadInbox")

		if (elem) {
			setButtonLabel(elem, text)
		}
	}

	async markAsRead(messageIds: any[]) {
		if (!messageIds.length) {
			return
		}

		const tryFetch = (): Promise<any> => RobloxApi.privatemessages.markAsRead(messageIds).catch(tryFetch)
		return tryFetch()
	}

	async loadPage(pageNum: number) {
		const tryFetch = (): Promise<any> => RobloxApi.privatemessages.getMessages(pageNum).catch(tryFetch)

		return tryFetch().then(async (json: any) => {
			for (const msg of json.collection) {
				if (!msg.isRead) {
					this.unreadMessageIds.push(msg.id)
					this.unreadMessagesLeft--
				}
			}

			this.setButtonText(
				`${this.totalPages - this.pagesToCheck.length}/${this.totalPages} (${this.unreadMessagesTotal - this.unreadMessagesLeft}/${this.unreadMessagesTotal})`,
			)

			return json
		})
	}

	async initThread() {
		while (this.unreadMessagesLeft > 0 && this.pagesToCheck.length) {
			const pageN = this.pagesToCheck.shift()
			await this.loadPage(pageN)

			if (this.unreadMessageIds.length >= this.messagesPerReadRequest) {
				await this.markAsRead(this.unreadMessageIds.splice(0, this.messagesPerReadRequest))
			}

			await new Promise((resolve) => setTimeout(resolve, 500))
		}
	}

	async execute() {
		if (this.running) {
			return
		}
		this.running = true

		this.setButtonText("Processing...")

		const tryFetch = (): Promise<any> => RobloxApi.privatemessages.getUnreadCount().catch(tryFetch)

		this.unreadMessagesTotal = await tryFetch().then((json: any) => json.count)
		this.unreadMessagesLeft = this.unreadMessagesTotal

		const threads: any[] = []

		if (this.unreadMessagesLeft > 0) {
			const pageData = await this.loadPage(0)
			this.totalPages = pageData.totalPages

			if (this.unreadMessagesLeft > 0) {
				for (let i = 1; i <= this.totalPages; i++) {
					this.pagesToCheck.push(i)
				}

				// Shuffle
				// for(let i = 0; i < this.pagesToCheck.length; i++) {
				// 	const j = Math.floor(Math.random() * (this.pagesToCheck.length + 1))
				// 	const v = this.pagesToCheck[i]

				// 	this.pagesToCheck[i] = this.pagesToCheck[j]
				// 	this.pagesToCheck[j] = v
				// }

				for (let i = 0; i < this.threadCount; i++) {
					threads.push(this.initThread())
				}
			}
		}

		await Promise.all(threads)

		while (this.unreadMessageIds.length) {
			await this.markAsRead(this.unreadMessageIds.splice(0, this.messagesPerReadRequest))
		}

		this.running = false
		this.setButtonText("Mark All As Read")
	}
}

pageInit.messages = () => {
	if (!SETTINGS.get("messages.enabled")) {
		return
	}

	let markAllAsRead: any

	document.$on("click", ".btr-markAllAsReadInbox", () => {
		if (markAllAsRead?.running) {
			return
		}

		markAllAsRead = new MarkAllAsReadAction()
		markAllAsRead.execute().then(() => {
			markAllAsRead = null

			// The inbox is React now, so there is no scope left to digest. A reload
			// is the only way to make the list reflect the read state we just wrote.
			location.reload()
		})
	})

	onPageReset(() => {
		document.body?.classList.remove("btr-messages")
	})

	onPageLoad(() => {
		document.$watch("body", (body: HTMLElement) => body.classList.add("btr-messages"))

		// Roblox rebuilt the inbox in React, so the messages-nav Angular template
		// and the markAsUnread button it hung off are both gone. Anchor to the live
		// action bar instead. Roblox only marks the current page, so marking every
		// page in one go is still worth having.
		//
		// Kept as a named function so the settings listener below can apply it to
		// what is already on screen, rather than waiting for a rerender.
		const applyMarkAllButton = (bar: HTMLElement) => {
			const existing = bar.$find(".btr-markAllAsReadInbox")

			if (!SETTINGS.get("messages.markAllAsRead")) {
				existing?.remove()
				return
			}

			if (existing) {
				return
			}

			// Clone a native button so the styling follows whatever Roblox ships.
			// The clone carries no React fiber, so React ignores clicks on it and
			// the delegated handler above is the only listener.
			const native = bar.$find<HTMLButtonElement>("button")
			if (!native) {
				return
			}

			const button = native.cloneNode(true) as HTMLButtonElement
			button.classList.add("btr-markAllAsReadInbox")
			button.removeAttribute("disabled")
			setButtonLabel(button, "Mark All As Read")

			bar.append(button)
		}

		document.$watchAll(".private-message-action-buttons", applyMarkAllButton, { continuous: true })

		SETTINGS.onChange("messages.markAllAsRead", () => {
			for (const bar of document.querySelectorAll<HTMLElement>(".private-message-action-buttons")) {
				applyMarkAllButton(bar)
			}
		})

		// The pager only steps one page at a time, so put back a way to jump. The
		// React app drives paging off the hash, so setting it is enough; nothing
		// here touches a node React owns.
		const applyPageJump = (pager: HTMLElement) => {
			const existing = pager.$find(".btr-page-jump")

			if (!SETTINGS.get("messages.pageJump")) {
				existing?.remove()
				return
			}

			if (existing) {
				return
			}

			{
				const input = html<HTMLInputElement>`<input class="btr-page-jump" type="text" size="2" />`
				const total = readTotalPages(pager)

				input.placeholder = "→"
				input.title = total ? `Jump to page (1 to ${total})` : "Jump to page"

				input.addEventListener("keydown", (event: KeyboardEvent) => {
					if (event.key !== "Enter") {
						return
					}

					const page = Math.floor(Number(input.value))
					const max = readTotalPages(pager)

					if (!Number.isFinite(page) || page < 1 || (max && page > max)) {
						input.value = ""
						return
					}

					input.value = ""
					location.hash = `#!/${currentTab()}?page=${page}`
				})

				pager.append(input)
			}
		}

		document.$watchAll<HTMLElement>(
			".private-message-page .icon-filled-chevron-large-right-to-line",
			(icon: HTMLElement) => {
				const pager = icon.closest("button")?.parentElement

				if (pager) {
					applyPageJump(pager)
				}
			},
			{ continuous: true },
		)

		SETTINGS.onChange("messages.pageJump", () => {
			for (const icon of document.querySelectorAll(
				".private-message-page .icon-filled-chevron-large-right-to-line",
			)) {
				const pager = icon.closest("button")?.parentElement

				if (pager) {
					applyPageJump(pager)
				}
			}
		})
	})
}
