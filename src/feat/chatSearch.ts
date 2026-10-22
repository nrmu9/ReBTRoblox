import { delay } from "@/core/util"
import { html } from "@/core/html"
import { clockFormat } from "@/feat/clock"
import { injectScript } from "@/core/messaging"

// Search in a chat's history, from a button in its header. Roblox's chat has
// none, so this pages back through the conversation the way its own scrolling
// does, 20 messages a request, and keeps what it read for the next search.
// The look is Roblox's own chat classes, so it follows its theme.

interface ChatMessage {
	id: string
	content: string
	sender_user_id: number
	created_at: string
	type: string
	is_deleted?: boolean
}

interface History {
	messages: ChatMessage[]
	cursor: string | null
	done: boolean
	loading: Promise<void> | null
	/** How many messages the running load reads up to, which a later search can raise. */
	want: number
	/** Told of each page read: the newest search, so a reopened panel follows along. */
	notify: (() => void) | null
}

const API = "https://apis.roblox.com/platform-chat-api/v1/get-conversation-messages"

// How many messages one search reads before asking to go further.
const BATCH = 1000

const histories = new Map<string, History>()

const historyOf = (conversationId: string): History => {
	let history = histories.get(conversationId)

	if (!history) {
		history = { messages: [], cursor: null, done: false, loading: null, want: 0, notify: null }
		histories.set(conversationId, history)
	}

	return history
}

/** Reads older pages until `upTo` messages are loaded or none are left, calling back after each. */
const loadMore = (conversationId: string, upTo: number, onPage: () => void): Promise<void> => {
	const history = historyOf(conversationId)

	history.want = Math.max(history.want, upTo)
	history.notify = onPage

	history.loading ??= (async () => {
		while (!history.done && history.messages.length < history.want) {
			const url = `${API}?conversation_id=${encodeURIComponent(conversationId)}${
				history.cursor ? `&cursor=${encodeURIComponent(history.cursor)}` : ""
			}`
			let res = await fetch(url, { credentials: "include" }).catch(() => null)

			// Roblox's own requests share the limit, so a refusal waits a little.
			if (res?.status === 429) {
				await delay(2000)
				res = await fetch(url, { credentials: "include" }).catch(() => null)
			}

			const json = res?.ok ? await res.json().catch(() => null) : null

			if (!json || !Array.isArray(json.messages)) {
				break
			}

			history.messages.push(...json.messages)
			history.cursor = json.next_cursor || null
			history.done = !history.cursor || !json.messages.length
			history.notify?.()
		}
	})().finally(() => {
		history.loading = null
	})

	return history.loading
}

const names = new Map<number, string>()

/** Display names for the senders, asked for once each. */
const loadNames = async (userIds: number[]) => {
	const missing = [...new Set(userIds)].filter((id) => !names.has(id))

	for (let i = 0; i < missing.length; i += 100) {
		const json = await fetch("https://users.roblox.com/v1/users", {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userIds: missing.slice(i, i + 100), excludeBannedUsers: false }),
		})
			.then((res) => res.json())
			.catch(() => null)

		for (const user of json?.data ?? []) {
			names.set(user.id, user.displayName || user.name)
		}
	}
}

const whenSent = (iso: string) => {
	const date = new Date(iso)
	const now = new Date()

	if (date.toDateString() === now.toDateString()) {
		return date.$format(clockFormat())
	}

	return date.$format(date.getFullYear() === now.getFullYear() ? "MMM D" : "MMM D, YYYY")
}

/** `text` with each match of `query` marked, built as nodes so nothing in it is read as markup. */
const highlighted = (text: string, query: string) => {
	const fragment = document.createDocumentFragment()
	const lower = text.toLowerCase()
	let from = 0

	if (!query) {
		fragment.append(text)
		return fragment
	}

	for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, from)) {
		fragment.append(text.slice(from, at))
		const mark = document.createElement("mark")
		mark.className = "btr-chat-search-match"
		mark.textContent = text.slice(at, at + query.length)
		fragment.append(mark)
		from = at + query.length
	}

	fragment.append(text.slice(from))
	return fragment
}

const searchable = (message: ChatMessage) =>
	message.type === "user" && !message.is_deleted && typeof message.content === "string"

