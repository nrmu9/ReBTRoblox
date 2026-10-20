import { dateSince } from "@/core/date"
import { html } from "@/core/html"
import { btrLocalStorage } from "@/core/storage"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { ContextMenu } from "@/feat/contextMenu"
import { RobuxToCash } from "@/feat/robuxToCash"
import { clockFormat } from "@/feat/clock"
import { keepTrackLabel } from "@/feat/activity/trackMenu"
import { openTracked } from "@/feat/activity/trackDialog"
import { SETTINGS } from "@/feat/settings"
import {
	formatNumber,
	formatUrlName,
	getAssetFileType,
	initExplorer,
	keepText,
	loggedInUserPromise,
	onMouseEnter,
	onPageLoad,
	onPageReset,
	redirectEvents,
	startDownload,
} from "@/pages/common"
import { AssetCache } from "@/rbx/AssetCache"
import { AssetType } from "@/rbx/Constants"
import { RobloxApi } from "@/rbx/RobloxApi"
import { getCachedServerLocation, getServerDetails } from "@/feat/serverDetails"
import { waitForRobloxResponse } from "@/feat/robloxResponses"
import { queryReq } from "@/core/query"

// Roblox rounds the big numbers on this page: visits turn into "1.8M+" and the
// like counts into "10K+". The votes already carry the real number in their
// title attribute, visits take one games API call.
const exactText = (value: unknown) => {
	const number = typeof value === "string" ? Number.parseInt(value, 10) : value
	return typeof number === "number" && Number.isSafeInteger(number) ? formatNumber(number) : null
}

const showExactCounts = () => {
	for (const selector of ["#vote-up-text", "#vote-down-text"]) {
		document.$watch(
			selector,
			// Voting rewrites the panel's text, and the title with it.
			(elem: HTMLElement) => keepText(elem, () => exactText(elem.getAttribute("title")), ["title"]),
			{ continuous: true },
		)
	}

	document.$watch("#game-detail-meta-data", (meta: HTMLElement) => {
		const universeId = Number.parseInt(meta.dataset.universeId ?? "", 10)

		if (!Number.isSafeInteger(universeId)) {
			return
		}

		// Roblox asks for the game's details itself; that answer carries the visits.
		waitForRobloxResponse(
			(url, json) =>
				url.includes("games.roblox.com/v1/games?universeIds=") &&
				json?.data?.some((game: any) => game.id === universeId),
		)
			.then((json) => json ?? RobloxApi.games.getGameDetails.batch(universeId))
			.then((json: any) => {
				const visits = json?.data?.find((x: any) => x.id === universeId)?.visits

				if (exactText(visits) === null) {
					return
				}

				document.$watch(
					"#game-visits-count",
					(elem: HTMLElement) => keepText(elem, () => exactText(visits)),
					{ continuous: true },
				)
			})
	})
}

const PUBLIC_SERVERS = "#rbx-public-running-games"

/**
 * Remembers whether you disliked this game, for Hide Disliked Games on Home.
 * Read from the vote buttons, as there is no list of your votes to ask for,
 * and again whenever they change.
 */
const trackDislike = () => {
	document.$watch("#voting-section", (section: HTMLElement) => {
		const placeId = section.dataset.targetId

		if (!placeId) {
			return
		}

		const update = () => {
			// Read on every change, so it settles on the vote once it has loaded.
			const disliked = !!section.$find(".icon-dislike.selected")
			const list = new Set(btrLocalStorage.getItem<string[]>("dislikedPlaces") ?? [])

			if (disliked !== list.has(placeId)) {
				if (disliked) {
					list.add(placeId)
				} else {
					list.delete(placeId)
				}

				btrLocalStorage.setItem("dislikedPlaces", [...list])
			}
		}

		new MutationObserver(update).observe(section, {
			subtree: true,
			attributes: true,
			attributeFilter: ["class"],
		})
		update()
	})
}

/** A server's region, written the way the server cards write it: states for the US. */
const regionLabel = (location: any): string =>
	location
		? `${location.city}, ${location.country.name === "United States" ? location.region.code : location.country.code}`
		: ""

const lookUpLocation = (placeId: number, jobId: string): Promise<any> =>
	new Promise((resolve) =>
		getServerDetails(placeId, jobId, (details: any) => resolve(details?.location ?? null)),
	)

