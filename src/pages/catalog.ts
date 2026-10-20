import { setImmediate } from "@/core/dom"
import { STORAGE } from "@/core/env"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { btrLocalStorage } from "@/core/storage"
import { loadOptionalFeature } from "@/feat/loadFeature"
import { SETTINGS } from "@/feat/settings"
import { loggedInUser } from "@/pages/common"
import { RobloxApi } from "@/rbx/RobloxApi"

const OwnerAssetCache = {
	markedDirty: undefined as any,
	assetTypes: ["bundles", "assets"],
	requestedAssetTypes: [
		// had to split these into two batches because we were hitting max url length
		// with how big the cursor was
		[
			"Hat",
			"Shirt",
			"Pants",
			"Head",
			"Face",
			"Gear",
			"HairAccessory",
			"FaceAccessory",
			"NeckAccessory",
			"ShoulderAccessory",
			"FrontAccessory",
			"BackAccessory",
		],
		[
			"WaistAccessory",
			"EmoteAnimation",
			"TShirtAccessory",
			"ShirtAccessory",
			"PantsAccessory",
			"JacketAccessory",
			"SweaterAccessory",
			"ShortsAccessory",
			"LeftShoeAccessory",
			"RightShoeAccessory",
			"DressSkirtAccessory",
		],
	],
	assetMap: {},
	data: null as any,

	initialized: false,

	resetData() {
		this.data = {
			lastUserId: null as number | null,
			types: {},
		}

		for (const assetType of this.assetTypes) {
			const typeData = (this.data.types[assetType] = {
				list: new Set(),
				lastPopulate: 0,
			})

			Object.defineProperties(typeData, {
				type: { configurable: true, value: assetType },
				lastUpdate: { configurable: true, value: 0, writable: true },
				currentOperation: { configurable: true, value: null, writable: true },
			})
		}

		this.assetMap = {}
	},

	markAsset(next: any, id: any, owned: any, copyTo?: any) {
		if (next.type === "bundles") {
			id = "b" + id
		}

		if (owned) {
			;(this.assetMap as Record<string, any>)[id] = true
		} else {
			delete (this.assetMap as Record<string, any>)[id]
		}

		if (copyTo) {
			copyTo[id] = !!owned
		}
	},

	markDirty() {
		if (!this.markedDirty) {
			this.markedDirty = true

			setTimeout(() => {
				this.markedDirty = false
				btrLocalStorage.setItem("ownerAssetCache", this.data, {
					replacer: (k, v) => (v instanceof Set ? Array.from(v) : v),
				})
			}, 1e3)
		}
	},

	async request(next: any, populate = false, cursor?: any) {
		let nextPageCursor: any[] | null
		let newItems

		if (next.type === "bundles") {
			const json = await RobloxApi.catalog.getUserBundles(this.data.lastUserId, {
				sortOrder: "Desc",
				limit: populate ? 100 : 10,
				cursor: populate ? cursor || "" : "",
			})

			newItems = json.data.map((x: any) => x.id)
			nextPageCursor = json.nextPageCursor
		} else {
			newItems = []
			nextPageCursor = []

			for (const [index, assetTypes] of Object.entries(this.requestedAssetTypes) as [string, any][]) {
				if (cursor && !cursor[index]) {
					continue
				}

				const json = await RobloxApi.inventory.getUserInventory(this.data.lastUserId, {
					assetTypes: assetTypes.join(","),
					sortOrder: "Desc",
					limit: populate ? 100 : 10,
					cursor: populate ? cursor[index] || "" : "",
				})

				newItems.push(...json.data.map((x: any) => x.assetId))

				if (json.nextPageCursor) {
					;(nextPageCursor as Record<string, any>)[index] = json.nextPageCursor
				}
			}

			if (nextPageCursor.length === 0) {
				nextPageCursor = null
			}
		}

		return [newItems, nextPageCursor]
	},

	async update(onchange: (...args: any[]) => void) {
		if (loggedInUser === -1) {
			return
		}

		if (this.data.lastUserId && this.data.lastUserId !== loggedInUser) {
			this.resetData()
		}

		this.data.lastUserId = loggedInUser

		const list: any[] = Object.values(this.data.types)
		const promises: any[] = []

		for (const next of list as any[]) {
			let operation = next.currentOperation

			if (!operation) {
				const timeUntilPopulate = 300e3 - (Date.now() - next.lastPopulate)
				const timeUntilUpdate = 5e3 - (Date.now() - next.lastUpdate)

				if (timeUntilPopulate > 0 && timeUntilUpdate > 0) {
					continue
				}

				operation = next.currentOperation = {
					onchange: [],
					promise: null,
				}

				let changes: Record<string, any> = {}

				const pushChanges = () => {
					if (Object.keys(changes).length) {
						for (const fn of operation.onchange) {
							fn(changes)
						}

						changes = {}
					}
				}

				if (timeUntilPopulate <= 0) {
					operation.promise = new Promise((resolve, reject) => {
						// The body settles the promise and then keeps running, so it cannot
						// simply become an async function that returns. Keep the executor
						// synchronous and attach the async body, so a throw rejects rather
						// than leaving the promise pending forever.
						const run = async () => {
							const removedSet = new Set(next.list)
							let cursor = ""

							while (true) {
								let newItems, newCursor

								for (let i = 0; i < 3; i++) {
									try {
										;[newItems, newCursor] = await this.request(next, true, cursor)
										break
									} catch (ex) {
										console.error(ex)
										await new Promise((resolve) => setTimeout(resolve, 2e3))
									}
								}

								if (!newItems) {
									next.currentOperation = null
									resolve(false)
									break
								}

								for (const id of newItems) {
									removedSet.delete(id)

									next.list.add(id)
									this.markAsset(next, id, true, changes)
								}

								if (!newCursor) {
									break
								}
								cursor = newCursor
								pushChanges()
							}

							for (const id of removedSet) {
								this.markAsset(next, id, false, changes)
							}

							next.currentOperation = null
							next.lastPopulate = Date.now()
							next.lastUpdate = Date.now() // Populate also works as an update
							this.markDirty()

							pushChanges()
							resolve(true)
						}

						run().catch(reject)
					})
				} else {
					operation.promise = new Promise((resolve, reject) => {
						// The body settles the promise and then keeps running, so it cannot
						// simply become an async function that returns. Keep the executor
						// synchronous and attach the async body, so a throw rejects rather
						// than leaving the promise pending forever.
						const run = async () => {
							try {
								const [newItems] = await this.request(next, false)

								for (const id of newItems) {
									next.list.add(id)
									this.markAsset(next, id, true, changes)
								}
							} catch (ex) {
								console.error(ex)
								next.currentOperation = null
								resolve(false)
								return
							}

							next.currentOperation = null
							next.lastUpdate = Date.now()
							this.markDirty()

							pushChanges()
							resolve(true)
						}

						run().catch(reject)
					})
				}
			}

			if (onchange) {
				operation.onchange.push(onchange)
			}
			promises.push(operation.promise)
		}

		return Promise.all(promises)
	},

	init() {
		if (this.initialized) {
			return
		}

		this.initialized = true
		this.resetData()

		try {
			const savedCache = btrLocalStorage.getItem<{ types?: Record<string, any> }>("ownerAssetCache")

			if (savedCache) {
				if (savedCache.types) {
					for (const [type, next] of Object.entries(this.data.types) as [string, any][]) {
						const savedNext = savedCache.types[type]
						if (!savedNext) {
							continue
						}

						Object.assign(next, savedNext)

						if (Array.isArray(next.list)) {
							next.list = new Set(next.list)
						}

						for (const id of next.list) {
							this.markAsset(next, id, true)
						}
					}

					delete savedCache.types
				}

				Object.assign(this.data, savedCache)
			}
		} catch (ex) {
			console.error(ex)
		}

		return this
	},
}

