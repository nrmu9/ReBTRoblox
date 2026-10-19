import { dateSince } from "@/core/date"
import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { ContextMenu } from "@/feat/contextMenu"
import { RobuxToCash } from "@/feat/robuxToCash"
import { SETTINGS } from "@/feat/settings"
import {
	formatNumber,
	formatUrlName,
	getAssetFileType,
	initExplorer,
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
import { getServerDetails } from "@/feat/serverDetails"
import { queryReq } from "@/core/query"

// Roblox rounds the big numbers on this page: visits turn into "1.8M+" and the
// like counts into "10K+". The votes already carry the real number in their
// title attribute, visits take one games API call.
const exactText = (value: unknown) => {
	const number = typeof value === "string" ? Number.parseInt(value, 10) : value
	return typeof number === "number" && Number.isSafeInteger(number) ? formatNumber(number) : null
}

// Written back whenever the element changes, because voting makes the panel
// rewrite its own text.
const keepExact = (elem: HTMLElement, getText: () => string | null) => {
	const apply = () => {
		const text = getText()

		// A count is a leaf. Never write over something that holds markup.
		if (text !== null && elem.childElementCount === 0 && elem.textContent !== text) {
			elem.textContent = text
		}
	}

	new MutationObserver(apply).observe(elem, {
		attributeFilter: ["title"],
		attributes: true,
		characterData: true,
		childList: true,
		subtree: true,
	})

	apply()
}

const showExactCounts = () => {
	for (const selector of ["#vote-up-text", "#vote-down-text"]) {
		document.$watch(
			selector,
			(elem: HTMLElement) => keepExact(elem, () => exactText(elem.getAttribute("title"))),
			{ continuous: true },
		)
	}

	document.$watch("#game-detail-meta-data", (meta: HTMLElement) => {
		const universeId = Number.parseInt(meta.dataset.universeId ?? "", 10)

		if (!Number.isSafeInteger(universeId)) {
			return
		}

		RobloxApi.games.getGameDetails.batch(universeId).then((json: any) => {
			const visits = json?.data?.find((x: any) => x.id === universeId)?.visits

			if (exactText(visits) === null) {
				return
			}

			document.$watch(
				"#game-visits-count",
				(elem: HTMLElement) => keepExact(elem, () => exactText(visits)),
				{ continuous: true },
			)
		})
	})
}

pageInit.gamedetails = () => {
	onPageLoad((placeIdString: string) => {
		const placeId = Number.parseInt(placeIdString, 10)

		if (RobuxToCash.isEnabled()) {
			document
				.$watch("#rbx-passes-container")
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

	if (SETTINGS.get("gamedetails.showServerRegion")) {
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
													Unlocked ${awardedDate.$format("MMM D, YYYY, h:mm A")}
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
							badges.$watch(".container-header h2", (header: HTMLElement) => {
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
							})
						}
					})
					.$watch("#carousel-game-details", (details: any) => {
						details.setAttribute("data-is-video-autoplayed-on-ready", "false")
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
								label.title = new Date(data.Created).$format("M/D/YYYY h:mm:ss A (T)")
							},
						)
						.$watch(
							".game-stat .text-lead",
							(x: any) => x.previousElementSibling?.textContent === "Updated",
							(label: any) => {
								label.classList.remove("date-time-i18n") // Otherwise roblox rewrites the label

								label.title = new Date(data.Updated).$format("M/D/YYYY h:mm:ss A (T)")
								label.textContent = `${dateSince(data.Updated)}`
							},
						)
				})
			})
	})
}
