import { settings } from "@/entries/inject/state"
import { onSet, hijackFunction } from "@/entries/inject/hooks"
import { reactHook } from "@/entries/inject/react"
import { contentScript } from "@/entries/inject/messaging"

// Injected functions for the navbar, its search and robux badge, and the chat.

export const navigationFunctions: Record<string, (...args: any[]) => any> = {
	cacheRobuxAmount: () => {
		reactHook.hijackConstructor(
			(props: any) =>
				"isGetCurrencyCallDone" in props && "isExperimentCallDone" in props && "robuxAmount" in props,
			(target: any, thisArg: any, args: any[]) => {
				try {
					const props = args[0]

					if (props.isGetCurrencyCallDone && props.isExperimentCallDone) {
						if (Number.isSafeInteger(props.robuxAmount)) {
							localStorage.setItem("ReBTRoblox:cachedRobux", props.robuxAmount)
						}
					} else {
						const cachedRobux = localStorage.getItem("ReBTRoblox:cachedRobux")

						if (cachedRobux) {
							props.isExperimentCallDone = true
							props.isGetCurrencyCallDone = true
							props.robuxAmount = +cachedRobux
						}
					}
				} catch {}

				return target.apply(thisArg, args)
			},
		)
	},
	higherRobuxPrecision: () => {
		onSet(window, "CoreUtilities", (CoreUtilities: any) => {
			hijackFunction(
				CoreUtilities.abbreviateNumber,
				"getTruncValue",
				(target: any, thisArg: any, args: any[]) => {
					// The navbar robux badge is the only caller that passes a lone
					// value; the friend and message counters pass their own
					// threshold. That alone identifies it, so this no longer waits
					// on a react constructor hijack to set a flag, which is what
					// stopped the feature working when the props moved.
					//
					// Read the setting per call: the hook installs before init has
					// delivered settings, so it cannot be gated at registration.
					// Optional: the hook installs at document_start, before init has
					// delivered settings, and reading through the proxy would throw
					// until then. Defaults on, which matches the setting.
					if (args.length === 1 && settings.general?.higherRobuxPrecision !== false) {
						try {
							return target.apply(thisArg, [args[0], 100_000, null, 2])
						} catch (ex) {
							console.error(ex)
						}
					}

					return target.apply(thisArg, args)
				},
			)
		})
	},
	fastsearchFollowPlayer: (userId: number) => {
		Roblox.GameLauncher.followPlayerIntoGame(userId)
	},
	fastsearch: () => {
		reactHook.inject("#navbar-universal-search, .navbar-search", (elem: any) => {
			elem.find("ul")?.prepend(
				reactHook.createElement("div", {
					id: "btr-fastsearch-container",
					dangerouslySetInnerHTML: { __html: "" },
				}),
			)
		})
	},
	voiceStatus: () => {
		reactHook.inject("ul.navbar-right", (elem: any) => {
			const placeholder = () =>
				reactHook.createElement("div", {
					id: "btr-placeholder-voice",
					style: { display: "none" },
					dangerouslySetInnerHTML: { __html: "" },
				})

			// Sits between search and the notification bell. Falling back to
			// robux only loses the placement, not the feature.
			const search = elem.find((x: any) => "toggleUniverseSearch" in x.props)

			if (search) {
				search.after(placeholder())
			} else {
				elem.find((x: any) => "robuxAmount" in x.props)?.before(placeholder())
			}
		})
	},
	// Chat search needs to know which conversation each open chat window is,
	// which only react knows, so each window is marked with its id.
	chatConversationIds: () => {
		const fiberOf = (node: any) => {
			const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"))
			return key ? node[key] : null
		}

		const conversationOf = (node: any): string | null => {
			let fiber = fiberOf(node)

			for (let depth = 0; fiber && depth < 40; depth++) {
				const id = fiber.memoizedProps?.conversation?.id
				if (typeof id === "string") {
					return id
				}
				fiber = fiber.return
			}

			return null
		}

		// Each conversation gets a window of its own, so only new ones are read,
		// once per batch of changes.
		let pending = false

		const mark = () => {
			pending = false

			for (const shell of document.querySelectorAll<HTMLElement>(
				".react-chat-dialog-shell:not([data-btr-conversation])",
			)) {
				const id = conversationOf(shell)
				if (id) {
					shell.dataset.btrConversation = id
				}
			}
		}

		new MutationObserver(() => {
			if (!pending) {
				pending = true
				queueMicrotask(mark)
			}
		}).observe(document.documentElement, { childList: true, subtree: true })
		mark()
	},
	// Brings a message into view in its chat window, for chat search. It has
	// the chat load older messages the way its own scrolling does until the
	// message is there, then centres it and flashes a ring round it.
	chatJumpTo: (conversationId: string, messageId: string) => {
		const done = (ok: boolean) => contentScript.send("chatJumpDone", conversationId, messageId, ok)
		const shell = document.querySelector<HTMLElement>(
			`.react-chat-dialog-shell[data-btr-conversation="${CSS.escape(conversationId)}"]`,
		)
		const scroll = shell?.querySelector<HTMLElement>(".react-chat-dialog-scroll")

		if (!shell || !scroll) {
			done(false)
			return
		}

		const fiberOf = (node: any) => {
			const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"))
			return key ? node[key] : null
		}

		const find = () =>
			[...shell.querySelectorAll<HTMLElement>(".react-chat-message-bubble")].find((bubble) => {
				let fiber = fiberOf(bubble)

				for (let depth = 0; fiber && depth < 10; depth++) {
					const id = fiber.memoizedProps?.message?.id
					if (id) {
						return id === messageId
					}
					fiber = fiber.return
				}

				return false
			})

		const count = () => shell.querySelectorAll(".react-chat-message-bubble").length

		// The message list's own props: what its scrolling calls to load older
		// messages, and whether any are left. React keeps the list twice, as it
		// is now and as it was, and the older copy's loader asks for the page
		// already loaded. Each loader is used once, so the one not yet used is
		// the current one.
		const used = new Set<() => void>()

		const list = () => {
			// Looked up each time, as loading can draw the list anew.
			let fiber = fiberOf(shell.querySelector(".react-chat-dialog-scroll") ?? scroll)

			while (fiber && !fiber.memoizedProps?.onLoadMore) {
				fiber = fiber.return
			}

			type ListProps = { onLoadMore: () => void; hasNextPage?: boolean }
			const copies: ListProps[] = [fiber?.memoizedProps, fiber?.alternate?.memoizedProps].filter(
				(props) => typeof props?.onLoadMore === "function",
			)

			return copies.find((props) => !used.has(props.onLoadMore))
		}

		// The task after this one. A timer would do, but hidden tabs hold timers
		// back for up to a minute.
		const nextTask = (fn: () => void) => {
			const channel = new MessageChannel()
			channel.port1.onmessage = () => fn()
			channel.port2.postMessage(null)
		}

		// Each load adds 20 older messages; past this many it gives up.
		let pagesLeft = 100

		const step = () => {
			const bubble = find()

			if (bubble) {
				// A hidden page draws no smooth scroll, so it goes straight there.
				bubble.scrollIntoView({
					block: "center",
					behavior: document.visibilityState === "visible" ? "smooth" : "auto",
				})
				bubble.animate(
					[
						{ boxShadow: "0 0 0 2px var(--color-system-emphasis, #335fff)" },
						{ boxShadow: "0 0 0 2px var(--color-system-emphasis, #335fff)", offset: 0.6 },
						{ boxShadow: "0 0 0 2px transparent" },
					],
					{ duration: 1800, easing: "ease-out" },
				)
				done(true)
				return
			}

			const props = list()

			if (pagesLeft-- <= 0 || !shell.isConnected || !props?.onLoadMore || !props.hasNextPage) {
				done(false)
				return
			}

			const before = count()

			// Waits for the older page, or gives up when none comes. The next is
			// asked for in the task after, as the chat only takes a new request
			// once it has finished with the last, just after showing it.
			const observer = new MutationObserver(() => {
				if (count() > before) {
					observer.disconnect()
					clearTimeout(timer)
					nextTask(step)
				}
			})
			const timer = setTimeout(() => {
				observer.disconnect()
				done(false)
			}, 5000)

			observer.observe(shell, { childList: true, subtree: true })
			used.add(props.onLoadMore)
			props.onLoadMore()
		}

		step()
	},
	// Roblox's chat renders an open conversation from a react-query cache
	// that nothing invalidates when a message arrives. The conversation
	// object gets a fresh preview, so the list updates and the unread
	// badge appears, while the messages themselves stay as they were
	// until the page is reloaded.
	//
	// Refetching that query is all it takes, so this watches the open
	// conversations and invalidates one when its preview moves on
	// without its messages following.
	fixChatMessages: () => {
		const SHELL = ".react-chat-dialog-shell"
		const ROW = "button.react-chat-row"
		const seen = new Map<string, string>()

		const fiberOf = (node: any) => {
			const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"))
			return key ? node[key] : null
		}

		/** Walks up from a node until a fiber carries the named prop. */
		const propAbove = (node: any, name: string, test?: (value: any) => boolean) => {
			let fiber = fiberOf(node)

			for (let depth = 0; fiber && depth < 40; depth++) {
				const value = fiber.memoizedProps?.[name]

				if (value && (!test || test(value))) {
					return value
				}

				fiber = fiber.return
			}

			return null
		}

		const conversationOf = (node: any) => propAbove(node, "conversation", (c) => !!c.id)

		// Previews put a message on one line, and the conversation shows it as
		// written, so both are compared with their whitespace collapsed.
		const flatten = (text: string) => text.replace(/\s+/g, " ").trim()

		/** Whether the open conversation shows a message of yours on its way out. */
		const isSending = (shell: Element) =>
			[...shell.querySelectorAll(".react-chat-message-bubble")].some(
				(bubble) =>
					propAbove(bubble, "message", (m) => typeof m === "object" && "isSending" in m)?.isSending,
			)

		const isMessages = (conversationId: string) => (query: any) =>
			Array.isArray(query.queryKey) &&
			query.queryKey.includes("conversationMessages") &&
			query.queryKey.includes(conversationId)

		// A message that lands before a conversation's history has loaded can
		// become the whole history, which then counts as loaded: one message
		// and nothing older to scroll to. A conversation found that short is
		// asked for again, once for each set of messages it holds, so a chat
		// that really is that short is not asked for over and over.
		const refetched = new Map<string, string>()

		const checkHistories = () => {
			for (const shell of document.querySelectorAll(SHELL)) {
				const conversation = conversationOf(shell)
				const client = conversation && propAbove(shell, "client", (c) => !!c.invalidateQueries)

				if (!client || client.isMutating?.() || isSending(shell)) {
					continue
				}

				const query = client
					.getQueryCache?.()
					.findAll({ predicate: isMessages(conversation.id) })?.[0]
				const data = query?.state.data

				if (!data || query.state.fetchStatus === "fetching" || !Array.isArray(data.messages)) {
					continue
				}

				const { messages } = data
				const state = `${messages.length}:${messages[0]?.id}:${messages.at(-1)?.id}`

				if (messages.length >= 20 || data.next_cursor) {
					// Whole again, so the same short state later is worth fixing too.
					refetched.delete(conversation.id)
				} else if (refetched.get(conversation.id) !== state) {
					refetched.set(conversation.id, state)
					client.invalidateQueries(
						{ predicate: isMessages(conversation.id) },
						{ cancelRefetch: false },
					)
				}
			}
		}

		const check = () => {
			if (settings.general?.fixChatMessages === false) {
				return
			}

			try {
				checkHistories()
			} catch {}

			// Read from the list rows, not from the open conversation. The
			// conversation is the component that is not re-rendering, so its
			// props still describe the state before the message arrived. The
			// rows do re-render, which is why the list and the unread badge
			// are right while the messages are not.
			// Falling back to the conversations themselves keeps this working,
			// just not promptly, if the rows ever stop carrying one.
			const sources = document.querySelectorAll(ROW).length
				? document.querySelectorAll(ROW)
				: document.querySelectorAll(SHELL)

			for (const row of sources) {
				try {
					const conversation = conversationOf(row)
					if (!conversation) {
						continue
					}

					const preview = flatten(String(conversation.preview?.text ?? conversation.preview ?? ""))
					if (!preview || seen.get(conversation.id) === preview) {
						continue
					}

					// Only conversations that are open on screen can be showing
					// stale messages.
					const shell = [...document.querySelectorAll(SHELL)].find(
						(s) => conversationOf(s)?.id === conversation.id,
					)

					if (!shell) {
						continue
					}

					const client = propAbove(shell, "client", (c) => !!c.invalidateQueries)
					if (!client) {
						continue
					}

					// A conversation that has not rendered anything yet is loading,
					// not behind. Invalidating then would cancel its first fetch
					// and race the thing it is meant to help.
					const rendered = shell.querySelectorAll("li").length

					if (!rendered || flatten(shell.textContent ?? "").includes(preview)) {
						continue
					}

					// Refetching while a message is being sent replaces the copy
					// that is waiting on its answer, which then shows as sending
					// for good. Left unrecorded, so it is checked again once sent.
					if (client.isMutating?.() || isSending(shell)) {
						continue
					}

					// Recorded before invalidating, so the refetch this causes
					// cannot come back around and invalidate again.
					seen.set(conversation.id, preview)

					// Only the messages themselves. Other entries under the same
					// conversation, like its failed and moderated messages, live
					// only in the page, and refetching them empties them.
					client.invalidateQueries(
						{ predicate: isMessages(conversation.id) },
						{ cancelRefetch: false },
					)
				} catch {}
			}
		}

		// The list re-renders when a message lands even though the
		// conversation does not, so watching the chat covers the case
		// without polling for it.
		let watched: Element | null = null

		const inner = new MutationObserver(() => {
			if (watched && !watched.isConnected) {
				// The chat was torn down, so go back to waiting for a new one
				// rather than holding an observer on a detached tree.
				inner.disconnect()
				watched = null
				outer.observe(document, { childList: true, subtree: true })
				return
			}

			check()
		})

		// Watching the whole document is only to find the chat once. It is
		// the busiest observer on the page, so it stops as soon as it has.
		const outer = new MutationObserver(() => {
			const root = document.querySelector(".react-chat-root")

			if (!root || root === watched) {
				return
			}

			watched = root
			outer.disconnect()
			inner.observe(root, { childList: true, subtree: true, characterData: true })
			check()
		})

		outer.observe(document, { childList: true, subtree: true })
	},
	navigation: () => {
		reactHook.inject("ul.navbar-right", (elem: any) => {
			const robux = elem.find((x: any) => "robuxAmount" in x.props)

			if (robux) {
				robux.before(
					reactHook.createElement("div", {
						id: "btr-placeholder-friends",
						style: { display: "none" },
						dangerouslySetInnerHTML: { __html: "" },
					}),
					reactHook.createElement("div", {
						id: "btr-placeholder-messages",
						style: { display: "none" },
						dangerouslySetInnerHTML: { __html: "" },
					}),
				)
			}
		})
	},
}
