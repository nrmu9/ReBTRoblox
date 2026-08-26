export const btrLocalStorage = {
	keyPrefix: "BTRoblox:",
	
	setItem(key: string, value: any, params?: any) {
		key = this.keyPrefix + key
		
		if(value === null || value === undefined) {
			localStorage.removeItem(key)
			return true
		}
		
		let prefix = ""
		
		if(Number.isSafeInteger(params?.expires)) {
			prefix += `expires=${params.expires};`
		}
		
		if(!params?.raw) {
			value = JSON.stringify(value, params?.replacer)
		}
		
		try {
			localStorage.setItem(key, prefix + value)
			return true
		} catch(ex) {
			console.error(ex)
			return false
		}
	},
	
	removeItem(key: string) {
		return this.setItem(key, undefined)
	},
	
	getItem(key: string, params?: any) {
		key = this.keyPrefix + key
		
		const value = localStorage.getItem(key)
		if(typeof value !== "string") { return null }
		
		let startIndex = 0
		
		if(value.startsWith("expires=", startIndex)) {
			const regex = /^expires=([^;]*);/y
			regex.lastIndex = startIndex
			
			const match = regex.exec(value)
			const expires = match ? parseInt(match[1], 10) : null
			
			if(expires === null || !Number.isSafeInteger(expires) || expires <= Date.now()) {
				localStorage.removeItem(key)
				return null
			}
			
			startIndex = regex.lastIndex
		}
		
		if(params?.raw) {
			return value.slice(startIndex)
		}
		
		return JSON.parse(value.slice(startIndex), params?.reviver)
	},
	
	hasItem(key: string) {
		return this.getItem(key, { raw: true }) ? true : false
	},
	
	refresh() {
		for(let i = localStorage.length; i--;) {
			const key = localStorage.key(i)
			if(key === null) { continue }
			
			if(key.startsWith("btrLayeredCache-") || key.startsWith("btr-") || key === "BTRoblox:homeShowSecondRow") { // Remove legacy data
				if(key === "btr-sv-settings") {
					try { this.setItem("svSettings", JSON.parse(localStorage.getItem(key) ?? "null")) }
					catch {}
				} else if(key === "btr-item-thumb-bg") {
					this.setItem("itemThumbBg", localStorage.getItem(key) ?? "")
				}
				
				localStorage.removeItem(key)
				continue
			}
			
			if(key.startsWith(this.keyPrefix)) {
				this.getItem(key.slice(this.keyPrefix.length), { raw: true })
			}
		}
	}
}

btrLocalStorage.refresh()