/** A message as a row: who, when, and the text with the query marked. */
const messageRow = (message: ChatMessage, query: string, tag: "button" | "div") => {
	const row: HTMLElement = document.createElement(tag)
	row.className = "btr-chat-search-row"

	if (tag === "button") {
		;(row as HTMLButtonElement).type = "button"
	}

	row.append(
		html`<span class="btr-chat-search-meta">
			<span class="text-caption-medium content-emphasis text-truncate-end"></span>
			<span class="text-caption-medium content-muted">${whenSent(message.created_at)}</span>
		</span>`,
		html`<span class="btr-chat-search-text text-body-small content-default"></span>`,
	)

	row.$req(".content-emphasis").textContent = names.get(message.sender_user_id) ?? "Someone"
	row.$req(".btr-chat-search-text").append(highlighted(message.content, query))
	return row
}

const jumps = new Map<string, (ok: boolean) => void>()
let listening = false

/**
 * Has the chat scroll to a message, loading older ones on the way, and says
 * whether it got there.
 */
const jumpTo = (conversationId: string, messageId: string): Promise<boolean> =>
	new Promise((resolve) => {
		if (!listening) {
			listening = true
			injectScript.listen("chatJumpDone", (conversation: string, message: string, ok: boolean) => {
				jumps.get(`${conversation}:${message}`)?.(!!ok)
				jumps.delete(`${conversation}:${message}`)
			})
		}

		jumps.set(`${conversationId}:${messageId}`, resolve)
		injectScript.call("chatJumpTo", conversationId, messageId)
	})