/** How many servers Join Smallest may look up to find one in the chosen region. */
const REGION_LOOKUPS = 10

/** A button beside Refresh that joins the emptiest public server with room. */
const addJoinSmallest = (placeId: number) => {
	document.$watchAll(`${PUBLIC_SERVERS} .server-list-container-header`, (header: HTMLElement) => {
		if (header.$find(".btr-join-smallest")) {
			return
		}

		const button = html<HTMLButtonElement>`<button
			type="button"
			class="btn-control-xs btn-min-width btr-join-smallest"
			title="Joins the public server with the fewest players"
		>
			Join Smallest
		</button>`

		const reset = (text: string) => {
			button.textContent = text
			setTimeout(() => {
				button.disabled = false
				button.textContent = "Join Smallest"
			}, 3000)
		}

		button.$on("click", async () => {
			button.disabled = true
			button.textContent = "Finding..."

			try {
				const res = await fetch(
					`https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=Asc&excludeFullGames=true&limit=25`,
					{ credentials: "include" },
				)
				const json = await res.json()

				// Fewest players first, then the best connection among those.
				const candidates = ((json?.data ?? []) as any[])
					.filter((server) => server.playing < server.maxPlayers)
					.toSorted((a, b) => a.playing - b.playing || (a.ping ?? 999) - (b.ping ?? 999))

				// With a region picked in the filter, the smallest server in it. Known
				// regions are free; the rest take a lookup each, so only a few.
				const region = document.querySelector<HTMLSelectElement>(
					`${PUBLIC_SERVERS} .btr-region-filter select`,
				)?.value
				let smallest = region ? null : candidates[0]

				if (region) {
					let lookups = 0

					for (const server of candidates) {
						let location = getCachedServerLocation(server.id)

						if (!location) {
							if (lookups >= REGION_LOOKUPS) {
								continue
							}

							lookups++
							button.textContent = `Checking ${lookups}/${REGION_LOOKUPS}...`
							location = await lookUpLocation(placeId, server.id)
						}

						if (regionLabel(location) === region) {
							smallest = server
							break
						}
					}
				}

				if (smallest) {
					injectScript.call("gamedetailsJoinServer", placeId, smallest.id)
					reset("Joining...")
				} else {
					reset(region ? "None in region" : "No servers")
				}
			} catch {
				reset("Try again")
			}
		})

		const refresh = header.$find(".rbx-refresh")
		if (refresh) {
			refresh.after(button)
		} else {
			header.append(button)
		}
	})
}

/**
 * A button on every server card that copies a link straight into that server,
 * for sending to someone. Roblox's start page takes the server's id.
 */
const addServerLinks = (placeId: number) => {
	document.$watchAll("[data-btr-instance-id]", (join: HTMLElement) => {
		const jobId = join.dataset.btrInstanceId

		if (!jobId || join.parentElement?.$find(":scope > .btr-copy-server-link")) {
			return
		}

		const button = html<HTMLButtonElement>`<button
			type="button"
			class="btn-control-xs btn-full-width btr-copy-server-link"
			title="Copies a link that joins this server"
		>
			Copy Link
		</button>`

		button.$on("click", async (ev: Event) => {
			ev.preventDefault()
			ev.stopPropagation()

			const link = `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${jobId}`

			try {
				await navigator.clipboard.writeText(link)
				button.textContent = "Copied"
			} catch {
				button.textContent = "Couldn't copy"
			}

			setTimeout(() => {
				button.textContent = "Copy Link"
			}, 2000)
		})

		join.after(button)
	})
}

/**
 * A region menu beside Sort By, listing the regions of the servers on screen.
 * It reads the locations Server Info already looked up, so it asks Roblox for
 * nothing more.
 */