pageInit.catalog = () => {
	if (SETTINGS.get("general.hoverPreview")) {
		loadOptionalFeature("previewer").then(({ HoverPreview }) => {
			HoverPreview.register(".catalog-item-container", ".item-card-thumb-container", true)
		})
	}

	if (!SETTINGS.get("catalog.enabled")) {
		return
	}

	if (SETTINGS.get("catalog.showOwnedAssets")) {
		let currentRequest: any

		injectScript.listen("checkOwnedAsset", (assetId: number) => {
			if (!currentRequest) {
				currentRequest = []

				setImmediate(() => {
					const assetIds = currentRequest
					currentRequest = null

					OwnerAssetCache.init()

					const initData: Record<string, any> = {}

					for (const assetId of assetIds) {
						if ((OwnerAssetCache.assetMap as Record<string, any>)[assetId]) {
							initData[assetId] = true
						}
					}

					injectScript.send("updateOwnedAssets", initData)

					const update = () =>
						OwnerAssetCache.update((changes: any) =>
							injectScript.send("updateOwnedAssets", changes),
						)

					// Roblox says live when what you own changes, whether bought here,
					// in another tab or in an experience. A full recheck finds items gone
					// as well as new ones, which a normal update only does every 5 minutes.
					const recheck = () => {
						for (const next of Object.values(OwnerAssetCache.data.types) as any[]) {
							next.lastPopulate = 0
						}

						void update()
					}

					STORAGE.get("assetOwnershipChangedAt", (data) => {
						const changedAt = Number(data.assetOwnershipChangedAt ?? 0)
						const types = Object.values(OwnerAssetCache.data.types) as any[]

						if (types.some((next) => (next.lastPopulate ?? 0) < changedAt)) {
							recheck()
						} else {
							void update()
						}
					})

					chrome.storage.onChanged.addListener((changes, areaName) => {
						if (areaName === "local" && changes.assetOwnershipChangedAt) {
							recheck()
						}
					})

					currentRequest = null
				})
			}

			currentRequest.push(assetId)
		})

		injectScript.call("showOwnedAssets")
	}
}
