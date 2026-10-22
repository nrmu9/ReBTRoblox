import { settings } from "@/entries/inject/state"
import { contentScript } from "@/entries/inject/messaging"
import { reactHook } from "@/entries/inject/react"

// Injected functions for the server list on game details: the pager and the region and ping labels.

export const serversFunctions: Record<string, (...args: any[]) => any> = {
	pagedServers: () => {
		const largePageSize = 100
		const pageSize = 12

		const btrPager = <Record<string, any>>{
			currentPage: 1,
			targetPage: 1,
			maxPage: 1,
			loading: false,
		}
		const promises: Record<string, any> = {}
		const cursors: any[] = []

		const btrPagerState = reactHook.createGlobalState(btrPager)
		const serverParams = { sortOrder: "Desc", orderBy: "", excludeFullGames: false }

		// Signed in, v2 lists servers in any of Roblox's sorts and carries what
		// its cards show, ping, friends and language. Signed out it has no
		// ping, and Roblox only offers the two v1 can do.
		const isSignedIn = () => !!document.querySelector(`meta[name="user-data"]`)

		const serversUrl = (placeId: number, cursor: string) => {
			const common = `excludeFullGames=${serverParams.excludeFullGames}&limit=${largePageSize}&cursor=${cursor}`

			if (isSignedIn()) {
				const orderBy =
					serverParams.orderBy ||
					(serverParams.sortOrder === "Asc" ? "OccupancyAsc" : "OccupancyDesc")

				return `https://games.roblox.com/v2/games/${placeId}/servers/Public?orderBy=${encodeURIComponent(orderBy)}&${common}`
			}

			return `https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=${serverParams.sortOrder}&${common}`
		}

		const loadLargePage = async (placeId: number, largePageIndex: number) => {
			if (largePageIndex >= cursors.length + 2) {
				throw new Error("Tried to load page with no cursor")
			}

			const cursor = cursors[largePageIndex - 2] ?? ""

			const url = serversUrl(placeId, cursor)
			let promise = promises[url]

			if (!promise) {
				let numRetries = 0

				const tryRetry = async (res: any) => {
					if (res.status === 429 && numRetries < 2) {
						numRetries += 1
						await new Promise((resolve) => setTimeout(resolve, 3e3))
						return fetch(url, { credentials: "include" })
					}

					return res
				}

				promise = promises[url] = fetch(url, { credentials: "include" })
					.then(tryRetry)
					.then((res) => (res.ok ? res.json() : null))
					.catch(() => null)
					.finally(() => delete promises[url])
			}

			const json = await promise

			if (!json) {
				throw new Error("Failed to load")
			}

			const maxServer = (largePageIndex - 1) * largePageSize + json.data.length
			const maxPage = Math.max(1, Math.floor((maxServer - 1) / pageSize) + 1)

			if (json.nextPageCursor) {
				cursors[largePageIndex - 1] = json.nextPageCursor

				if (maxPage >= btrPager.maxPage) {
					btrPager.maxPage = maxPage
					btrPager.foundMaxPage = false
					btrPager.hasMore = true
					btrPagerState.update()
				}
			} else {
				const isMaxPage = json.data.length > 0 || largePageIndex === 1

				if (isMaxPage || maxPage <= btrPager.maxPage) {
					btrPager.maxPage = maxPage
					btrPager.foundMaxPage = json.data.length > 0 || largePageIndex === 1
					btrPager.hasMore = false
					btrPagerState.update()
				}
			}

			return json
		}

		const updateMaxPage = async (placeId: number, skipPageIndex: number) => {
			const largePageIndex = Math.min(
				Math.floor((btrPager.maxPage * pageSize - 1) / largePageSize) + 1,
				cursors.length + (btrPager.foundMaxPage ? 1 : 0),
			)

			if (largePageIndex === skipPageIndex) {
				return
			}

			const attemptFindMaxPage = async () => {
				for (let i = largePageIndex; i >= 1; i--) {
					await loadLargePage(placeId, i)

					if (btrPager.foundMaxPage || btrPager.hasMore) {
						break
					}
				}
			}

			btrPager.updatingMaxPage = true
			btrPagerState.update()

			return attemptFindMaxPage().finally(() => {
				btrPager.updatingMaxPage = false
				btrPagerState.update()
			})
		}

		const loadServers = async (placeId: number) => {
			const largePages: Record<string, any> = {}

			outer: while (true) {
				const targetPage = btrPager.targetPage

				const serversFrom = (targetPage - 1) * pageSize + 1
				const serversTo = serversFrom + pageSize - 1

				const largeFrom = Math.min(
					cursors.length + 1,
					Math.floor((serversFrom - 1) / largePageSize) + 1,
				)
				let largeTo = Math.floor((serversTo - 1) / largePageSize) + 1

				for (let largePageIndex = largeFrom; largePageIndex <= largeTo; largePageIndex++) {
					const json = largePages[largePageIndex]

					if (!json) {
						largePages[largePageIndex] = await loadLargePage(placeId, largePageIndex)
						continue outer
					}

					if (!json.nextPageCursor) {
						const maxServer = (largePageIndex - 1) * largePageSize + json.data.length
						const maxPage = Math.max(1, Math.floor((maxServer - 1) / pageSize) + 1)

						if (maxPage < targetPage) {
							btrPager.targetPage = maxPage
							btrPagerState.update()
							continue outer
						}

						largeTo = largePageIndex
						break
					}
				}

				btrPager.currentPage = targetPage
				btrPagerState.update()

				const result: any[] = []

				for (let largePageIndex = largeFrom; largePageIndex <= largeTo; largePageIndex++) {
					const json = largePages[largePageIndex]
					const startIndex = (largePageIndex - 1) * largePageSize

					result.push(
						...json.data.slice(
							Math.max(0, serversFrom - 1 - startIndex),
							Math.max(0, serversTo - startIndex),
						),
					)
				}

				if (!btrPager.updatingMaxPage) {
					updateMaxPage(placeId, largeTo)
				}

				return result
			}
		}

		let getGameInstancesPromise: Promise<any> | null = null
		const btrGetPublicGameInstances = (placeId: number, cursor: string, params: any) => {
			if (!params?.btrRefresh) {
				const sortOrder = params?.sortOrder === "Asc" ? "Asc" : "Desc"
				const orderBy = typeof params?.orderBy === "string" ? params.orderBy : ""
				const excludeFullGames = !!params?.excludeFullGames

				if (
					serverParams.sortOrder !== sortOrder ||
					serverParams.orderBy !== orderBy ||
					serverParams.excludeFullGames !== excludeFullGames
				) {
					getGameInstancesPromise = null

					serverParams.sortOrder = sortOrder
					serverParams.orderBy = orderBy
					serverParams.excludeFullGames = excludeFullGames

					// The cursors and page count belong to the old order.
					cursors.length = 0
					btrPager.maxPage = 1
					btrPager.foundMaxPage = false
					btrPager.hasMore = false
					btrPager.targetPage = 1
				}
			}

			if (!getGameInstancesPromise) {
				btrPager.loading = true
				btrPagerState.update()

				const thisPromise = (getGameInstancesPromise = loadServers(placeId)
					.then(
						(servers) => ({
							data: {
								nextPageCursor: btrPager.currentPage < btrPager.maxPage ? "idk" : null,
								data: servers,
							},
						}),
						() => null,
					)
					.finally(() => {
						if (getGameInstancesPromise === thisPromise) {
							btrPager.loading = false
							btrPagerState.update()

							getGameInstancesPromise = null
						}
					}))
			}

			return getGameInstancesPromise
		}

		const btrPagerConstructor = ({
			refreshGameInstances,
		}: {
			refreshGameInstances: (...args: any[]) => any
		}) => {
			const btrPager = reactHook.useGlobalState(btrPagerState)

			const canPrev = !btrPager.loading && btrPager.currentPage > 1
			const canNext =
				!btrPager.loading &&
				(!btrPager.foundMaxPage || btrPager.currentPage < (btrPager.maxPage ?? 2))

			const inputRef = React.useRef()

			const updateInputWidth = () => {
				inputRef.current.style.width = "0px"
				inputRef.current.style.width = `${Math.max(32, Math.min(100, inputRef.current.scrollWidth + 12))}px`
			}

			React.useEffect(updateInputWidth, [])

			React.useEffect(() => {
				inputRef.current.value = btrPager.currentPage
			}, [btrPager.currentPage])

			const submit = (pressedEnter: boolean) => {
				const num = parseInt(inputRef.current.value, 10)

				if (Number.isSafeInteger(num) && (pressedEnter || btrPager.targetPage !== num)) {
					btrPager.targetPage = Math.max(1, num)
					refreshGameInstances({ btrRefresh: true })
				} else {
					inputRef.current.value = btrPager.currentPage
				}
			}

			return React.createElement(
				"div",
				{ className: "btr-pager-holder btr-server-pager" },
				React.createElement(
					"ul",
					{ className: "btr-pager" },

					React.createElement(
						"li",
						{ className: `btr-pager-first` },
						React.createElement(
							"button",
							{
								className: "btn-generic-first-page-sm",
								disabled: !canPrev,
								onClick() {
									if (!canPrev) {
										return
									}
									btrPager.targetPage = 1
									refreshGameInstances({ btrRefresh: true })
								},
							},
							React.createElement("span", { className: "icon-first-page" }),
						),
					),

					React.createElement(
						"li",
						{ className: `btr-pager-prev` },
						React.createElement(
							"button",
							{
								className: "btn-generic-left-sm",
								disabled: !canPrev,
								onClick() {
									if (!canPrev) {
										return
									}
									btrPager.targetPage = Math.max(1, btrPager.currentPage - 1)
									refreshGameInstances({ btrRefresh: true })
								},
							},
							React.createElement("span", { className: "icon-left" }),
						),
					),

					React.createElement(
						"li",
						{ className: `btr-pager-mid` },
						React.createElement("span", {}, "Page"),
						React.createElement("input", {
							className: "btr-pager-cur",
							type: "text",
							ref: inputRef,

							onChange() {
								updateInputWidth()
							},

							onKeyDown(e: any) {
								if (e.which === 13) {
									submit(true)
									e.target.blur()
								}
							},

							onBlur(_e: any) {
								submit(false)
							},
						}),
						React.createElement(
							"span",
							{},
							` of `,

							React.createElement(
								"span",
								{
									className: "btr-pager-total",
								},
								btrPager.foundMaxPage
									? `${btrPager.maxPage}`
									: btrPager.maxPage > 1
										? `${btrPager.maxPage}+`
										: "1",
							),
						),
					),

					React.createElement(
						"li",
						{ className: `btr-pager-next` },
						React.createElement(
							"button",
							{
								className: "btn-generic-right-sm",
								disabled: !canNext,
								onClick() {
									if (!canNext) {
										return
									}
									btrPager.targetPage = btrPager.currentPage + 1
									refreshGameInstances({ btrRefresh: true })
								},
							},
							React.createElement("span", { className: "icon-right" }),
						),
					),

					React.createElement(
						"li",
						{ className: `btr-pager-last` },
						React.createElement(
							"button",
							{
								className: "btn-generic-last-page-sm",
								disabled: !canNext,
								onClick() {
									if (!canNext) {
										return
									}
									btrPager.targetPage = Math.max(
										btrPager.maxPage ?? 1,
										btrPager.currentPage + 50,
									)
									refreshGameInstances({ btrRefresh: true })
								},
							},
							React.createElement("span", { className: "icon-last-page" }),
						),
					),
				),
			)
		}

		const globalServerRegions: Record<string, any> = {}
		const onRegionsChanged = new Set()

		contentScript.listen("setServerRegion", (jobId, details) => {
			globalServerRegions[jobId] = details

			for (const fn of onRegionsChanged) {
				;(fn as any)()
			}
		})

		const regionSetting = ((value: any) =>
			value === true ? "both" : value === false || !value ? "none" : value)(
			settings.gamedetails.showServerRegion,
		)
		const addServerPager = settings.gamedetails.addServerPager

		reactHook.hijackConstructor(
			(props: any) => props.getGameServers,
			(target: any, thisArg: any, args: any[]) => {
				const props = args[0]

				if (addServerPager && props.type === "public") {
					props.getGameServers = btrGetPublicGameInstances
				}

				return target.apply(thisArg, args)
			},
		)

		reactHook.hijackConstructor(
			(props: any) => props.loadMoreGameInstances && "headerTitle" in props,
			(target: any, thisArg: any, args: any[]) => {
				const props = args[0]

				if (addServerPager && props.type === "public") {
					props.btrPagerEnabled = true
					props.showLoadMoreButton = false
				}

				const result = target.apply(thisArg, args)

				try {
					const list = reactHook.queryElement(result, (x: any) =>
						x.props.id?.includes("running-games"),
					)

					if (props.btrPagerEnabled) {
						list.props.children.push(
							React.createElement(btrPagerConstructor, {
								refreshGameInstances: props.refreshGameInstances,
							}),
						)
					}

					const ul = reactHook.queryElement(list, (x: any) => x.type === "ul", 5)
					const servers = ul?.props?.children

					if (servers) {
						for (const server of [servers].flat()) {
							if (server?.props) {
								server.props.ping = props?.gameInstances?.find(
									(x: any) => x.id === server.props.id,
								)?.ping
							}
						}
					}
				} catch (ex) {
					console.error(ex)
				}

				return result
			},
		)

		reactHook.hijackConstructor(
			// GameInstanceCard
			(props: any) => props.gameServerStatus,
			(target: any, thisArg: any, args: any[]) => {
				const props = args[0]
				const placeId = props.placeId
				const jobId = props.id

				const result = target.apply(thisArg, args)

				try {
					// add context menu entry to copy jobid
					const joinBtn = reactHook.queryElement(result, (x: any) =>
						x.props.className?.includes("game-server-join-btn"),
					)
					if (joinBtn) {
						joinBtn.props["data-btr-instance-id"] = jobId
					}

					// add region/ping label
					const status =
						regionSetting !== "none" &&
						reactHook.queryElement(result, (x: any) =>
							x.props.className?.includes("rbx-game-status"),
						)
					if (status) {
						// Roblox leaves the ping out for some servers, which
						// used to read as -1ms.
						if (regionSetting !== "region" && typeof props.ping === "number" && props.ping >= 0) {
							status.props.children += `\nPing: ${props.ping}ms`
						}

						if (regionSetting !== "ping") {
							const [serverDetails, setServerDetails] = React.useState(null)

							React.useEffect(() => {
								const details = globalServerRegions[jobId]

								setServerDetails(globalServerRegions[jobId])
								if (!details?.location) {
									contentScript.send("getServerRegion", placeId, jobId)
								}

								const callback = () => {
									setServerDetails(globalServerRegions[jobId])
								}

								onRegionsChanged.add(callback)
								return () => onRegionsChanged.delete(callback)
							}, [placeId, jobId])

							if (regionSetting === "combined") {
								status.props.children += ` (${
									!serverDetails
										? "Loading"
										: !serverDetails.location
											? serverDetails.statusText
											: serverDetails.location.country.code
								})`
							} else {
								status.props.children += `\nRegion: ${
									!serverDetails
										? "Loading"
										: !serverDetails.location
											? serverDetails.statusText
											: `${serverDetails.location.city}, ${
													serverDetails.location.country.name === "United States"
														? serverDetails.location.region.code
														: serverDetails.location.country.code
												}`
								}`
							}

							status.props.title = !serverDetails
								? "Loading"
								: !serverDetails.location
									? serverDetails.statusTextLong
									: serverDetails.location.country.name === "United States"
										? `${serverDetails.location.city}, ${serverDetails.location.region.name}, ${serverDetails.location.country.name}`
										: `${serverDetails.location.city}, ${serverDetails.location.country.name}`

							if (serverDetails?.address) {
								status.props.title += ` (${serverDetails?.address})`
							}
						}
					}
				} catch (ex) {
					console.error(ex)
				}

				return result
			},
		)

		reactHook.hijackUseStateGlobal(
			(value: any, _index: number) => ["tab-about", "tab-game-instances", "tab-store"].includes(value),
			(value: any, _initial: any) => {
				if (value === "tab-about" && window.location.hash !== "#!/about") {
					return "tab-game-instances"
				}

				return value
			},
		)
	},
}
