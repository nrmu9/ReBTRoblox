import { settings } from "@/entries/inject/state"
import { hijackFunction } from "@/entries/inject/hooks"

// Roblox limits how often chats are asked for, and the limit is shared by
// every tab. Each tab's chat asks on its own: two or three times as it loads,
// and for every message that arrives, once for the chat's messages, once for
// the chat list and once for its details. A few open tabs are enough to be
// turned away with a 429 mid conversation.
//
// Tabs share what they ask for here instead. Roblox's realtime connection says
// whenever something changes, so an answer stays good until it says so, and a
// tab that has been listening can hand it to the others, and to tabs opened
// later. One tab at a time asks Roblox for the same thing, and the rest use
// its answer. While Roblox is turning requests away, every tab waits it out
// instead of asking again and keeping the limit going.
//
// Roblox's chat asks through XMLHttpRequest, so a shared answer is handed to
// the request as if it had come back from Roblox, and it never goes out.

const API = "/platform-chat-api/v1/"
const MESSAGES = "get-conversation-messages"

/** What can be shared, and which chat's messages each is, if any. */
const SHARED: Record<string, string | null> = {
	[MESSAGES]: "conversation_id",
	"get-user-conversations": null,
	"get-conversation-metadata": null,
	metadata: null,
}

// The chat's own channels, as its realtime client is subscribed to them.
const CHANNELS = [
	"ChatNotifications",
	"CommunicationChannels",
	"ChatMigration",
	"FriendshipNotifications",
	"UserSettingsChanged",
	"ChatModerationTypeEligibility",
	"UserTagChangeNotification",
]

/** How recently a request must have gone out to share it without the connection to vouch. */
const JOIN_WINDOW = 1000

/** How long a tab holds its turn after sharing an answer, for the answer to arrive first. */
const HANDOFF = 30

/** How long to give the other tabs to say what they have. */
const ASK_WAIT = 150

/** How long anything waits on another tab before asking Roblox itself. */
const WAIT_LIMIT = 8000

/**
 * The longest an answer is trusted with no word from the connection. Some
 * changes may never be announced, like a chat read on another device.
 */
const CEILING = 5 * 60e3

/**
 * How far apart tabs may hear the same change. One heard this close to a
 * request going out counts only if the answer says it already reflects it.
 */
const SKEW = 5000

/** Changes that only touch the list and details, never a chat's messages. */
const NOT_MESSAGES = /MarkedRead|MetadataUpdated|Typing/i

/** How long to hold off after a 429 that does not say. */
const DEFAULT_BLOCK = 5000

/** Any chat at all, for the list and details. */
const EVERY = "*"

interface Answer {
	status: number
	statusText: string
	headers: string
	body: string
}

interface Entry {
	scope: string
	answer: Answer
	/** When its request went out. */
	startedAt: number
	/** When a listening tab last said it was still current, or null if none could. */
	vouchedAt: number | null
	/** The changes its tab had heard as its request went out. */
	known: string[]
}

interface Change {
	/** Roblox's own id for it, the same in every tab. */
	id: string
	/** The chat it is about, or null for any. */
	scope: string | null
	/** Whether it can change a chat's messages, not just its list entry. */
	messages: boolean
	at: number
}

type Message =
	| { type: "hello"; tab: string }
	| { type: "here"; tab: string }
	| { type: "bye"; tab: string }
	| { type: "answer"; key: string; entry: Entry }
	| { type: "ask"; tab: string; id: string; key: string }
	| { type: "offer"; id: string; key: string; entry: Entry }
	| { type: "changed"; at: number }
	| { type: "block"; until: number }

const enabled = () => settings.general?.fixChatMessages !== false

/** What is shared for a chat request, or null for anything else. */
const describe = (method: string, url: string) => {
	if (method !== "GET" || !url.includes(API)) {
		return null
	}

	try {
		const parsed = new URL(url, location.href)
		const name = parsed.pathname.slice(parsed.pathname.indexOf(API) + API.length)

		if (!(name in SHARED)) {
			return null
		}

		const param = SHARED[name]
		return {
			key: parsed.href,
			scope: (param && parsed.searchParams.get(param)) || EVERY,
			// Only messages wait out a 429 with the other tabs, as the chat fix
			// asks for them again after. The chat gives up on its list for good
			// if that is turned away a few times in a row.
			waits: name === MESSAGES,
		}
	} catch {
		return null
	}
}

