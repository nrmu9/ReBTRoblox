import { loadOptionalFeature } from "@/feat/loadFeature"
import { assert, bufferToString } from "@/core/util"
import { RBXAnimationParser } from "@/rbx/Parser/AnimationParser"
import { RBXMeshParser } from "@/rbx/Parser/MeshParser"
import { RBXModelParser } from "@/rbx/Parser/ModelParser"
import { RobloxApi } from "@/rbx/RobloxApi"

/** A resolved asset location, plus how it was asked for. */
interface AssetRequest {
	strict?: boolean
	location?: string
	id?: number
	hash?: string
	[key: string]: any
}

/** What a loader accepts as the thing to fetch. */
type AssetLoaderRequest = string | number | Record<string, unknown> | URLSearchParams

type AssetLoaderCallback<T> = (value: T | null) => void

/**
 * Named rather than any, so a callback passed in the third position cannot
 * satisfy the params slot. That is what let a 3 argument call match the 4
 * argument overload and type the callback as any.
 */
interface AssetLoadParams {
	format?: string
	cache?: boolean
	async?: boolean
	browserAssetRequest?: boolean
	onProgress?: (...args: any[]) => void
}

/**
 * strict and params are both optional and sorted out at runtime, so the shapes
 * are spelled out rather than collapsed into one signature with any holes.
 */
interface AssetLoader<T> {
	(request: AssetLoaderRequest, cb?: AssetLoaderCallback<T>): Promise<T | null>
	(request: AssetLoaderRequest, params: AssetLoadParams, cb?: AssetLoaderCallback<T>): Promise<T | null>
	(strict: boolean, request: AssetLoaderRequest, cb?: AssetLoaderCallback<T>): Promise<T | null>
	(
		strict: boolean,
		request: AssetLoaderRequest,
		params: AssetLoadParams,
		cb?: AssetLoaderCallback<T>,
	): Promise<T | null>
}

