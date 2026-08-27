import type {
	AssetId,
	BadgeId,
	BundleId,
	CatalogItemRequest,
	GamePassId,
	GroupId,
	CollectionItemType,
	OutfitId,
	PlaceId,
	ThumbnailSize,
	UniverseId,
	UrlParams,
	UserId,
} from "@/rbx/types"
import { backgroundScript, contentScript } from "@/core/messaging"
import { IS_BACKGROUND_PAGE } from "@/core/env"

const invalidXsrfTokens: Record<string, boolean> = {}
let cachedXsrfToken: string | null = null

let backgroundCallCounter = 0

const wrapArgs = async (args: unknown[]) => {
	// Chrome can only send json-able data, so we need to strip out
	// everything else, I guess?
	const valuePromises = new Map()

	const wrapValue = async (value: any): Promise<any> => {
		if (typeof value === "object" && value !== null) {
			if (value instanceof URLSearchParams) {
				return {
					__btrType: "URLSearchParams",
					body: value.toString(),
				}
			}

			if (Array.isArray(value) || value.constructor === Object) {
				if (valuePromises.has(value)) {
					return valuePromises.get(value)
				}

				const valuePromise = Promise.resolve().then(async () => {
					const promises: Promise<unknown>[] = []
					let newObject: any[] | Record<string, any> | undefined

					for (const [key, oldValue] of Object.entries(value) as [string, any][]) {
						promises.push(
							wrapValue(oldValue).then((newValue) => {
								if (newValue !== oldValue) {
									// Clone lazily, on the first value that actually changed. The cast is
									// because Object.entries gives string keys either way, including for
									// the array branch.
									const target = (newObject ??= Array.isArray(value)
										? [...value]
										: { ...value }) as Record<string, any>

									target[key] = newValue
								}
							}),
						)
					}

					await Promise.all(promises)
					return newObject ?? value
				})

				valuePromises.set(value, valuePromise)
				return valuePromise
			}
		} else if (
			typeof value === "boolean" ||
			typeof value === "number" ||
			typeof value === "string" ||
			value === null ||
			value === undefined
		) {
			return value
		}

		console.log(value)
		throw new TypeError("Invalid value passed to wrapArgs")
	}

	return await wrapValue(args)
}

const unwrapArgs = async (args: unknown[]) => {
	const didCheck = new Set()

	const unwrapValue = async (value: any): Promise<any> => {
		if (typeof value === "object" && value !== null) {
			if (value.__btrType === "URLSearchParams") {
				return new URLSearchParams(value.body)
			}

			if (!didCheck.has(value)) {
				didCheck.add(value)

				for (const [key, oldValue] of Object.entries(value) as [string, any][]) {
					const newValue = await unwrapValue(oldValue)

					if (oldValue !== newValue) {
						value[key] = newValue
					}
				}
			}
		}

		return value
	}

	return await unwrapValue(args)
}

const cacheResult = (duration: number, fn: (...args: any[]) => any) => {
	if (typeof duration === "function") {
		fn = duration
		duration = Infinity
	}

	const cache: Record<string, any> = {}

	const cachedFn = (...args: any[]) => {
		let cached = cache[args[0]]
		if (cached && Date.now() < cached.expires) {
			return cached.result
		}

		cached = cache[args[0]] = {
			expires: Date.now() + duration,
			result: fn(...args),
		}

		return cached.result
	}

	cachedFn.uncached = fn

	return cachedFn
}

const backgroundCall = (callback: (...args: any[]) => any) => {
	const messageId = `RobloxApi.${backgroundCallCounter}`
	backgroundCallCounter++

	if (IS_BACKGROUND_PAGE) {
		contentScript.listen({
			[messageId]({ args, xsrf }: { args: unknown[]; xsrf?: string }, respond: (value: any) => void) {
				if (
					xsrf &&
					(!cachedXsrfToken || invalidXsrfTokens[cachedXsrfToken]) &&
					!invalidXsrfTokens[xsrf]
				) {
					cachedXsrfToken = xsrf
				}

				Promise.resolve()
					.then(async () => callback(...(await unwrapArgs(args))))
					.then(
						async (result) => respond({ success: true, result: await wrapArgs(result) }),
						(err) => respond({ success: false, result: err.message }),
					)
			},
		})

		return callback
	}

	// The awaits used to sit inside the Promise executor, so anything they threw
	// was swallowed and the promise never settled. Resolve the arguments first,
	// and route an unwrap failure to reject rather than leaving the caller hanging.
	return async (...args: unknown[]) => {
		if (!cachedXsrfToken) {
			cachedXsrfToken =
				document.querySelector<HTMLMetaElement>("meta[name='csrf-token']")?.dataset.token ?? null
		}

		const wrapped = await wrapArgs(args)

		return new Promise((resolve, reject) => {
			backgroundScript.send(messageId, { args: wrapped, xsrf: cachedXsrfToken }, (result: any) => {
				if (result.success) {
					Promise.resolve(unwrapArgs(result.result)).then(resolve, reject)
				} else {
					reject(result.result)
				}
			})
		})
	}
}

