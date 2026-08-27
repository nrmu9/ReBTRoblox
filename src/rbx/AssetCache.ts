import { loadOptionalFeature } from "@/feat/loadfeature"
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

	function createMethod(constructor: any) {
		const methodCache: Record<string, any> = {}

		return (strict?: any, request?: any, params?: any, cb?: any) => {
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
		}
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
		loadMesh: createMethod(async (buffer: ArrayBuffer, assetRequest: AssetRequest) => {
			await loadOptionalFeature("parser")
			return RBXMeshParser.parse(buffer)
		}),

		loadImage: createMethod(
			(buffer: ArrayBuffer, assetRequest: AssetRequest) =>
				new Promise((resolve, reject) => {
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
		loadBuffer: createMethod((buffer: ArrayBuffer, assetRequest: AssetRequest) => buffer),
		loadText: createMethod((buffer: ArrayBuffer, assetRequest: AssetRequest) => bufferToString(buffer)),

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