export const AssetCache = (() => {
	const resolveCache: Record<string, any> = {}
	const cdnCache: Record<string, any> = {}

	function resolveAssetUrlParams(request: any, strict = false) {
		let url = request.trim()

		if (url.startsWith("rbxassetid://")) {
			url = `https://www.roblox.com/asset/?id=${url.slice(13)}`
		} else if (url.startsWith("rbxhttp://")) {
			url = `https://www.roblox.com/${url.slice(10)}`
		}

		let urlParams: URLSearchParams | undefined
		let urlInfo

		try {
			urlInfo = new URL(url)
		} catch {}

		if (!urlInfo) {
			throw new TypeError(`Invalid request '${request}'`)
		}

		if (!/^https?:$/.test(urlInfo.protocol)) {
			throw new TypeError(`Invalid request '${request}'`)
		}

		if (urlInfo.hostname.startsWith("assetdelivery.")) {
			if (/^\/+v1\/+asset\/*$/i.test(urlInfo.pathname)) {
				urlParams = urlInfo.searchParams
			}
		} else {
			if (/^\/+asset\/*$/i.test(urlInfo.pathname)) {
				urlParams = urlInfo.searchParams
			}
		}

		if (!urlParams) {
			throw new TypeError(`Invalid request '${request}'`)
		}

		if (strict && urlParams.get("hash")) {
			throw new TypeError(`Invalid request '${request}': hash does not work in strict mode`)
		}

		return urlParams
	}

	/**
	 * Wraps a parser into the cached loader shape.
	 *
	 * Loaders resolve `T | null`: the catch below turns any failure, a dead
	 * asset or a parser that throws, into null. That was invisible while these
	 * were `any`, and callers dereferenced it.
	 *
	 * The overloads exist because the leading `strict` and trailing `params`
	 * are both optional and shuffled at runtime. A single signature put the
	 * callback in the `params` slot, where it typed as any, and the null went
	 * unnoticed all over again.
	 */
	function createMethod<T>(
		constructor: (buffer: ArrayBuffer, request: AssetRequest) => T | Promise<T>,
	): AssetLoader<Awaited<T>> {
		const methodCache: Record<string, Promise<Awaited<T> | null>> = {}

		return ((
			strict?: any,
			request?: any,
			params?: any,
			cb?: (value: Awaited<T> | null) => void,
		): Promise<Awaited<T> | null> => {
			if (typeof strict !== "boolean") {
				cb = params
				params = request
				request = strict
				strict = false
			}

			if (typeof params === "function") {
				cb = params
				params = null
			}

			let resolvePromise: Promise<AssetRequest> & { assetRequest?: AssetRequest }

			if (
				!strict &&
				typeof request === "string" &&
				/^https?:\/\/[^/]+\.rbxcdn\.com\/*[0-9a-fA-F]{32}/i.test(request)
			) {
				const assetRequest: AssetRequest = {
					strict,
					request,
					params,
					cacheKey: request,
					location: request,
				}

				resolvePromise = Promise.resolve(assetRequest)
				resolvePromise.assetRequest = assetRequest
			} else {
				resolvePromise = AssetCache.resolveAsset(strict, request, params)
			}

			assert(resolvePromise.assetRequest, "resolveAsset did not attach its request")
			const cacheKey = resolvePromise.assetRequest.cacheKey
			let methodPromise = methodCache[cacheKey]

			if (!methodPromise) {
				methodPromise = resolvePromise
					.then((assetRequest: AssetRequest) => {
						assert(assetRequest.location, "resolved asset has no location")

						return AssetCache.loadDirect(assetRequest.location, params).then(
							(buffer: ArrayBuffer) => constructor(buffer, assetRequest),
						)
					})
					.catch((err: unknown) => {
						console.error(err)
						return null
					})

				if (params?.cache !== false) {
					methodCache[cacheKey] = methodPromise
				}
			}

			if (typeof cb === "function") {
				methodPromise.then(cb)
			}

			return methodPromise
		}) as AssetLoader<Awaited<T>>
	}

	return {
		resolveAsset: (strict?: any, request?: any, params?: any) => {
			if (typeof strict !== "boolean") {
				params = request
				request = strict
				strict = false
			}

			let urlParams: URLSearchParams | undefined

			if (!strict && Number.isSafeInteger(+request)) {
				urlParams = new URLSearchParams({ id: request })
			} else if (!strict && request instanceof Object) {
				urlParams = new URLSearchParams(request)
			} else if (typeof request === "string") {
				urlParams = resolveAssetUrlParams(request, strict)
			}

			assert(urlParams, `Invalid request ${request}`)
			let cacheKey = urlParams.toString()

			if (params?.format) {
				cacheKey += "@f:" + params.format
			}
			if (params?.browserAssetRequest) {
				cacheKey += "@bar"
			}

			let resolvePromise = resolveCache[cacheKey]

			if (!resolvePromise) {
				const assetRequest: AssetRequest = {
					strict,
					request,
					params,
					cacheKey,
					urlParams: urlParams.toString(),
				}

				resolvePromise = RobloxApi.assetdelivery
					.requestAssetV2(urlParams, {
						format: params?.format,
						browserAssetRequest: params?.browserAssetRequest,
					})
					.then((json: any) => {
						if (!json?.locations?.length) {
							throw new Error(`Unable to download asset "${JSON.stringify(assetRequest)}"`)
						}

						assetRequest.location = json.locations[0].location
						assetRequest.assetTypeId = json.assetTypeId

						return assetRequest
					})

				resolvePromise.assetRequest = assetRequest

				if (params?.cache !== false) {
					resolveCache[cacheKey] = resolvePromise
				}
			}

			return resolvePromise
		},
		loadDirect: (cdnUrl: string, params: any) => {
			if (cdnCache[cdnUrl]) {
				return cdnCache[cdnUrl]
			}

			let cdnPromise = cdnCache[cdnUrl]

			if (!cdnPromise) {
				cdnPromise = fetch(cdnUrl).then((res) => {
					if (!res.ok) {
						throw new Error(`Failed to download asset '${cdnUrl}'`)
					}

					return res.arrayBuffer()
				})

				if (params?.cache !== false) {
					cdnCache[cdnUrl] = cdnPromise
				}
			}

			return cdnPromise
		},

		loadAnimation: createMethod(async (buffer: ArrayBuffer, assetRequest: AssetRequest) => {
			await loadOptionalFeature("parser")

			const findSequence = (array: any[]): any => {
				for (const inst of array) {
					if (inst.ClassName === "KeyframeSequence" || inst.ClassName === "CurveAnimation") {
						return inst
					}

					const sequence = findSequence(inst.Children)
					if (sequence) {
						return sequence
					}
				}

				return null
			}

			if (assetRequest.params?.async) {
				return RBXModelParser.parse(buffer, {
					async: true,
					onProgress: assetRequest.params?.onProgress,
				}).promise!.then((parser: any) => RBXAnimationParser.parse(findSequence(parser.result)))
			}

			return RBXAnimationParser.parse(findSequence(RBXModelParser.parse(buffer).result))
		}),
		loadModel: createMethod(async (buffer: ArrayBuffer, assetRequest: AssetRequest) => {
			await loadOptionalFeature("parser")

			if (assetRequest.params?.async) {
				return RBXModelParser.parse(buffer, {
					async: true,
					onProgress: assetRequest.params?.onProgress,
				}).promise!.then((parser: any) => parser.result)
			}

			return RBXModelParser.parse(buffer).result
		}),
		loadMesh: createMethod(async (buffer: ArrayBuffer, _assetRequest: AssetRequest) => {
			await loadOptionalFeature("parser")
			return RBXMeshParser.parse(buffer)
		}),

		loadImage: createMethod(
			(buffer: ArrayBuffer, assetRequest: AssetRequest) =>
				new Promise<HTMLImageElement>((resolve, reject) => {
					const src = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: "image/png" }))

					const image = new Image()
					image.onerror = () => reject(new Error(`invalid image ${JSON.stringify(assetRequest)}`))
					image.onload = () => resolve(image)
					image.src = src

					if (image.complete) {
						resolve(image)
					}
				}),
		),
		loadBuffer: createMethod((buffer: ArrayBuffer, _assetRequest: AssetRequest) => buffer),
		loadText: createMethod((buffer: ArrayBuffer, _assetRequest: AssetRequest) => bufferToString(buffer)),

		getHashUrl(hash: string, prefix = "c") {
			let code = 31

			for (let n = 0; n < hash.length; n++) {
				code ^= hash.charCodeAt(n)
			}

			return `https://${prefix}${code % 8}.rbxcdn.com/${hash}`
		},
		toAssetUrl(id: number) {
			return `https://assetdelivery.roblox.com/v1/asset/?id=${id}`
		},
		isValidAssetUrl(url: string) {
			try {
				return (resolveAssetUrlParams(url, true), true)
			} catch {}

			return false
		},
		getAssetIdFromUrl(url: string) {
			try {
				return resolveAssetUrlParams(url, true).get("id") ?? null
			} catch {}

			return null
		},
	}
})()