/** The search panel of one chat window, opened from `button`. */
const attachSearch = (shell: HTMLElement, button: HTMLButtonElement) => {
	const conversationId = () => shell.dataset.btrConversation ?? ""
	let panel: HTMLElement | null = null

	// Slides out, then goes; another open in the meantime gets a panel of its own.
	const close = () => {
		const closing = panel
		panel = null
		button.setAttribute("aria-pressed", "false")

		if (!closing) {
			return
		}

		// A hidden page draws no animation to wait for.
		if (document.visibilityState === "hidden") {
			closing.remove()
			return
		}

		closing.setAttribute("data-closing", "")
		const remove = () => closing.remove()
		closing.addEventListener("animationend", remove, { once: true })
		setTimeout(remove, 250)
	}

	const open = (shown?: { message: ChatMessage; query: string }) => {
		const id = conversationId()
		if (!id) {
			return
		}

		const header = shell.$find<HTMLElement>(".react-chat-dialog-header")
		shell.style.position = "relative"

		// The bar is the message box's shape and colours, with the search icon
		// inside it and a clear button at its end.
		panel = html`<div class="btr-chat-search bg-surface-100" role="search">
			<div class="btr-chat-search-bar">
				<span class="icon icon-regular-magnifying-glass content-muted" aria-hidden="true"></span>
				<input
					type="search"
					class="foundation-web-input outline-none content-emphasis placeholder:content-muted bg-none stroke-standard stroke-contrast-alpha focus-within:stroke-system-emphasis text-body-small"
					placeholder="Search this chat"
					aria-label="Search this chat"
					spellcheck="false"
					autocomplete="off"
				/>
				<button type="button" class="btr-chat-search-clear content-muted" aria-label="Clear" hidden>
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<path
							d="M6 6l12 12M18 6L6 18"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			</div>
			<div class="btr-chat-search-status text-caption-medium content-muted" aria-live="polite"></div>
			<div class="btr-chat-search-results"></div>
		</div>`

		panel.style.top = `${header?.offsetHeight ?? 56}px`

		const input = panel.$req<HTMLInputElement>("input")
		const clear = panel.$req<HTMLButtonElement>(".btr-chat-search-clear")
		const status = panel.$req(".btr-chat-search-status")
		const results = panel.$req(".btr-chat-search-results")
		const history = historyOf(id)
		let limit = BATCH
		let timer: ReturnType<typeof setTimeout> | undefined

		/** The messages around one result, with the way back to the list. */
		const showContext = (message: ChatMessage, query: string) => {
			const index = history.messages.indexOf(message)
			// Newest first in the history, oldest first on screen.
			const around = history.messages.slice(Math.max(0, index - 4), index + 5).toReversed()

			const back = html<HTMLButtonElement>`<button
				type="button"
				class="btr-chat-search-back text-caption-medium"
			>
				Back to results
			</button>`
			back.$on("click", render)

			const list = html`<div class="btr-chat-search-context"></div>`

			for (const other of around.filter(searchable)) {
				const row = messageRow(other, other === message ? query : "", "div")
				row.classList.toggle("btr-chat-search-focus", other === message)
				list.append(row)
			}

			results.replaceChildren(back, list)
			back.focus()
		}

		const render = () => {
			const query = input.value.trim().toLowerCase()

			if (query.length < 2) {
				results.replaceChildren()
				status.textContent = history.messages.length
					? `${history.messages.length.toLocaleString("en-US")} messages ready to search`
					: "Type at least 2 letters"
				return
			}

			const found = history.messages.filter(
				(message) => searchable(message) && message.content.toLowerCase().includes(query),
			)
			const oldest = history.messages.at(-1)
			const reach = history.done
				? "whole chat"
				: oldest
					? `back to ${new Date(oldest.created_at).$format("MMM YYYY")}`
					: ""
			const read = history.messages.length.toLocaleString("en-US")

			status.textContent = history.loading
				? `Searching ${read} messages...`
				: `${found.length ? found.length.toLocaleString("en-US") : "No"} ${found.length === 1 ? "match" : "matches"}${reach ? ` · ${reach}` : ""}`

			const rows = found.slice(0, 200).map((message) => {
				const row = messageRow(message, query, "button")
				row.title = "Show in chat"
				row.$on("click", () => {
					close()
					void jumpTo(id, message.id).then((ok) => {
						if (!ok) {
							open({ message, query })
						}
					})
				})
				return row
			})

			results.replaceChildren(...rows)

			if (!history.done && !history.loading) {
				const more = html<HTMLButtonElement>`<button
					type="button"
					class="btr-chat-search-more text-caption-medium"
				>
					Search older messages
				</button>`
				more.$on("click", () => {
					limit = history.messages.length + BATCH
					search()
				})
				results.append(more)
			}

			void loadNames(found.slice(0, 200).map((message) => message.sender_user_id)).then(() => {
				for (const [i, row] of rows.entries()) {
					row.$req(".content-emphasis").textContent =
						names.get(found[i].sender_user_id) ?? "Someone"
				}
			})
		}

		const search = () => {
			render()

			if (input.value.trim().length >= 2) {
				void loadMore(id, limit, render).then(render)
			}
		}

		input.$on("input", () => {
			clearTimeout(timer)
			timer = setTimeout(search, 250)
			clear.hidden = !input.value
		})

		clear.$on("click", () => {
			input.value = ""
			clear.hidden = true
			render()
			input.focus()
		})

		input.$on("keydown", (ev: KeyboardEvent) => {
			if (ev.key === "Escape") {
				ev.preventDefault()
				close()
				button.focus()
			}
		})

		// Keys and clicks stay here rather than reaching the chat around it.
		for (const type of ["click", "pointerdown", "keydown", "keyup", "keypress"]) {
			panel.addEventListener(type, (ev) => ev.stopPropagation())
		}

		shell.append(panel)
		button.setAttribute("aria-pressed", "true")
		input.focus()
		render()

		// Back from a jump that could not reach the message: its context instead.
		if (shown) {
			input.value = shown.query
			clear.hidden = false
			showContext(shown.message, shown.query)
		}

		// The newest messages are read straight away, so a search starts with some.
		void loadMore(id, 100, render).then(render)
	}

	button.$on("click", (ev: MouseEvent) => {
		// The header itself folds the chat on a click.
		ev.preventDefault()
		ev.stopPropagation()

		if (panel) {
			close()
		} else {
			open()
		}
	})
}

/** Adds the search button to every open chat window's header. */
export const startChatSearch = (): void => {
	document.$watchAll(".react-chat-dialog-header-actions", (actions: HTMLElement) => {
		const shell = actions.closest<HTMLElement>(".react-chat-dialog-shell")
		const template = actions.$find<HTMLButtonElement>("button")

		if (!shell || !template || actions.$find(".btr-chat-search-button")) {
			return
		}

		// Roblox's own header button, so it looks and behaves the same.
		const button = html<HTMLButtonElement>`<button
			type="button"
			aria-label="Search messages"
			aria-pressed="false"
		>
			<div aria-hidden="true" data-testid="foundation-web-state-layer"></div>
			<span class="icon icon-regular-magnifying-glass size-500 content-emphasis"></span>
		</button>`

		button.className = `${template.className} btr-chat-search-button`
		button.title = "Search messages"
		button.$req("div").className = template.$find("div")?.className ?? ""

		actions.prepend(button)
		attachSearch(shell, button)
	})
}
