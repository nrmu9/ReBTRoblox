import { injectScript } from "@/core/messaging"
import { isRobloxUrl } from "@/core/pageInput"

// Responses to requests Roblox makes anyway, passed on by the page hook so a
// feature can read them instead of asking Roblox again. Every saved request
// counts against the same rate limits Roblox's own pages share.

interface Response {
	url: string
	json: any
}

const received: Response[] = []
const waiters = new Set<(response: Response) => void>()

injectScript.listen("robloxResponse", (url: string, json: any) => {
	if (!isRobloxUrl(url)) {
		return
	}

	const response = { url, json }

	received.push(response)
	if (received.length > 40) {
		received.shift()
	}

	for (const waiter of waiters) {
		waiter(response)
	}
})

// The page hook keeps what it saw before this was listening.
injectScript.send("replayRobloxResponses")

/**
 * The first response Roblox gets that passes the test, or null once the wait
 * is over, in which case the caller asks for itself.
 */
export const waitForRobloxResponse = (
	test: (url: string, json: any) => boolean,
	timeout = 6000,
): Promise<any | null> =>
	new Promise((resolve) => {
		const earlier = received.find((response) => test(response.url, response.json))

		if (earlier) {
			resolve(earlier.json)
			return
		}

		const waiter = (response: Response) => {
			if (test(response.url, response.json)) {
				done(response.json)
			}
		}

		const timer = setTimeout(() => {
			// In dev, a sign that Roblox stopped making the request this waits for.
			if (__DEV__) {
				console.warn("[btr] no Roblox response to reuse, asking instead", String(test))
			}

			done(null)
		}, timeout)

		const done = (json: any) => {
			clearTimeout(timer)
			waiters.delete(waiter)
			resolve(json)
		}

		waiters.add(waiter)
	})

/** Every response Roblox gets that passes the test, now and later. */
export const onRobloxResponse = (test: (url: string) => boolean, handler: (json: any) => void): void => {
	for (const response of received) {
		if (test(response.url)) {
			handler(response.json)
		}
	}

	waiters.add((response) => {
		if (test(response.url)) {
			handler(response.json)
		}
	})
}