const addRegionFilter = () => {
	document.$watchAll(`${PUBLIC_SERVERS} .server-list-options`, (options: HTMLElement) => {
		if (options.$find(".btr-region-filter")) {
			return
		}

		const group = html`<div class="select-group btr-region-filter">
			<label class="select-label text-label">Region</label>
			<div class="rbx-select-group select-group">
				<select class="input-field rbx-select select-option">
					<option value="">All regions</option>
				</select>
			</div>
		</div>`

		const select = group.$req<HTMLSelectElement>("select")
		options.append(group)

		const section = options.closest(PUBLIC_SERVERS)!
		const empty = html`<p class="btr-server-filter-empty text-label">
			No servers from this region on this page
		</p>`

		const apply = () => {
			const list = section.$find(".rbx-public-game-server-item-container")
			if (!list) {
				return
			}

			const regions = new Set<string>()
			let shown = 0

			for (const item of list.$findAll<HTMLElement>(":scope > li")) {
				const jobId = item.$find<HTMLElement>("[data-btr-instance-id]")?.dataset.btrInstanceId
				const location = jobId ? getCachedServerLocation(jobId) : null
				const region = regionLabel(location)

				if (region) {
					regions.add(region)
				}

				const hide = !!select.value && region !== select.value
				item.classList.toggle("btr-server-filtered", hide)
				shown += hide ? 0 : 1
			}

			// The chosen region stays listed even when this page has none of it.
			if (select.value) {
				regions.add(select.value)
			}

			const wanted = ["", ...[...regions].toSorted()]
			const have = [...select.options].map((option) => option.value)

			if (wanted.join("\n") !== have.join("\n")) {
				const value = select.value
				select.replaceChildren(
					...wanted.map((region) => {
						const option = document.createElement("option")
						option.value = region
						option.textContent = region || "All regions"
						return option
					}),
				)
				select.value = value
			}

			if (select.value && !shown) {
				list.after(empty)
			} else {
				empty.remove()
			}
		}

		select.$on("change", apply)

		// Roblox renders the list again on every page, sort and refresh, and the
		// regions arrive one by one, so any change in the list runs this again.
		new MutationObserver((mutations) => {
			if (mutations.some((mutation) => !group.contains(mutation.target) && mutation.target !== empty)) {
				apply()
			}
		}).observe(section, { childList: true, subtree: true, characterData: true })

		apply()
	})
}

