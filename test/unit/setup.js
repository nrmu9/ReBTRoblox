// What the extension code reads from the browser as it loads, stubbed for
// Node: a manifest, extension storage that holds nothing, and a page address.
// Tests that need more replace these themselves.

const listeners = { addListener() {}, removeListener() {} }
const storageArea = {
	get: (_keys, done) => (done ? done({}) : Promise.resolve({})),
	set: (_items, done) => (done ? done() : Promise.resolve()),
	remove: (_keys, done) => (done ? done() : Promise.resolve()),
}

globalThis.self ??= globalThis

globalThis.chrome ??= {
	runtime: {
		id: "test",
		lastError: undefined,
		getManifest: () => ({ manifest_version: 2, short_name: "ReBTRoblox", version: "0.0.0" }),
		getURL: (file) => `moz-extension://test/${file}`,
		onMessage: listeners,
		onConnect: listeners,
		connect: () => ({ onMessage: listeners, onDisconnect: listeners, postMessage() {} }),
		sendMessage() {},
	},
	storage: { local: storageArea, sync: storageArea, onChanged: listeners },
	extension: {},
	// The settings apply some of themselves as network rules when they load.
	declarativeNetRequest: {
		getDynamicRules: async () => [],
		updateDynamicRules: async () => {},
		getSessionRules: async () => [],
		updateSessionRules: async () => {},
	},
}

globalThis.browser ??= globalThis.chrome
globalThis.location ??= new URL("https://www.roblox.com/home")