interface XsrfInit extends RequestInit {
	xsrf?: boolean
}

const xsrfFetch = (url: string, init: XsrfInit = {}) => {
	init = { ...init }

	const usingXsrf = init.xsrf

	if (usingXsrf) {
		delete init.xsrf

		if (!init.headers) {
			init.headers = {}
		}

		if (!cachedXsrfToken) {
			cachedXsrfToken =
				document.querySelector<HTMLMetaElement>("meta[name='csrf-token']")?.dataset.token ?? null
		}

		;(init.headers as Record<string, string>)["X-CSRF-TOKEN"] = cachedXsrfToken ?? ""
	}

	return fetch(url, init).then((res) => {
		if (usingXsrf && !res.ok && res.status === 403 && res.headers.get("X-CSRF-TOKEN")) {
			if ((init.headers as Record<string, string>)["X-CSRF-TOKEN"]) {
				invalidXsrfTokens[(init.headers as Record<string, string>)["X-CSRF-TOKEN"]] = true
			}

			cachedXsrfToken = (init.headers as Record<string, string>)["X-CSRF-TOKEN"] =
				res.headers.get("X-CSRF-TOKEN") ?? ""
			return fetch(url, init)
		}

		return res
	})
}

const batchable = (limit: number, callback: any) => {
	const batches: any[] = []

	callback.batch = (list: any, ...args: any[]) => {
		if (!Array.isArray(list)) {
			list = [list]
		}

		let batching = batches.find((x) => {
			if (x.length + list.length > limit) {
				return false
			}
			if (x.args.length !== args.length) {
				return false
			}

			for (let i = 0; i < args.length; i++) {
				if (args[i] !== x.args[i]) {
					return false
				}
			}

			return true
		})

		if (!batching) {
			const batch: any[] & { args?: any; promise?: Promise<any> } = [...list]

			batch.args = args

			batch.promise = new Promise((resolve) => {
				setTimeout(() => {
					batches.splice(batches.indexOf(batch), 1)
					delete batch.promise
					delete batch.args
					resolve(callback(batch, ...args))
				}, 0)
			})

			batches.push(batch)

			return batch.promise
		}

		batching.push(...list)

		return batching.promise
	}

	return callback
}

/** URLSearchParams rejects non string values, so coerce the bag first. */
const toSearchParams = (params?: UrlParams): URLSearchParams => {
	if (params instanceof URLSearchParams) {
		return params
	}
	if (typeof params === "string") {
		return new URLSearchParams(params)
	}
	if (!params) {
		return new URLSearchParams()
	}

	const out = new URLSearchParams()

	for (const [key, value] of Object.entries(params)) {
		out.set(key, String(value))
	}

	return out
}