export const shareChatRequests = () => {
	if (typeof BroadcastChannel !== "function") {
		return
	}

	const channel = new BroadcastChannel("btr-chat-requests")
	const post = (message: Message) => channel.postMessage(message)
	const tab = Math.random().toString(36).slice(2)

	const cache = new Map<string, Entry>()
	// Keys this tab has had an answer for. Anything that dropped one dropped
	// the others' too, and their newer answers reach here as they come.
	const seen = new Set<string>()
	const others = new Set<string>()

	// Since when this tab has heard every change, or null while it cannot.
	let listeningSince: number | null = null
	// The changes heard lately. Every tab hears the same ones a few moments
	// apart, so they are told apart by Roblox's id for them, not by when.
	const changes: Change[] = []
	// Before this, anything may have changed: a message sent here, or a gap.
	let everythingChangedAt = 0

	/** The changes heard lately, for an answer to say it already reflects them. */
	const knownChanges = (now = Date.now()) =>
		changes.filter((change) => change.at > now - SKEW).map((change) => change.id)

	const touches = (change: Change, scope: string) =>
		scope === EVERY || change.scope === null || (change.scope === scope && change.messages)

	/** Whether something it does not reflect has changed since its request went out. */
	const outdated = (entry: Entry) =>
		everythingChangedAt > entry.startedAt ||
		changes.some(
			(change) =>
				change.at > entry.startedAt - SKEW &&
				touches(change, entry.scope) &&
				!entry.known.includes(change.id),
		)

	const dropOutdated = () => {
		for (const [key, entry] of cache) {
			if (outdated(entry)) {
				cache.delete(key)
			}
		}
	}

	const heard = (change: Change) => {
		changes.push(change)

		// Anything it made outdated goes now, so forgetting it later changes nothing.
		dropOutdated()

		while (changes.length && changes[0].at < change.at - 60e3) {
			changes.shift()
		}
	}

	/** Something changed that no event describes, so nothing from before will do. */
	const changedEverything = (at = Date.now()) => {
		everythingChangedAt = Math.max(everythingChangedAt, at)
		dropOutdated()
	}

	/** Whether this tab can still vouch for an entry. */
	const current = (entry: Entry, now = Date.now()) =>
		listeningSince !== null &&
		entry.vouchedAt !== null &&
		listeningSince <= entry.vouchedAt &&
		now - entry.startedAt < CEILING &&
		!outdated(entry)

	/** Whether an entry will do for a request made at `requestedAt`. */
	const usable = (entry: Entry | undefined, requestedAt: number) => {
		if (!entry || outdated(entry)) {
			return false
		}

		const now = Date.now()

		return (
			current(entry, now) ||
			// Another tab just said it was current.
			(entry.vouchedAt !== null && now - entry.vouchedAt < JOIN_WINDOW) ||
			// Asked for so recently, nothing can have changed since.
			entry.startedAt >= requestedAt - JOIN_WINDOW
		)
	}

	const keep = (key: string, entry: Entry) => {
		const had = cache.get(key)

		if (!outdated(entry) && (!had || had.startedAt <= entry.startedAt)) {
			cache.set(key, entry)
			seen.add(key)
		}
	}

	// Kept in the page's storage as well, as a tab opened while Roblox is
	// turning requests away never heard the others say so.
	const BLOCKED_UNTIL = "ReBTRoblox:chatBlockedUntil"
	let blockedAt = 0

	const blockedUntil = () => {
		try {
			return Math.max(blockedAt, Number(localStorage.getItem(BLOCKED_UNTIL)) || 0)
		} catch {
			return blockedAt
		}
	}

	const block = (until: number) => {
		try {
			if (until > blockedUntil()) {
				localStorage.setItem(BLOCKED_UNTIL, String(until))
			}
		} catch {}

		blockedAt = Math.max(blockedAt, until)
	}

	const retryAfter = (headers: string) => {
		const value = headers.match(/^retry-after:\s*(.+)$/im)?.[1]?.trim()
		const seconds = Number(value)
		const at = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(value ?? "")
		return Number.isFinite(at) ? Math.min(at, Date.now() + 60e3) : Date.now() + DEFAULT_BLOCK
	}

	const tooManyRequests = (): Answer => ({
		status: 429,
		statusText: "Too Many Requests",
		headers: `content-type: application/json\r\nretry-after: ${Math.max(1, Math.ceil((blockedUntil() - Date.now()) / 1000))}\r\n`,
		body: JSON.stringify({ errors: [{ code: 0, message: "TooManyRequests" }] }),
	})

	// Asks the others for what this tab has never had.
	const asking = new Map<string, (entry: Entry) => void>()

	const ask = (key: string) =>
		new Promise<Entry | null>((resolve) => {
			const id = `${tab}:${Math.random().toString(36).slice(2)}`
			const timer = setTimeout(() => {
				asking.delete(id)
				resolve(null)
			}, ASK_WAIT)

			asking.set(id, (entry) => {
				clearTimeout(timer)
				asking.delete(id)
				resolve(entry)
			})

			post({ type: "ask", tab, id, key })
		})

	channel.onmessage = (event: MessageEvent<Message>) => {
		const message = event.data

		switch (message?.type) {
			case "hello":
				others.add(message.tab)
				post({ type: "here", tab })
				break
			case "here":
				others.add(message.tab)
				break
			case "bye":
				others.delete(message.tab)
				break
			case "answer":
				keep(message.key, message.entry)
				break
			case "ask": {
				others.add(message.tab)
				const entry = cache.get(message.key)

				if (entry && current(entry)) {
					post({
						type: "offer",
						id: message.id,
						key: message.key,
						entry: { ...entry, vouchedAt: Date.now() },
					})
				}
				break
			}
			case "offer":
				asking.get(message.id)?.(message.entry)
				break
			case "changed":
				changedEverything(message.at)
				break
			case "block":
				block(message.until)
				break
		}
	}

	post({ type: "hello", tab })
	window.addEventListener("pagehide", () => post({ type: "bye", tab }))

	// Listening to the realtime connection the chat itself listens to.
	const listen = (client: any) => {
		let firstStart = true

		const startListening = () => {
			const now = Date.now()

			if (firstStart) {
				// The chat asks for everything before the connection is up, and does
				// not ask again once it is, so what it shows rests on those answers
				// anyway. They count as heard over from the start.
				firstStart = false
				listeningSince = Math.min(now, performance.timeOrigin)

				for (const entry of cache.values()) {
					if (entry.vouchedAt === null && entry.startedAt >= listeningSince) {
						entry.vouchedAt = now
					}
				}

				return
			}

			// Back after missing something, so nothing kept from before will do.
			cache.clear()
			listeningSince = now
		}

		const stopListening = () => {
			listeningSince = null
		}

		const onChange = (name: string) => (notifications: unknown) => {
			for (const notification of Array.isArray(notifications) ? notifications : [notifications]) {
				const record = notification && typeof notification === "object" ? (notification as any) : {}
				const id =
					record.conversationId ??
					record.conversation_id ??
					record.ConversationId ??
					record.channelId ??
					record.channel_id ??
					record.ChannelId

				const type = String(record.Type ?? record.type ?? "")
				const identity = record.RealtimeMessageIdentifier ?? record.SequenceNumber

				heard({
					id: `${name}:${type}:${identity ?? JSON.stringify(record)}`,
					scope: id == null ? null : String(id),
					messages: !NOT_MESSAGES.test(type),
					at: Date.now(),
				})
			}
		}

		for (const name of CHANNELS) {
			client.Subscribe(name, onChange(name))
			// Something was missed, so nothing heard before can be trusted.
			client.SubscribeToGapEvent?.(name, startListening)
		}

		// Its connection events do not reach a listener that joins before it
		// connects, so the connection is also checked on its own.
		let connected = false

		const check = () => {
			const now = client.IsConnected?.() === true

			if (now && !connected) {
				startListening()
			} else if (!now && connected) {
				stopListening()
			}

			connected = now
		}

		client.SubscribeToConnectionEvents?.(startListening, startListening, stopListening, CHANNELS[0])
		check()
		setInterval(check, 500)
	}

	let tries = 0

	const findClient = () => {
		const client = (window as any).Roblox?.RealTime?.Factory?.GetClient?.()

		if (client?.Subscribe) {
			try {
				listen(client)
			} catch {}
		} else if (++tries < 100) {
			setTimeout(findClient, 200)
		}
	}

	findClient()

	/** Hands the request an answer as if Roblox had sent it, without sending it. */
	const answerWith = (xhr: XMLHttpRequest, url: string, answer: Answer) => {
		let response: unknown = answer.body

		if (xhr.responseType === "json") {
			try {
				response = JSON.parse(answer.body)
			} catch {
				response = null
			}
		}

		const values: Record<string, unknown> = {
			readyState: 4,
			status: answer.status,
			statusText: answer.statusText,
			responseURL: url,
			responseText: answer.body,
			response,
		}

		for (const [name, value] of Object.entries(values)) {
			Object.defineProperty(xhr, name, { configurable: true, get: () => value })
		}

		const headers = new Map<string, string>()

		for (const line of answer.headers.split(/\r?\n/)) {
			const colon = line.indexOf(":")
			if (colon > 0) {
				headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
			}
		}

		xhr.getAllResponseHeaders = () => answer.headers
		xhr.getResponseHeader = (name: string) => headers.get(String(name).toLowerCase()) ?? null

		// Later, as a real answer would be, once the page is done sending.
		setTimeout(() => {
			xhr.dispatchEvent(new Event("readystatechange"))
			xhr.dispatchEvent(new ProgressEvent("load"))
			xhr.dispatchEvent(new ProgressEvent("loadend"))
		})
	}

	/** Sends the request to Roblox, and shares what comes back. Resolves once it has. */
	const sendToRoblox = (
		xhr: XMLHttpRequest,
		send: () => void,
		key: string,
		scope: string,
		waits: boolean,
	): Promise<void> =>
		new Promise((resolve) => {
			const startedAt = Date.now()
			const known = knownChanges(startedAt)
			const heardFrom = listeningSince !== null && listeningSince <= startedAt

			xhr.addEventListener("loadend", () => {
				try {
					const body =
						xhr.status <= 0
							? null
							: xhr.responseType === "json"
								? JSON.stringify(xhr.response)
								: xhr.responseType === "" || xhr.responseType === "text"
									? xhr.responseText
									: null

					const answer: Answer | null =
						body === null
							? null
							: {
									status: xhr.status,
									statusText: xhr.statusText,
									headers: xhr.getAllResponseHeaders(),
									body,
								}

					if (answer?.status === 429 && waits) {
						const until = retryAfter(answer.headers)
						block(until)
						post({ type: "block", until })
					}

					const entry: Entry | null =
						answer && answer.status >= 200 && answer.status < 300
							? {
									scope,
									answer,
									startedAt,
									vouchedAt: heardFrom && listeningSince !== null ? Date.now() : null,
									known,
								}
							: null

					// Only good answers are shared, and only ones nothing has changed since.
					if (entry && !outdated(entry)) {
						keep(key, entry)
						post({ type: "answer", key, entry })
					}
				} catch {}

				resolve()
			})

			send()
		})

	const opened = new WeakMap<XMLHttpRequest, { method: string; url: string }>()

	hijackFunction(XMLHttpRequest.prototype, "open", (target: any, xhr: any, args: any[]) => {
		opened.set(xhr, { method: String(args[0]).toUpperCase(), url: String(args[1]) })
		return target.apply(xhr, args)
	})

	hijackFunction(XMLHttpRequest.prototype, "send", (target: any, xhr: any, args: any[]) => {
		const request = opened.get(xhr)
		const send = () => target.apply(xhr, args)

		if (!request || !enabled() || !request.url.includes(API)) {
			return send()
		}

		// Anything that changes a chat, like sending or deleting a message. The
		// asks for things go through POST too, but are named get, and neither
		// read receipts nor Roblox's prompts change what is shared.
		if (request.method !== "GET") {
			if (!/\/v\d+\/(get-|mark-|record-)|modal/.test(request.url)) {
				const at = Date.now()
				changedEverything(at)
				post({ type: "changed", at })
			}

			return send()
		}

		const shared = describe(request.method, request.url)

		if (!shared) {
			return send()
		}

		const requestedAt = Date.now()

		if (shared.waits && requestedAt < blockedUntil()) {
			answerWith(xhr, request.url, tooManyRequests())
			return
		}

		const kept = cache.get(shared.key)

		if (usable(kept, requestedAt)) {
			answerWith(xhr, request.url, kept!.answer)
			return
		}

		const decide = async () => {
			// Another tab may have answered while this one waited its turn.
			const now = cache.get(shared.key)

			if (usable(now, requestedAt)) {
				answerWith(xhr, request.url, now!.answer)
				return
			}

			if (shared.waits && Date.now() < blockedUntil()) {
				answerWith(xhr, request.url, tooManyRequests())
				return
			}

			// Only what this tab never had is worth asking about. Anything it
			// had and dropped, the others dropped too.
			if (others.size && !seen.has(shared.key)) {
				const offered = await ask(shared.key)

				if (offered && !outdated(offered)) {
					keep(shared.key, offered)
					answerWith(xhr, request.url, offered.answer)
					return
				}
			}

			await sendToRoblox(xhr, send, shared.key, shared.scope, shared.waits)

			// The answer goes to the other tabs separately from the turn passing
			// on, so the next tab waiting its turn is given a moment to have it.
			await new Promise((resolve) => setTimeout(resolve, HANDOFF))
		}

		// One tab at a time asks for the same thing, so the rest can use its answer.
		if (navigator.locks?.request) {
			let done = false
			const release = new Promise<void>((resolve) => setTimeout(resolve, WAIT_LIMIT))

			navigator.locks
				.request(`btr-chat:${shared.key}`, () =>
					Promise.race([
						decide().finally(() => {
							done = true
						}),
						release,
					]),
				)
				.catch(() => {
					if (!done) {
						void decide()
					}
				})
		} else {
			void decide()
		}
	})
}
