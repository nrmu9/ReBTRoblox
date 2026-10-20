import { compareFriendList, onFriendshipChanged } from "@/feat/friendLog"
import { recordPresences, setLiveSince } from "@/feat/presenceHistory"
import { SETTINGS } from "@/feat/settings"

// Keeps the background on Roblox's realtime connection, the one its pages
// open, so friends' presence is recorded the moment it changes whether or not
// a Roblox tab is open. It is SignalR over a websocket, signed in with the
// Roblox cookies like any other request to roblox.com.

const ENDPOINT = "wss://realtime-signalr.roblox.com/userhub"
// SignalR's json protocol ends every message with this.
const SEPARATOR = "\u001e"
const PING_INTERVAL = 15e3
// Roblox pings every 15 seconds too, so this long without a word means the
// connection died without closing.
const SILENCE_LIMIT = 40e3

let socket: WebSocket | null = null
let lastMessage = 0
let attempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let ownUserId: number | null = null

const enabled = () => SETTINGS.get("profile.lastSeen") && SETTINGS.get("profile.liveTracking")

const send = (message: object) => socket?.send(JSON.stringify(message) + SEPARATOR)

// Asks Roblox where users are, 50 to a request.
const presenceOf = async (userIds: number[]) => {
	const presences: any[] = []

	for (let i = 0; i < userIds.length; i += 50) {
		const res = await fetch("https://presence.roblox.com/v1/presence/users", {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userIds: userIds.slice(i, i + 50) }),
		})

		if (res.ok) {
			presences.push(...((await res.json())?.userPresences ?? []))
		}
	}

	return presences
}

/**
 * Where everyone stands when the connection opens, as it only pushes changes:
 * friends who were already online, or changed while nothing was listening.
 */
const recordFriends = async () => {
	const me = await fetch("https://users.roblox.com/v1/users/authenticated", {
		credentials: "include",
	}).then((res) => (res.ok ? res.json() : null))

	if (!me?.id) {
		return
	}

	ownUserId = me.id

	const friendIds: number[] = []
	let cursor = ""
	let complete = true

	do {
		const page = await fetch(
			`https://friends.roblox.com/v1/users/${me.id}/friends/find?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			{ credentials: "include" },
		).then((res) => (res.ok ? res.json() : null))

		complete &&= !!page
		friendIds.push(...(page?.PageItems ?? []).map((item: any) => item.id))
		cursor = page?.NextCursor ?? ""
	} while (cursor)

	recordPresences(await presenceOf(friendIds))

	// A list missing a page would read as friends removed.
	if (complete && SETTINGS.get("profile.friendLog")) {
		await compareFriendList(me.id, friendIds)
	}
}

const onPresenceChanged = async (notifications: any[]) => {
	const presences: any[] = []
	const starts: Record<number, number> = {}
	const missing: number[] = []

	for (const notification of notifications) {
		if (notification?.Type !== "PresenceChanged" || !Number.isSafeInteger(notification.UserId)) {
			continue
		}

		const report = notification.PresenceReport

		// Going offline starts now, not when the last session did.
		starts[notification.UserId] =
			report?.userPresenceType > 0 ? Date.parse(notification.SessionStarted) || Date.now() : Date.now()

		if (report) {
			presences.push({ ...report, userId: report.userId ?? notification.UserId })
		} else {
			// Some changes leave the report out, and Roblox's pages ask for it.
			missing.push(notification.UserId)
		}
	}

	if (missing.length) {
		presences.push(...(await presenceOf(missing)))
	}

	recordPresences(presences, starts)
}

const onMessage = (message: any) => {
	if (message.type === 1 && message.target === "subscriptionStatus") {
		// Signed in and listening: fill in where everyone stands, then count
		// everything after as seen live.
		attempts = 0
		recordFriends()
			.catch((err) => console.warn("[btr] could not read friends' presence", err))
			.finally(() => socket && setLiveSince(Date.now()))
	} else if (message.type === 1 && message.target === "notification") {
		const [namespace, detail] = message.arguments ?? []

		if (namespace === "PresenceBulkNotifications") {
			try {
				const notifications = JSON.parse(detail)
				void onPresenceChanged(Array.isArray(notifications) ? notifications : [notifications])
			} catch {}
		} else if (
			namespace === "FriendshipNotifications" &&
			ownUserId &&
			SETTINGS.get("profile.friendLog")
		) {
			try {
				const notifications = JSON.parse(detail)

				for (const notification of Array.isArray(notifications) ? notifications : [notifications]) {
					void onFriendshipChanged(ownUserId, notification)
				}
			} catch {}
		}
	} else if (message.type === 7) {
		// The server is closing the connection, to be opened again.
		socket?.close()
	}
}

const scheduleReconnect = () => {
	clearTimeout(reconnectTimer)

	if (!enabled()) {
		return
	}

	// Backs off to five minutes while signed out or offline, with some spread
	// so a restarted browser does not reconnect on the same beat as Roblox's tabs.
	const delay = Math.min(2e3 * 2 ** attempts, 300e3) * (1 + Math.random() / 2)
	attempts++
	reconnectTimer = setTimeout(connect, delay)
}

const connect = () => {
	if (socket || !enabled()) {
		return
	}

	clearTimeout(reconnectTimer)

	const ws = new WebSocket(ENDPOINT)
	socket = ws
	lastMessage = Date.now()

	ws.onopen = () => send({ protocol: "json", version: 1 })

	ws.onmessage = (ev) => {
		lastMessage = Date.now()

		for (const part of String(ev.data).split(SEPARATOR)) {
			if (part) {
				try {
					onMessage(JSON.parse(part))
				} catch {}
			}
		}
	}

	ws.onclose = () => {
		if (socket === ws) {
			socket = null
			setLiveSince(null)
			scheduleReconnect()
		}
	}
}

const disconnect = () => {
	clearTimeout(reconnectTimer)

	const ws = socket
	socket = null
	setLiveSince(null)
	ws?.close()
}

// Pings keep the connection, and Chrome's service worker, alive.
setInterval(() => {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		return
	}

	if (Date.now() - lastMessage > SILENCE_LIMIT) {
		socket.close()
	} else {
		send({ type: 6 })
	}
}, PING_INTERVAL)

// Chrome can still stop the service worker, which an alarm starts again.
// Firefox has no alarms permission, as its background page never stops.
chrome.alarms?.create("btr-presence-live", { periodInMinutes: 1 })
chrome.alarms?.onAlarm.addListener((alarm) => {
	if (alarm.name === "btr-presence-live") {
		SETTINGS.load(connect)
	}
})

SETTINGS.load(() => {
	connect()

	SETTINGS.onChange(() => {
		if (enabled()) {
			connect()
		} else {
			disconnect()
		}
	})
})