export const RobloxApi = {
	accountinformation: {
		getRobloxBadges: (userId: UserId) =>
			xsrfFetch(`https://accountinformation.roblox.com/v1/users/${userId}/roblox-badges`, {
				credentials: "include",
			}).then((res) => res.json()),
	},
	assetdelivery: {
		requestAssetV2: (urlParams: UrlParams, params?: any) => {
			if (!IS_BACKGROUND_PAGE && params?.browserAssetRequest) {
				return RobloxApi.assetdelivery.requestAssetV2_bg(urlParams, params)
			}

			if (typeof urlParams === "string" || typeof urlParams === "number") {
				urlParams = { id: urlParams }
			}
			if (!(urlParams instanceof URLSearchParams)) {
				urlParams = toSearchParams(urlParams)
			}

			const headers: Record<string, string> = {}
			if (params?.format) {
				headers["Roblox-AssetFormat"] = params.format
			}
			if (params?.browserAssetRequest) {
				headers["Roblox-Browser-Asset-Request"] = "true"
			}

			return xsrfFetch(`https://assetdelivery.roblox.com/v2/asset/?${urlParams.toString()}`, {
				credentials: "include",
				headers: headers,
			}).then((res) => res.json())
		},

		requestAssetV2_bg: backgroundCall((...args: any[]) =>
			(RobloxApi.assetdelivery.requestAssetV2 as any)(...args),
		),
	},
	avatar: {
		getAvatarRules: () =>
			xsrfFetch(`https://avatar.roblox.com/v1/avatar-rules`, {
				credentials: "include",
			}).then((res) => res.json()),

		// hits rate limits when requested from page, so doing backgroundCall
		getOutfitDetails: (outfitId: OutfitId) =>
			xsrfFetch(`https://avatar.roblox.com/v3/outfits/${outfitId}/details`, {
				credentials: "include",
			}).then((res) => res.json()),

		getUserAvatar: (userId: UserId) =>
			xsrfFetch(`https://avatar.roblox.com/v2/avatar/users/${userId}/avatar`, {
				credentials: "include",
			}).then((res) => res.json()),

		getCurrentAvatar: () =>
			xsrfFetch(`https://avatar.roblox.com/v2/avatar/avatar`, {
				credentials: "include",
			}).then((res) => res.json()),

		setBodyColors: (bodyColor3s: Record<string, string>) =>
			xsrfFetch(`https://avatar.roblox.com/v2/avatar/set-body-colors`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(bodyColor3s),
				xsrf: true,
			}).then((res) => res.json()),

		renderAvatar: (request: unknown) =>
			xsrfFetch(`https://avatar.roblox.com/v1/avatar/render`, {
				method: "POST",
				credentials: "include",
				body: JSON.stringify(request),
				xsrf: true,
			}).then((res) => res.json()),
	},
	badges: {
		getBadges: (userId: UserId, sortOrder?: string, limit?: number, cursor?: string) =>
			xsrfFetch(
				`https://badges.roblox.com/v1/users/${userId}/badges?sortOrder=${sortOrder}&limit=${limit}&cursor=${cursor || ""}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),

		getBadgeDetails: cacheResult(10e3, (badgeId: BadgeId) =>
			xsrfFetch(`https://badges.roblox.com/v1/badges/${badgeId}`, {
				credentials: "include",
			}).then((res) => res.json()),
		),

		getAwardedDates: (userId: UserId, badgeIds: BadgeId[]) =>
			xsrfFetch(
				`https://badges.roblox.com/v1/users/${userId}/badges/awarded-dates?badgeIds=${badgeIds.join(",")}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),

		deleteBadge: (badgeId: BadgeId) =>
			xsrfFetch(`https://badges.roblox.com/v1/user/badges/${badgeId}`, {
				method: "DELETE",
				credentials: "include",
				xsrf: true,
			}).then((res) => res.json()),
	},
	catalog: {
		getItemDetails: (items: CatalogItemRequest[]) =>
			xsrfFetch(`https://catalog.roblox.com/v1/catalog/items/details`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ items }),
				xsrf: true,
			}).then((res) => res.json()),

		getBundleDetails: cacheResult(10e3, (bundleId: BundleId) =>
			xsrfFetch(`https://catalog.roblox.com/v1/bundles/${bundleId}/details`, {
				credentials: "include",
			}).then((res) => res.json()),
		),

		getUserBundles: (userId: UserId, urlParams?: UrlParams) =>
			xsrfFetch(
				`https://catalog.roblox.com/v1/users/${userId}/bundles?${toSearchParams(urlParams).toString()}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),

		getFavorites: (userId: UserId, assetType: number, limit = 10, cursor = "") =>
			xsrfFetch(
				`https://catalog.roblox.com/v1/favorites/users/${userId}/favorites/${assetType}/assets?limit=${limit}&cursor=${cursor}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
	},
	chat: {
		getUserConversations: (pageNumber = 1, pageSize = 10) =>
			xsrfFetch(
				`https://chat.roblox.com/v2/get-user-conversations?pageNumber=${pageNumber}&pageSize=${pageSize}`,
				{
					credentials: "include",
					xsrf: true,
				},
			).then((res) => res.json()),

		markAsRead: (conversationId: number) =>
			xsrfFetch(`https://chat.roblox.com/v2/mark-as-read`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ conversationId: conversationId }),
				xsrf: true,
			}).then((res) => res.json()),
	},
	develop: {},
	economy: {
		getAssetDetails: cacheResult(10e3, (assetId: AssetId) =>
			xsrfFetch(`https://economy.roblox.com/v2/assets/${assetId}/details`, {
				credentials: "include",
			}).then((res) => res.json()),
		),
	},
	friends: {
		getFriends: (userId: UserId) =>
			xsrfFetch(`https://friends.roblox.com/v1/users/${userId}/friends`, {
				credentials: "include",
			}).then((res) => res.json()),
	},
	gamepasses: {
		getGamepassDetails: cacheResult(
			10e3,
			backgroundCall((gamepassId: GamePassId) =>
				xsrfFetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/details`, {
					credentials: "include",
				}).then((res) => res.json()),
			),
		),
		getGamepassProductInfo: cacheResult(
			10e3,
			backgroundCall((gamepassId: GamePassId) =>
				xsrfFetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/product-info`, {
					credentials: "include",
				}).then((res) => res.json()),
			),
		),
	},
	games: {
		getPlaceDetails: batchable(50, (placeIds: PlaceId[]) =>
			xsrfFetch(
				`https://games.roblox.com/v1/games/multiget-place-details?placeIds=${placeIds.join("&placeIds=")}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
		),

		getGameDetails: batchable(50, (universeIds: UniverseId[]) =>
			xsrfFetch(`https://games.roblox.com/v1/games?universeIds=${universeIds.join("&universeIds=")}`, {
				credentials: "include",
			}).then((res) => res.json()),
		),

		getFavorites: (userId: UserId, limit = 10, cursor = "") =>
			xsrfFetch(
				`https://games.roblox.com/v2/users/${userId}/favorite/games?limit=${limit}&cursor=${cursor}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),

		getUserGames: (userId: UserId, limit = 10, cursor = "") =>
			xsrfFetch(`https://games.roblox.com/v2/users/${userId}/games?limit=${limit}&cursor=${cursor}`, {
				credentials: "include",
			}).then((res) => res.json()),
	},
	groups: {
		getUserGroupRoles: (userId: UserId) =>
			xsrfFetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`, {
				credentials: "include",
			}).then((res) => res.json()),
	},
	inventory: {
		getUserInventory: (userId: UserId, urlParams?: UrlParams) =>
			xsrfFetch(
				`https://inventory.roblox.com/v2/users/${userId}/inventory?${toSearchParams(urlParams).toString()}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),

		getAssetOwners: (assetId: AssetId, limit?: number, cursor?: string) =>
			xsrfFetch(
				`https://inventory.roblox.com/v2/assets/${assetId}/owners?limit=${limit}&cursor=${cursor || ""}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),

		toggleInCollection: (itemType: CollectionItemType, assetId: AssetId, addToCollection = true) =>
			xsrfFetch(`https://inventory.roblox.com/v1/collections/items/${itemType}/${assetId}`, {
				method: addToCollection ? "POST" : "DELETE",
				credentials: "include",
				xsrf: true,
			}).then(
				async (res) => {
					const result = await res.json()
					const errorCode = result?.errors?.[0]?.code

					if (res.ok || errorCode === 7 || errorCode === 8) {
						// adding returns 7 if already in collection, delete returns 8 if not in collection
						return { inCollection: addToCollection }
					}

					return null // return null if error
				},
				() => null, // return null if error
			),
	},
	presence: {
		getPresence: (userIds: UserId[]) =>
			xsrfFetch(`https://presence.roblox.com/v1/presence/users`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userIds }),
			}).then((res) => res.json()),
	},
	privatemessages: {
		getMessages: (pageNumber = 1, pageSize = 20, messageTab = "Inbox") =>
			xsrfFetch(
				`https://privatemessages.roblox.com/v1/messages?pageSize=${pageSize}&messageTab=${messageTab}&pageNumber=${pageNumber}`,
				{
					credentials: "include",
					cache: "no-store",
				},
			).then((res) => res.json()),

		getUnreadCount: () =>
			xsrfFetch(`https://privatemessages.roblox.com/v1/messages/unread/count`, {
				credentials: "include",
				cache: "no-store",
			}).then((res) => res.json()),

		markAsRead: (messageIds: number[]) =>
			xsrfFetch(`https://privatemessages.roblox.com/v1/messages/mark-read`, {
				method: "POST",
				credentials: "include",
				cache: "no-store",
				headers: { "Content-Type": "application/json" },
				xsrf: true,
				body: JSON.stringify({ messageIds }),
			}).then((res) => res.json()),
	},
	thumbnails: {
		getAvatarHeadshots: batchable(100, (userIds: UserId[], size: ThumbnailSize = "150x150") =>
			xsrfFetch(
				`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userIds.join(",")}&size=${size}&format=Png`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
		),

		getAvatarThumbnails: batchable(100, (userIds: UserId[], size: ThumbnailSize = "150x150") =>
			xsrfFetch(
				`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userIds.join(",")}&size=${size}&format=Png`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
		),

		getAssetThumbnails: batchable(100, (assetIds: AssetId[], size?: ThumbnailSize) =>
			xsrfFetch(
				`https://thumbnails.roblox.com/v1/assets?assetIds=${assetIds.join(",")}&size=${size}&format=Png`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
		),

		getGameThumbnails: batchable(
			100,
			(gameIds: UniverseId[], size = "768x432", countPerUniverse = 1, defaults = true) =>
				xsrfFetch(
					`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${gameIds.join(",")}&size=${size}&countPerUniverse=${countPerUniverse}&defaults=${defaults}&format=Png`,
					{
						credentials: "include",
					},
				).then((res) => res.json()),
		),

		getGroupIcons: batchable(
			100,
			(groupIds: GroupId[], size: ThumbnailSize = "150x150", isCircular = false) =>
				xsrfFetch(
					`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${groupIds.join(",")}&size=${size}&format=Png&isCircular=${isCircular}`,
					{
						credentials: "include",
					},
				).then((res) => res.json()),
		),

		getBadgeIcons: batchable(100, (badgeIds: BadgeId[], size: ThumbnailSize = "150x150") =>
			xsrfFetch(
				`https://thumbnails.roblox.com/v1/badges/icons?badgeIds=${badgeIds.join(",")}&size=${size}&format=Png`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
		),

		getGameIcons: batchable(100, (gameIds: UniverseId[], size: ThumbnailSize = "150x150") =>
			xsrfFetch(
				`https://thumbnails.roblox.com/v1/games/icons?universeIds=${gameIds.join(",")}&size=${size}&format=Png`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
		),

		getPlaceIcons: batchable(
			100,
			(placeIds: PlaceId[], size: ThumbnailSize = "150x150", isCircular = false) =>
				xsrfFetch(
					`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeIds.join(",")}&size=${size}&format=Png&isCircular=${isCircular}`,
					{
						credentials: "include",
					},
				).then((res) => res.json()),
		),

		batch: (requests: unknown[]) =>
			xsrfFetch(`https://thumbnails.roblox.com/v1/batch`, {
				credentials: "include",
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requests),
			}).then((res) => res.json()),
	},
	users: {
		getUserDetails: (userIds: UserId[]) =>
			xsrfFetch(`https://users.roblox.com/v1/users`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userIds: userIds }),
			}).then((res) => res.json()),

		getUsersByUsernames: (usernames: string[], excludeBannedUsers = true) =>
			xsrfFetch(`https://users.roblox.com/v1/usernames/users`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ usernames, excludeBannedUsers }),
			}).then((res) => res.json()),
	},
	userProfiles: {
		getProfiles: (userIds: UserId[], fields: string[]) =>
			xsrfFetch(`https://apis.roblox.com/user-profile-api/v1/user/profiles/get-profiles`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userIds, fields }),
			}).then((res) => res.json()),
	},
	toolboxService: {
		getFavorites: (userId: UserId, assetTypeId: number, limit = 10, cursor = "") =>
			xsrfFetch(
				`https://apis.roblox.com/toolbox-service/v1/favorites/user/${userId}/${assetTypeId}?limit=${limit}&cursor=${cursor}`,
				{
					credentials: "include",
				},
			).then((res) => res.json()),
	},
	www: {
		deleteAssetFromInventory: (assetId: AssetId) =>
			xsrfFetch(`https://www.roblox.com/asset/delete-from-inventory`, {
				method: "POST",
				credentials: "include",
				body: toSearchParams({ assetId }),
				xsrf: true,
			}).then((res) => res.json()),

		revertPlaceToVersion: (versionId: number) =>
			xsrfFetch(`https://www.roblox.com/places/revert`, {
				method: "POST",
				credentials: "include",
				body: toSearchParams({ assetVersionID: versionId }),
				xsrf: true,
			}).then((res) => !!res.ok),

		shutdownAllInstances: (placeId: PlaceId, replaceInstances?: boolean) =>
			xsrfFetch(`https://www.roblox.com/games/shutdown-all-instances`, {
				method: "POST",
				credentials: "include",
				body: new URLSearchParams({
					placeId: String(placeId),
					replaceInstances: String(!!replaceInstances),
				}),
				xsrf: true,
			}).then((res) => !!res.ok),
	},
}