pageInit.gamedetails = () => {
	onPageLoad((placeIdString: string) => {
		const placeId = Number.parseInt(placeIdString, 10)

		trackDislike()

		if (SETTINGS.get("gamedetails.serverTools")) {
			addJoinSmallest(placeId)
			addServerLinks(placeId)

			if (["region", "both", "combined"].includes(SETTINGS.get("gamedetails.showServerRegion"))) {
				addRegionFilter()
			}
		}

		if (RobuxToCash.isEnabled()) {
			// Game passes and developer products sit side by side in the store.
			document
				.$watch("#game-store-container")
				.$then()
				.$watch(
					".text-robux",
					(label: any) => {
						const robux = parseInt(label.textContent.replace(/\D/g, ""), 10)

						if (Number.isSafeInteger(robux)) {
							const cash = RobuxToCash.convert(robux)
							label.after(html`<span class="btr-robuxToCash-tile">&nbsp;(${cash})</span>`)
						}
					},
					{ continuous: true },
				)
		}

		document
			.$watch("#content")
			.$then()
			.$watch(">#game-detail-page")
			.$then()
			.$watch("#game-context-menu .dropdown-menu .VisitButtonEditGLI", (placeEdit: HTMLElement) => {
				placeEdit.parentElement!.parentElement!.append(
					html`<li>
						<a class="btr-download-place"><div>Download</div></a>
					</li>`,
				)

				const target = queryReq("#game-context-menu")

				target.$on("click", ".btr-download-place", () => {
					AssetCache.loadBuffer(placeId, (ab: ArrayBuffer | null) => {
						if (!ab) {
							return
						}

						const blobUrl = URL.createObjectURL(new Blob([ab]))

						const splitPath = window.location.pathname.split("/")
						const type = getAssetFileType(9, ab)

						startDownload(blobUrl, `${splitPath[splitPath.length - 1]}.${type}`)
						URL.revokeObjectURL(blobUrl)
					})
				})

				initExplorer(placeId, AssetType.Place).then((btnCont) => {
					if (!btnCont) {
						return
					}

					btnCont.$req(".btr-explorer-button").style.display = "none"
					btnCont.style.position = "absolute"
					btnCont.style.width = `${target.clientWidth}px`
					btnCont.style.height = `${0}px`
					btnCont.style.left = `${target.offsetLeft}px`
					btnCont.style.top = `${target.offsetTop + target.clientHeight}px`

					target.after(btnCont)

					placeEdit.parentElement!.parentElement!.append(
						html`<li>
							<a class="btr-open-in-explorer"><div>Open in Explorer</div></a>
						</li>`,
					)

					target.$on("click", ".btr-open-in-explorer", () => {
						btnCont.$req(".btr-explorer-button").click()
					})
				})
			})
	})

	if (!SETTINGS.get("gamedetails.enabled")) {
		return
	}

	injectScript.call("pagedServers")

	injectScript.call("gamedetails")

	const serverInfo = SETTINGS.get("gamedetails.showServerRegion")

	if (serverInfo && serverInfo !== "none") {
		const requesting: Record<string, any> = {}

		injectScript.listen("getServerRegion", (placeId: number, jobId: string) => {
			if (typeof jobId !== "string" || requesting[jobId]) {
				return
			}
			requesting[jobId] = true

			getServerDetails(placeId, jobId, (details: any) => {
				delete requesting[jobId]
				injectScript.send("setServerRegion", jobId, details)
			})
		})
	}

	if (SETTINGS.get("gamedetails.exactCounts")) {
		onPageLoad(() => showExactCounts())
	}

	onPageReset(() => {
		document.body?.classList.remove("btr-gamedetails")
	})

	onPageLoad((placeIdString: string) => {
		const placeId = Number.parseInt(placeIdString, 10)

		document.$watch("body", (body: HTMLElement) => body.classList.add("btr-gamedetails"))

		// The game's activity, where tracking it starts and stops, is in its
		// ... menu. Only games you can edit come with one, so the rest get one
		// made the way Roblox makes it.
		document.$watch("#game-detail-meta-data", (meta: HTMLElement) => {
			const universeId = Number.parseInt(meta.dataset.universeId ?? "", 10)

			if (!Number.isSafeInteger(universeId)) {
				return
			}

			const item = html`<li class="btr-track-menu-item"><a href="#"></a></li>`
			keepTrackLabel(item.$req("a"), "game", universeId)

			document.$watch(".game-calls-to-action", (actions: HTMLElement) => {
				let menu = actions.$find("#game-context-menu")

				if (!menu) {
					menu = html`<div id="game-context-menu">
						<button
							class="rbx-menu-item btn-generic-more-sm"
							data-toggle="popover"
							data-bind="game-context-menu"
							data-viewport=".game-calls-to-action"
						>
							<span class="icon-more"></span>
						</button>
						<div class="rbx-popover-content" data-toggle="game-context-menu">
							<ul class="dropdown-menu" role="menu"></ul>
						</div>
					</div>`

					actions.prepend(menu)
					injectScript.call("gamedetailsSetupMenu")
				}

				menu.$req(".rbx-popover-content .dropdown-menu").append(item)
			})

			// The open menu is a copy of its list, so the click is caught here.
			document.$on("click", ".btr-track-menu-item a", (ev: MouseEvent) => {
				ev.preventDefault()
				injectScript.call("gamedetailsCloseMenu")
				openTracked(
					"game",
					universeId,
					document.querySelector(".game-title-container h1")?.textContent?.trim() || "Game",
				)
			})
		})

		document
			.$watch("#content")
			.$then()
			.$watch(">#game-detail-page", (container: HTMLElement) => {
				const newContainer = html` <div class="col-xs-12 btr-game-main-container section-content">
					<div class="placeholder-main"></div>
				</div>`

				const midContainer = html` <div class="col-xs-12 btr-mid-container"></div>`

				container
					.$watch(
						["#tab-about", "#tab-game-instances"],
						(aboutTab: HTMLElement, gameTab: HTMLElement) => {
							aboutTab.$req(".text-lead").textContent = "Recommended"

							aboutTab.classList.remove("active")
							gameTab.classList.add("active")

							const parent = aboutTab.parentElement!
							parent.append(aboutTab)
							parent.prepend(gameTab)
						},
					)
					.$watch("#game-instances", (games: HTMLElement) => {
						games.classList.add("active")

						onMouseEnter(games, ".game-server-join-btn", (btn: HTMLElement) => {
							const instanceId = btn.dataset.btrInstanceId

							if (instanceId) {
								ContextMenu.setCustomContextMenu(btn, {
									instanceId: instanceId,
								})
							}
						})
					})
					.$watch(".game-main-content", (mainCont: HTMLElement) => {
						mainCont.classList.remove("section-content")
						mainCont.before(newContainer)
						newContainer.after(midContainer)
						newContainer.$req(".placeholder-main").replaceWith(mainCont)
					})
					.$watch("#about", (about: HTMLElement) => {
						about.classList.remove("active")
					})
					.$watch(
						".game-about-container,#game-details-about-tab-container",
						(cont: HTMLElement) => {
							if (cont.id === "game-details-about-tab-container") {
								// react about tab
								container.$watch(
									"#game-details-about-tab-container",
									(parent: HTMLElement) => {
										midContainer.append(parent)

										parent.$watch("#btr-description-wrapper", (descCont: HTMLElement) => {
											newContainer.append(descCont)
											redirectEvents(descCont, parent)
										})

										parent.$watch(
											"#btr-recommendations-wrapper",
											(recCont: HTMLElement) => {
												queryReq("#about").append(recCont)
												redirectEvents(recCont, parent)
											},
										)
									},
								)
							} else {
								// legacy about tab
								newContainer.append(cont)

								container
									.$watch("#about")
									.$then()
									.$watchAll("*", (child: HTMLElement) => {
										if (child.id === "private-server-container-about-tab") {
											child.style.display = "none"
										} else if (child.id !== "recommended-games-container") {
											midContainer.append(child)
										}
									})
							}
						},
					)

					.$watch(".tab-content", (cont: HTMLElement) => {
						cont.classList.add("section")

						cont.$watchAll(".tab-pane", (pane) => {
							if (pane.id !== "about") {
								pane.classList.add("section-content")
							}
						})
					})
					.$watch(".badge-container", (badges: HTMLElement) => {
						badges.classList.add("btr-badges-container")

						if (SETTINGS.get("gamedetails.compactBadgeStats")) {
							badges.classList.add("btr-compact-stats")
						}

						const badgeQueue: any[] = []
						let ownedTimeout: ReturnType<typeof setTimeout> | undefined

						const updateOwned = async () => {
							const userId = await loggedInUserPromise
							const badgeList = badgeQueue.splice(0, badgeQueue.length)

							return RobloxApi.badges
								.getAwardedDates(
									userId,
									badgeList.map((x) => x.badgeId),
								)
								.then((json) => {
									if (!json?.data) {
										return
									}

									for (const { row, badgeId } of badgeList) {
										const entry = json.data.find((x: any) => x.badgeId === badgeId)

										row.classList.toggle("btr-notowned", !entry)
										row.$find(".btr-unlock-date")?.remove()

										if (entry) {
											const awardedDate = new Date(entry.awardedDate)
											row.$find(".badge-data-container").append(
												html` <span
													class="btr-unlock-date"
													title="${awardedDate.$since()}"
												>
													Unlocked
													${awardedDate.$format(`MMM D, YYYY, ${clockFormat()}`)}
												</span>`,
											)
										}
									}
								})
						}

						badges
							.$watch(">.stack-list")
							.$then()
							.$watchAll(".badge-row", (row: HTMLElement) => {
								const url = row.$req<HTMLAnchorElement>(".badge-image>a").href
								const label = row.$req(".badge-name")
								const link = html<HTMLAnchorElement>`<a href="${url}"
									>${label.textContent}</a
								>`

								label.replaceChildren(link)

								if (SETTINGS.get("gamedetails.compactBadgeStats")) {
									for (const valueLabel of row.$findAll(
										".badge-stats-container .badge-stats-info",
									)) {
										const rarity = valueLabel.textContent.match(
											/^\s*(\d+\.\d+%)\s*\((.*)\)\s*$/,
										)
										if (rarity) {
											valueLabel.textContent = rarity[1]
											valueLabel.title = rarity[2]
										}

										const count = valueLabel.textContent.match(/^\d+$/)
										if (count) {
											valueLabel.textContent = Intl.NumberFormat().format(+count)
										}
									}
								}

								const desc = row.$req("p.para-overflow")
								desc.classList.add("btr-desc-content")
								desc.classList.remove("para-overflow")

								if (desc.scrollHeight > desc.clientHeight) {
									desc.classList.add("btr-desc-overflow")

									const moreBtn = html`<span class="btr-badge-more text-link cursor-pointer"
										>See More</span
									>`
									desc.after(moreBtn)

									moreBtn.$on("click", () => {
										const open = !desc.classList.contains("btr-desc-open")
										desc.classList.toggle("btr-desc-open", open)
										moreBtn.textContent = open ? `See Less` : `See More`
									})
								}

								if (SETTINGS.get("gamedetails.showBadgeOwned")) {
									const match = url.match(/(?:catalog|badges)\/(\d+)\//)
									if (!match) {
										return
									}

									const badgeId = +match[1]
									badgeQueue.push({ row, badgeId })

									clearTimeout(ownedTimeout)
									ownedTimeout = setTimeout(updateOwned, 10)

									row.classList.add("btr-notowned")
								}
							})

						if (SETTINGS.get("gamedetails.showBadgeOwned")) {
							// h3 since the badges list was rebuilt.
							badges.$watch(
								".container-header h2, .container-header h3",
								(header: HTMLElement) => {
									const refresh = html<HTMLButtonElement>`<button
										type="button"
										class="btn-more rbx-refresh refresh-link-icon btn-control-xs btn-min-width"
									>
										Refresh
									</button>`
									header.after(refresh)

									refresh.$on("click", () => {
										if (refresh.getAttribute("disabled")) {
											return
										}

										badgeQueue.splice(0, badgeQueue.length)

										for (const row of badges.$findAll(".badge-row")) {
											const url = row.$req<HTMLAnchorElement>(".badge-image>a").href

											const match = url.match(/(?:catalog|badges)\/(\d+)\//)
											if (!match) {
												continue
											}

											const badgeId = +match[1]
											badgeQueue.push({ row, badgeId })
										}

										if (!badgeQueue.length) {
											return
										}

										refresh.setAttribute("disabled", "")

										updateOwned().finally(() => {
											refresh.removeAttribute("disabled")
										})
									})
								},
							)
						}
					})
					// The rebuilt carousel has no attribute to turn autoplay off, so the
					// first play is paused unless it came from using the carousel.
					.$watch("#game-details-carousel-container", (carousel: HTMLElement) => {
						if (SETTINGS.get("gamedetails.previewVideos") !== "paused") {
							return
						}

						let touched = false

						for (const type of ["pointerdown", "keydown"]) {
							carousel.addEventListener(type, () => (touched = true), { capture: true })
						}

						carousel.addEventListener(
							"play",
							(event) => {
								if (!touched && event.target instanceof HTMLVideoElement) {
									event.target.pause()
								}
							},
							{ capture: true, once: true },
						)
					})
					.$watch("#game-detail-meta-data", (dataCont: HTMLElement) => {
						ContextMenu.setCustomContextMenu(document.documentElement, {
							copyParent: true,
							placeLink: dataCont.dataset.placeId,
							universeLink: dataCont.dataset.universeId,
						})

						if (dataCont.dataset.placeId !== dataCont.dataset.rootPlaceId) {
							const rootPlaceId = dataCont.dataset.rootPlaceId
							const rootPlaceName = dataCont.dataset.placeName ?? ""

							const box = html` <div class="section-content btr-universe-box">
								This place is part of
								<a
									class="btr-universe-name text-link"
									href="/games/${rootPlaceId}/${formatUrlName(rootPlaceName)}"
									>${rootPlaceName || "..."}</a
								>
								<div class="btr-universe-visit-button">
									<a class="btn-secondary-md">Play</a>
								</div>
							</div>`

							box.$req(".btr-universe-visit-button").$on("click", () => {
								injectScript.call("gamedetailsPlayGame", rootPlaceId)
							})

							newContainer.before(box)
						}
					})

				RobloxApi.economy.getAssetDetails(placeId).then((data: any) => {
					if (!data.Updated) {
						return
					}

					container
						.$watch(".game-stat-container,.game-stats-container")
						.$then()
						.$watch(
							".game-stat .text-lead",
							(x: any) => x.previousElementSibling?.textContent === "Created",
							(label: any) => {
								label.title = new Date(data.Created).$format(
									`M/D/YYYY ${clockFormat(true)} (T)`,
								)
							},
						)
						.$watch(
							".game-stat .text-lead",
							(x: any) => x.previousElementSibling?.textContent === "Updated",
							(label: any) => {
								label.classList.remove("date-time-i18n") // Otherwise roblox rewrites the label

								label.title = new Date(data.Updated).$format(
									`M/D/YYYY ${clockFormat(true)} (T)`,
								)
								label.textContent = `${dateSince(data.Updated)}`
							},
						)
				})
			})
	})
}
