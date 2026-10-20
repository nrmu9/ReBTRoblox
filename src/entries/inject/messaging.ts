// The page side of the btroblox/* CustomEvent bridge to the content script.

export const contentScript = {
	messageListeners: {} as Record<string, ((...args: any[]) => void)[]>,

	send(action: string, ...args: any[]) {
		document.dispatchEvent(new CustomEvent(`btroblox/content/${action}`, { detail: args }))
	},
	listen(action: string, callback: (...args: any[]) => any) {
		let listeners = this.messageListeners[action]

		if (!listeners) {
			listeners = this.messageListeners[action] = []

			document.addEventListener(`btroblox/inject/${action}`, (ev) => {
				const args = Array.isArray((ev as CustomEvent).detail) ? (ev as CustomEvent).detail : []

				for (let i = listeners.length; i--;) {
					try {
						listeners[i].apply(null, args)
					} catch (ex) {
						console.error(ex)
					}
				}
			})
		}

		listeners.push(callback)
	},
}
