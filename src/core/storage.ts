export interface StorageSetOptions {
	/** Epoch ms after which getItem discards the entry. */
	expires?: number
	/** Store the string as is instead of JSON encoding it. */
	raw?: boolean
	replacer?: (this: unknown, key: string, value: unknown) => unknown
}

export interface StorageGetOptions {
	raw?: boolean
	reviver?: (this: unknown, key: string, value: unknown) => unknown
}

export const btrLocalStorage = {
	keyPrefix: "ReBTRoblox:",

	setItem(key: string, value: unknown, params?: StorageSetOptions): boolean {
		key = this.keyPrefix + key

		if (value === null || value === undefined) {
			localStorage.removeItem(key)
			return true
		}

		let prefix = ""

		if (params && Number.isSafeInteger(params.expires)) {
			prefix += `expires=${params.expires};`
		}

		if (!params?.raw) {
			value = JSON.stringify(value, params?.replacer)
		}

		try {
			localStorage.setItem(key, prefix + value)
			return true
		} catch (ex) {
			console.error(ex)
			return false
		}
	},

	removeItem(key: string): boolean {
		return this.setItem(key, undefined)
	},

	getItem<T = unknown>(key: string, params?: StorageGetOptions): T | null {
		key = this.keyPrefix + key

		const value = localStorage.getItem(key)
		if (typeof value !== "string") {
			return null
		}

		let startIndex = 0

		if (value.startsWith("expires=", startIndex)) {
			const regex = /^expires=([^;]*);/y
			regex.lastIndex = startIndex

			const match = regex.exec(value)
			const expires = match ? parseInt(match[1], 10) : null

			if (expires === null || !Number.isSafeInteger(expires) || expires <= Date.now()) {
				localStorage.removeItem(key)
				return null
			}

			startIndex = regex.lastIndex
		}

		if (params?.raw) {
			return value.slice(startIndex) as T
		}

		return JSON.parse(value.slice(startIndex), params?.reviver)
	},

	hasItem(key: string): boolean {
		return !!this.getItem(key, { raw: true })
	},

	refresh(): void {
		for (let i = localStorage.length; i--;) {
			const key = localStorage.key(i)
			if (key === null) {
				continue
			}

			if (
				key.startsWith("btrLayeredCache-") ||
				key.startsWith("btr-") ||
				key === "ReBTRoblox:homeShowSecondRow"
			) {
				// Remove legacy data
				if (key === "btr-sv-settings") {
					try {
						this.setItem("svSettings", JSON.parse(localStorage.getItem(key) ?? "null"))
					} catch {}
				} else if (key === "btr-item-thumb-bg") {
					this.setItem("itemThumbBg", localStorage.getItem(key) ?? "")
				}

				localStorage.removeItem(key)
				continue
			}

			if (key.startsWith(this.keyPrefix)) {
				this.getItem(key.slice(this.keyPrefix.length), { raw: true })
			}
		}
	},
}

// This module reaches the MV3 background through feat/serverDetails, and a
// service worker has no localStorage, so the migration below threw on import
// and took the whole worker down before it registered anything. The store is
// only meaningful on a page; where there is none there is nothing to migrate.
if (typeof localStorage !== "undefined") {
	btrLocalStorage.refresh()
}
