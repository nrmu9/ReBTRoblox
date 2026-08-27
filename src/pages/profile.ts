import { deferredPromise } from "@/core/deferred"
import { IS_DEV_MODE } from "@/core/env"
import { html } from "@/core/html"
import { contentScript, injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { ready } from "@/core/util"
import { SETTINGS } from "@/feat/settings"
import {
	createPager,
	formatNumber,
	formatUrlName,
	loggedInUserPromise,
	onPageLoad,
	onPageReset,
} from "@/pages/common"
import { AssetType } from "@/rbx/Constants"
import { RobloxApi } from "@/rbx/RobloxApi"

pageInit.profile = () => {
	if (!SETTINGS.get("profile.enabled")) {
		return
	}

	injectScript.call("profile", () => {
		angularHook.hijackModule("peopleList", {
			layoutService(target: any, thisArg: any, args: any[], argsMap: any) {
				const result = target.apply(thisArg, args)
				result.maxNumberOfFriendsDisplayed = 10
				return result
			},
		})

		reactHook.inject(">.profile-tab-content", (tabContent) => {
			for (const child of tabContent[0].props.children) {
				switch (child.key) {
					case "About":
					case "FavoriteExperiences":
					case "Communities":
					case "PlayerBadges":
					case "Statistics":
					case "Experiences":
					case "CreationsModels":
					case "Clothing":
						delete child.props.children
						break
					case "CurrentlyWearing":
					case "Collections":
					case "Friends":
					case "Store":
						break // do nothing (we do something with this)
					default:
						if (IS_DEV_MODE) {
							console.log(`Unknown component '${child.key}'`)
						}
				}
			}
		})

		hijackXHR((request: any) => {
			if (request.url === "https://apis.roblox.com/profile-platform-api/v1/profiles/get") {
				request.onResponse.push((json: any) => {
					contentScript.send("profileData", json)
				})
			}
		})
	})

	const profileDataPromises: Record<string, any> = {}

	injectScript.listen("profileData", (json: any) => {
		const promise = (profileDataPromises[json.profileId] ??= deferredPromise<unknown>())
		promise.$resolve(json)
	})

	onPageReset(() => {
		document.body?.classList.remove("btr-profile")

		for (const key of Object.keys(profileDataPromises)) {
			delete profileDataPromises[key]
		}
	})

	onPageLoad((userIdString) => {
		const userId = Number.parseInt(userIdString, 10)

		document.$watch("body", (body: HTMLElement) => body.classList.add("btr-profile"))

		document.$watch(".profile-platform-container", async (profileContainer: HTMLElement) => {
			await profileContainer.$watch(">*").$promise() // wait for first child

			const newCont = html` <div class="btr-profile-container">
				<div class="btr-profile-left">
					<div class="btr-profile-about">
						<div class="container-header">
							<h2 ng-bind="'Heading.AboutTab' | translate">About</h2>
							<div class="btr-profile-social-links"></div>
						</div>
						<div class="section-content">
							<div class="btr-profile-description">
								<div class="btr-profile-description-content">
									<span class="spinner spinner-default"></span>
								</div>
							</div>
							<div class="btr-profile-stats" style="display:none">
								<div class="btr-profile-stat">
									<div class="text-label" ng-bind="'Label.JoinDate' | translate">
										Join Date
									</div>
									<div class="text-lead text-overflow btr-stats-joindate"></div>
								</div>
								<div class="btr-profile-stat">
									<div class="text-label" ng-bind="'Label.PlaceVisits' | translate">
										Place Visits
									</div>
									<div class="text-lead text-overflow btr-stats-placevisits"></div>
								</div>
							</div>
						</div>
					</div>
					<div class="btr-profile-playerbadges">
						<div class="container-header">
							<h2 ng-bind="'Heading.PlayerBadge' | translate">Badges</h2>
						</div>
						<div>
							<div class="btr-card-list">
								<span class="spinner spinner-default"></span>
							</div>
						</div>
					</div>
					<div class="btr-profile-groups">
						<div class="container-header">
							<h2 ng-bind="'Heading.Groups' | translate">Communities</h2>
						</div>
						<div>
							<div class="btr-card-list">
								<span class="spinner spinner-default"></span>
							</div>
						</div>
					</div>
				</div>

				<div class="btr-profile-right">
					<div class="btr-profile-games">
						<div class="container-header">
							<h2 ng-bind="'Heading.Games' | translate">Experiences</h2>
						</div>
						<div class="btr-games-content">
							<span class="spinner spinner-default"></span>
						</div>
					</div>
					<div class="placeholder-friends">
						<div class="container-header">
							<h2 ng-bind="'Heading.Friends' | translate">Friends</h2>
						</div>
						<div class="spinner spinner-default"></div>
					</div>
					<div class="btr-profile-favorites">
						<div class="container-header">
							<a href="/users/${userId}/favorites">
								<h2 ng-bind="'Heading.FavoriteGames' | translate">Favorites</h2>
								<span class="icon-chevron-heavy-right"></span>
							</a>
						</div>
						<div>
							<ul class="hlist game-cards">
								<span class="spinner spinner-default"></span>
							</ul>
						</div>
					</div>
				</div>

				<div class="btr-profile-bottom">
					<div class="placeholder-posts" style="display:none"></div>
					<div class="placeholder-store" style="display:none"></div>
					<div class="placeholder-collections" style="display:none"></div>
					<div class="btr-profile-inventory" style="display:none">
						<div class="container-header">
							<a href="/users/${userId}/inventory">
								<h2 ng-bind="'Action.Inventory' | translate">Inventory</h2>
								<span class="icon-chevron-heavy-right"></span>
							</a>
						</div>
						<div class="placeholder-inventory" style="display:none"></div>
					</div>
				</div>
			</div>`

			// const presencePromise = new Promise(resolve => resolve(RobloxApi.presence.getPresence([userId]).then(json => json?.userPresences?.[0])))
			const profileDataPromise = (profileDataPromises[userIdString] ??= deferredPromise<unknown>())

			profileContainer
				.$watch(".profile-tabs", (tabs: HTMLElement) => {
					tabs.parentElement!.style.display = "none"
				})
				.$watch("#friends-carousel-container", (friends: any) => {
					newCont.$req(".placeholder-friends").after(friends)

					friends.$watch(">*", (cont: HTMLElement) => {
						newCont.$req(".placeholder-friends").remove()
					})
				})
				.$watch(".user-profile-header", (header: HTMLElement) => {
					const target = header.$find("> .flex-nowrap > a.radius-circle")

					if (target) {
						const btn = html` <a
							aria-disabled="false"
							class="relative clip group/interactable focus-visible:outline-focus disabled:outline-none cursor-pointer relative flex justify-center items-center radius-circle stroke-none padding-left-medium padding-right-medium height-800 text-label-medium bg-shift-300 content-action-utility"
							style="text-decoration: none; opacity: 0.5;"
						>
							<div
								role="presentation"
								class="absolute inset-[0] transition-colors group-hover/interactable:bg-[var(--color-state-hover)] group-active/interactable:bg-[var(--color-state-press)] group-disabled/interactable:bg-none"
							></div>
							<span class="text-no-wrap text-truncate-end">More</span>
						</a>`

						btn.$on("click", () => {
							profileContainer.$req(".description-content+.more-btn").click()
						})

						target.parentElement!.append(btn)

						header.$watch(".description-content", () => {
							btn.style.opacity = ""
						})
					}

					header.$watch(".avatar-status", (_status: any) => {
						const statusDiv = html`<div class="btr-header-status-parent text-body-large"></div>`
						const cont = _status.parentNode
						cont.append(statusDiv)

						let lastStatus

						const update = () => {
							const status = cont.$find(".avatar-status")

							if (status !== lastStatus) {
								lastStatus = status
								new MutationObserver(update).observe(status, {
									childList: true,
									subtree: true,
									attributeFilter: ["class"],
								})
							}

							const placeId = status?.href?.match(/PlaceId=(\d+)/)?.[1]
							const game = status?.$find(".game")

							if (game && placeId) {
								statusDiv.replaceChildren(
									html<HTMLAnchorElement>`<a href="/games/${placeId}/" title="${game.title}"
										><span class="btr-header-status-text btr-status-ingame"
											>${game.title}</span
										></a
									>`,
								)

								// } else if(game) {
								// 	statusDiv.replaceChildren(html`<span class="btr-header-status-text btr-status-ingame">${game.title}</span>`)

								// } else if(status?.$find(".studio")) {
								// 	statusDiv.replaceChildren(html`<span class="btr-header-status-text btr-status-studio">Studio</span>`)

								// } else if(status?.$find(".online")) {
								// 	statusDiv.replaceChildren(html`<span class="btr-header-status-text btr-status-online">Online</span>`)
							} else {
								statusDiv.replaceChildren() // html`<span class="btr-header-status-text btr-status-offline">Offline</span>`
							}
						}

						new MutationObserver(update).observe(cont, { childList: true })
						update()
					})
				})
				.$watch(".profile-currently-wearing", (wearing: any) => {
					const toggleItems = html`<span class="btr-toggle-items btn-control btn-control-sm"
						>Show Items</span
					>`
					profileContainer.$req(".profile-avatar-left").parentElement!.append(toggleItems)

					const clone = wearing.cloneNode(false)
					clone.classList.add(
						"btr-currently-wearing",
						"stroke-muted",
						"stroke-standard",
						"shadow-transient-high",
					)
					clone.append(...wearing.childNodes)
					toggleItems.after(clone)

					const onClick = (ev: Event) => {
						if (!ev.composedPath().includes(clone) && ev.target !== toggleItems) {
							toggle()
						}
					}

					const toggle = () => {
						clone.classList.toggle("visible")
						toggleItems.textContent = clone.classList.contains("visible")
							? "Hide Items"
							: "Show Items"

						if (clone.classList.contains("visible")) {
							document.$on("click", onClick)
						} else {
							document.$off("click", onClick)
						}
					}

					toggleItems.$on("click", toggle)
				})
				.$watch(".profile-store", (store: any) => {
					const clone = store.cloneNode(false)
					clone.append(...store.childNodes)

					newCont.$req(".placeholder-store").replaceWith(clone)
				})
				.$watch(".profile-collections", (collections: any) => {
					const clone = collections.cloneNode(false)
					clone.append(...collections.childNodes)

					newCont.$req(".placeholder-collections").replaceWith(clone)
				})

			const gamesPromise = RobloxApi.games.getUserGames(userId, 50)

			profileDataPromise.then((json: any) => {
				if (!document.contains(profileContainer)) {
					return
				}

				const descText = json?.components?.About?.description
				const desc = newCont.$req(".btr-profile-description-content")

				if (descText) {
					desc.textContent = descText

					if (desc.scrollHeight > desc.offsetHeight) {
						const descToggle = html`<span class="btr-toggle-description">Show More</span>`
						desc.after(descToggle)

						descToggle.$on("click", () => {
							const parent = desc.parentElement
							if (!parent) {
								return
							}

							const expanded = !parent.classList.contains("expanded")
							parent.classList.toggle("expanded", expanded)

							descToggle.textContent = expanded ? "Show Less" : "Show More"
						})
					}
				} else {
					desc.replaceChildren(
						html`<div class="section-content-off btr-section-content-off">No bio yet</div>`,
					)
				}

				const socialLinks = json?.components?.About?.socialLinks
				if (socialLinks) {
					for (const [key, entry] of Object.entries(socialLinks) as [string, any][]) {
						if (!entry) {
							continue
						}

						const link = html<HTMLAnchorElement>`<a
							class="btr-social-link"
							href=${(entry as any)?.url}
							><span class="icon icon-regular-${key === "x" ? "twitter" : key}"></span
						></a>`
						newCont.$req(".btr-profile-social-links").append(link)
					}
				}

				newCont.$req(".btr-profile-stats").style.display = ""
				newCont.$req(".btr-stats-joindate").textContent = new Date(
					json.components.About.joinDateTime,
				).$format("M/D/YYYY")

				gamesPromise.then((json) => {
					let visits = 0

					for (const game of json.data) {
						visits += game.placeVisits
					}

					newCont.$req(".btr-stats-placevisits").textContent = formatNumber(visits)
				})

				const friendsPlaceholder = newCont.$find(".placeholder-friends")
				if (friendsPlaceholder) {
					friendsPlaceholder.style.display = "none"
				}
			})

			const initPlayerBadges = () => {
				// if(userId === 1) {
				// 	newCont.$find(".btr-profile-playerbadges").remove()
				// 	return
				// }

				const list = newCont.$req(".btr-profile-playerbadges .btr-card-list")
				const pager = createPager(true, undefined)

				const thumbClasses = {
					Error: "icon-broken",
					InReview: "icon-in-review",
					Blocked: "icon-blocked",
					Pending: "icon-pending",
				}

				const playerBadges: any[] = []
				const pageSize = 8

				let currentPage = 1
				let isLoading = false
				let hasMorePages = true
				let nextPageCursor

				const openPage = async (page: number) => {
					const pageStart = (page - 1) * pageSize
					const badges = playerBadges.slice(pageStart, pageStart + pageSize)

					currentPage = page
					pager.setPage(currentPage)
					pager.togglePrev(currentPage > 1)
					pager.toggleNext(hasMorePages || pageStart + pageSize < playerBadges.length)
					list.replaceChildren()

					if (!badges.length) {
						list.append(
							html`<div class="section-content-off btr-section-content-off">
								This user has no Player Badges
							</div>`,
						)
						newCont.$req(".btr-profile-playerbadges").style.display = "none"
						return
					}

					newCont.$req(".btr-profile-playerbadges").style.display = ""

					for (const data of badges) {
						const badgeUrl = `/badges/${data.id}/${formatUrlName(data.name)}`
						const thumbUrl =
							(data.thumb && data.thumb.imageUrl) ||
							"data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="
						const thumbClass = (data.thumb && thumbClasses[data.thumb.state]) || ""

						list.append(
							html` <div class="card">
								<a href=${badgeUrl} class="card-link" title=${data.name}>
									<span class="card-thumb-container">
										<img
											class="card-thumb ${thumbClass}"
											src="${thumbUrl}"
											data-badgeId="${data.id}"
										/>
									</span>
									<span class="font-header-2 text-overflow card-name">${data.name}</span>
								</a>
							</div>`,
						)
					}

					if (!list.style.minHeight) {
						list.style.minHeight = `${list.scrollHeight + 1}px`
					}

					if (playerBadges.length > pageSize) {
						list.after(pager)
					}

					const needsThumbs = badges.filter((x) => !x.thumbUrl && !x.gettingThumb)
					if (needsThumbs.length) {
						for (const thumb of needsThumbs) {
							thumb.gettingThumb = true
						}

						RobloxApi.thumbnails.getBadgeIcons(needsThumbs.map((x) => x.id)).then((json: any) => {
							for (const thumb of json.data) {
								const badge = badges.find((x) => x.id === thumb.targetId)
								badge.thumb = thumb

								const img = list.$find<HTMLImageElement>(`img[data-badgeId="${badge.id}"]`)
								if (img) {
									const thumbUrl =
										badge.thumb.imageUrl ||
										"data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="
									const thumbClass = thumbClasses[badge.thumb.state] || ""

									img.src = thumbUrl
									if (thumbClass) {
										img.classList.add(thumbClass)
									}
								}
							}
						})
					}
				}

				const loadPage = async (page: number) => {
					if (isLoading) {
						return
					}

					isLoading = true
					page = Math.max(1, page)

					const lastIndex = page * pageSize
					while (playerBadges.length < lastIndex && hasMorePages) {
						const badges = await RobloxApi.badges.getBadges(
							userId,
							"Desc",
							100,
							nextPageCursor || "",
						)

						nextPageCursor = badges.nextPageCursor
						hasMorePages = !!nextPageCursor

						playerBadges.push(...badges.data)
					}

					page = Math.max(1, Math.min(Math.ceil(playerBadges.length / pageSize), page))

					await openPage(page)
					isLoading = false
				}

				pager.onprevpage = () => loadPage(currentPage - 1)
				pager.onnextpage = () => loadPage(currentPage + 1)

				ready(() => loadPage(1))
			}

			const initGroups = () => {
				const groups = newCont.$req(".btr-profile-groups")
				const list = groups.$req(".btr-card-list")
				list.setAttribute("ng-non-bindable", "")
				const pageSize = 8

				const pager = createPager(false, true)
				list.after(pager)

				function loadPage(page: number) {
					pager.setPage(page)

					for (const [index, obj] of Array.from(list.children).entries()) {
						;(obj as HTMLElement).style.display =
							Math.floor(index / pageSize) + 1 === page ? "" : "none"
					}
				}

				pager.onsetpage = loadPage

				ready(() => {
					RobloxApi.groups.getUserGroupRoles(userId).then(async (json) => {
						const numGroups = json.data.length

						pager.setMaxPage(Math.floor((numGroups - 1) / pageSize) + 1)
						if (numGroups === 0) {
							list.replaceChildren(
								html`<div class="section-content-off btr-section-content-off">
									This user is in no Communities
								</div>`,
							)
							return
						}

						list.replaceChildren()

						const thumbs: Record<string, any> = {}
						const groups = json.data.sort((a: any, b: any) =>
							a.isPrimaryGroup ? -1 : b.isPrimaryGroup ? 1 : 0,
						)

						for (const [index, { group, role }] of (groups as any[]).entries()) {
							const parent = html` <div class="card">
								<a
									class="card-link"
									href="/communities/${group.id}/${formatUrlName(group.name)}"
									title="${group.name}"
								>
									<div class="card-thumb-container">
										<img class="card-thumb" />
									</div>
									<div class="text-overflow card-name">${group.name}</div>
								</a>
								<div class="text-overflow text-secondary small">
									${formatNumber(group.memberCount)}
									${group.memberCount === 1 ? "Member" : "Members"}
								</div>
								<div class="text-overflow text-secondary small">${role.name}</div>
							</div>`

							parent.style.display = index < pageSize ? "" : "none"

							const thumb = parent.$req<HTMLImageElement>(".card-thumb")
							thumbs[group.id] = thumb

							list.append(parent)
						}

						list.style.minHeight = `${list.scrollHeight + 1}px`

						const thumbIds = Object.keys(thumbs)

						for (let i = 0; i < thumbIds.length; i += 100) {
							const thumbData = await RobloxApi.thumbnails.getGroupIcons(
								thumbIds.slice(i, i + 100),
							)

							for (const thumbInfo of thumbData.data) {
								if (thumbInfo.imageUrl) {
									thumbs[thumbInfo.targetId].src = thumbInfo.imageUrl
								} else {
									thumbs[thumbInfo.targetId].parentNode.classList.add("icon-blocked")
								}
							}
						}
					})
				})
			}

			const initFavorites = () => {
				const favorites = newCont.$req(".btr-profile-favorites")
				const hlist = favorites.$req(".hlist")
				hlist.setAttribute("ng-non-bindable", "")

				const pageSize = 6
				const pager = createPager(false, true)
				hlist.after(pager)

				let isLoading = false
				let lastCategory: any = null

				const dropdown = html` <div class="input-group-btn">
					<button
						type="button"
						class="input-dropdown-btn"
						data-toggle="dropdown"
						aria-expanded="false"
					>
						<span class="rbx-selection-label" data-bind="label">Places</span>
						<span class="icon-down-16x16"></span>
					</button>
					<ul data-toggle="dropdown-menu" class="dropdown-menu" role="menu">
						<li data-value="8"><a href="#">Accessories</a></li>
						<li data-value="24"><a href="#">Animations</a></li>
						<li data-value="3"><a href="#">Audio</a></li>
						<li data-value="13"><a href="#">Decals</a></li>
						<li data-value="18"><a href="#">Faces</a></li>
						<li data-value="19"><a href="#">Gear</a></li>
						<li data-value="17"><a href="#">Heads</a></li>
						<li data-value="40"><a href="#">Meshes</a></li>
						<li data-value="10"><a href="#">Models</a></li>
						<li data-value="12"><a href="#">Pants</a></li>
						<li data-value="9"><a href="#">Places</a></li>
						<li data-value="38"><a href="#">Plugins</a></li>
						<li data-value="11"><a href="#">Shirts</a></li>
						<li data-value="2"><a href="#">T-Shirts</a></li>
					</ul>
				</div>`

				favorites.$req(".container-header").append(dropdown)

				const favoriteData: Record<string, any> = {}

				const loadPage = async (category: number, page: number) => {
					if (isLoading) {
						return
					}

					const changedCategory = lastCategory !== category

					lastCategory = category

					let data = favoriteData[category]

					if (!data) {
						data = {
							items: [],
							nextPage: 1,
							nextPageCursor: "",
							hasMore: true,
						}

						favoriteData[category] = data
					}

					const pageStart = (page - 1) * pageSize
					const pageEnd = pageStart + pageSize

					while (data.hasMore && pageEnd > data.items.length) {
						isLoading = true

						const CreatorStoreAssetTypes = [
							AssetType.Audio,
							AssetType.Model,
							AssetType.Decal,
							AssetType.Animation,
							AssetType.Plugin,
							AssetType.MeshPart,
							AssetType.Video,
						]

						let json

						if (category === AssetType.Place) {
							json = await RobloxApi.games
								.getFavorites(userId, 100, data.nextPageCursor)
								.then((json) => {
									json.data = json.data.map((x: any) => ({
										url: `/games/${x.rootPlace?.id}/`,
										id: x.rootPlace?.id,
										gameId: x.id,
										assetTypeId: category,
										name: x.name,
										creator: {
											id: x.creator.id,
											type: x.creator.type,
											name: x.creator.name,
											verified: false,
										},
									}))

									return json
								})
						} else if (CreatorStoreAssetTypes.includes(category)) {
							json = await RobloxApi.toolboxService
								.getFavorites(userId, category, 100, data.nextPageCursor)
								.then((json) => {
									json.data = json.data.map((x: any) => ({
										url: `https://create.roblox.com/store/asset/${x.asset.id}/`,
										id: x.asset.id,
										assetTypeId: x.asset.assetTypeId,
										name: x.asset.name,
										creator: {
											id: x.creator.creator.match(/\/(\d+)/)?.[1],
											type: x.creator.creator.includes("user/") ? "User" : "Group",
											name: x.creator.name,
											verified: x.creator.verified,
										},
									}))

									return json
								})
						} else {
							json = await RobloxApi.catalog
								.getFavorites(userId, category, 100, data.nextPageCursor)
								.then((json) => {
									json.data = json.data.map((x: any) => ({
										url: `/catalog/${x.id}/`,
										id: x.id,
										assetTypeId: x.assetType,
										name: x.name,
										creator: {
											id: x.creatorTargetId,
											type: x.creatorType,
											name: x.creatorName,
											verified: x.creatorHasVerifiedBadge,
										},
									}))

									return json
								})
						}

						isLoading = false

						if (!json?.data) {
							return
						}

						data.items.push(...json.data)

						data.nextPage += 1
						data.nextPageCursor = json.nextPageCursor

						data.hasMore = !!data.nextPageCursor
						data.totalItems = data.hasMore ? data.items.length + 1 : data.items.length
					}

					pager.setPage(page)
					pager.setMaxPage(Math.floor((data.totalItems - 1) / pageSize) + 1)
					hlist.replaceChildren()

					if (changedCategory) {
						hlist.style.minHeight = ""
					}

					if (pageStart >= data.items.length) {
						const categoryName = dropdown.$find(`li[data-value="${category}"]`)?.textContent
						hlist.append(
							html`<div class="section-content-off btr-section-content-off">
								This user has no favorite ${categoryName}
							</div>`,
						)
						return
					}

					const requests: any[] = []
					const cards: any[] = []

					for (let i = pageStart; i < pageEnd; i++) {
						const item = data.items[i]
						if (!item) {
							break
						}

						const card = html` <li class="list-item game-card">
							<div class="card-item game-card-container">
								<a href="${item.url}" title="${item.name}">
									<div class="game-card-thumb-container">
										<img class="game-card-thumb card-thumb" src="" />
									</div>
									<div
										class="text-overflow game-card-name"
										title="${item.name}"
										ng-non-bindable
									>
										${item.name}
									</div>
								</a>
								<div class="game-card-name-secondary btr-creator-link-container">
									<span class="text-secondary">By </span>
									<a
										class="text-link text-overflow btr-creator-link"
										title="${item.creator.name}"
										href="${item.creator.type === "User" ? `/users/${item.creator.id}/profile` : `/communities/${item.creator.id}/community`}"
									>
										${item.creator.name}
									</a>
								</div>
							</div>
						</li>`

						requests.push({
							format: "webp",
							requestId: `${i}`,
							size: "150x150",
							targetId: category === AssetType.Place ? item.gameId : item.id,
							type: category === AssetType.Place ? "GameIcon" : "Asset",
						})
						cards.push(card)

						hlist.append(card)
					}

					if (changedCategory) {
						hlist.style.minHeight = `${hlist.scrollHeight + 1}px`
					}

					if (requests.length) {
						RobloxApi.thumbnails.batch(requests).then((json) => {
							for (const thumb of json.data) {
								const index = requests.findIndex((x) => x.targetId === thumb.targetId)
								cards[index].$find(".game-card-thumb").src = thumb.imageUrl ?? ""
							}
						})
					}
				}

				const onclick = (ev: Event) => {
					ev.preventDefault()
					const cat = +(ev.currentTarget as HTMLElement).getAttribute("data-value")!
					if (Number.isSafeInteger(cat)) {
						loadPage(cat, 1)
					}
				}

				for (const btn of dropdown.$findAll(".dropdown-menu li")) {
					btn.$on("click", onclick)
				}

				pager.onsetpage = (page) => loadPage(lastCategory, page)
				ready(() => loadPage(9, 1))
			}

			const initGames = async () => {
				const profileData = await profileDataPromise
				const initial = profileData?.components?.Experiences

				const content = newCont.$req(".btr-profile-games > .btr-games-content")

				if (!initial?.experiences?.length) {
					content.replaceChildren(
						html`<div class="section-content-off btr-section-content-off">
							This user has no experiences
						</div>`,
					)
					return
				}

				const items: any[] = []

				const transition = (item: any, open: boolean, instant = false) => {
					const content = item.$req(".btr-game-content")
					const height = content.scrollHeight

					if (content._timeout) {
						clearTimeout(content._timeout)
					}

					if (instant) {
						content.style.transition = ""
						content.style.maxHeight = open ? "none" : "0px"
					} else {
						const duration = 0.25

						content.style.maxHeight = `${height}px`
						content.style.transition = `max-height ${duration}s ease`

						if (open) {
							content._timeout = setTimeout(
								() => (content.style.maxHeight = "none"),
								duration * 1e3,
							)
						} else {
							content._timeout = setTimeout(() => (content.style.maxHeight = "0px"), 0)
						}
					}
				}

				const select = (item: any, instant = false) => {
					const prev = content.$find(".selected")
					if (prev === item) {
						return
					}

					prev?.classList.remove("selected")
					item.classList.add("selected")

					if (prev) {
						transition(prev, false, instant)
					}
					transition(item, true, instant)
				}

				const pager = createPager(false, true)
				const pageSize = 5

				content.after(pager)

				function loadPage(page: number) {
					pager.setPage(page)

					for (const [index, obj] of Array.from(items as any).entries()) {
						;(obj as HTMLElement).style.display =
							Math.floor(index / pageSize) + 1 === page ? "" : "none"
					}

					select(items[(page - 1) * pageSize], true)
				}

				pager.onsetpage = loadPage

				pager.setMaxPage(Math.floor((initial.experiences.length - 1) / pageSize) + 1)

				for (const { universeId } of initial.experiences) {
					const index = items.length

					const item = html` <div class="btr-game">
						<div class="btr-game-button clip group/interactable">
							<div
								class="absolute inset-[0] transition-colors group-hover/interactable:bg-[var(--color-state-hover)] group-active/interactable:bg-[var(--color-state-press)] group-disabled/interactable:bg-none"
							></div>
							<span class="btr-game-title shimmer">&nbsp;</span>
						</div>
						<div class="btr-game-content" style="max-height:0">
							<a class="btr-game-thumb-container" href="#">
								<img class="btr-game-thumb" />
								<img class="btr-game-icon" />
							</a>
							<div class="btr-game-desc">
								<span class="btr-game-desc-content"></span>
							</div>
							<div class="btr-game-info">
								<div class="btr-game-playbutton-container">
									<span class="spinner spinner-default"></span>
								</div>
								<div class="btr-game-stats">
									<ul class="hlist">
										<li class="list-item">
											<div
												class="text-label slide-item-stat-title"
												ng-bind="'Label.Playing' | translate"
											>
												Playing
											</div>
											<div class="text-lead slide-item-members-count">&nbsp;</div>
										</li>
										<li class="list-item">
											<div
												class="text-label slide-item-stat-title"
												ng-bind="'Label.Visits' | translate"
											>
												Visits
											</div>
											<div class="text-lead text-overflow slide-item-visits">
												&nbsp;
											</div>
										</li>
									</ul>
								</div>
							</div>
						</div>
					</div>`

					item.style.display = index < pageSize ? "" : "none"

					item.$req(".btr-game-button").$on("click", () => select(item))
					if (index === 0) {
						select(item, true)
					}

					loggedInUserPromise.then((loggedInUser) => {
						if (userId !== loggedInUser) {
							return
						}

						item.prepend(html`
							<div class="btr-game-dropdown">
								<a
									class="rbx-menu-item btn-generic-more-sm"
									data-toggle="popover"
									data-container="body"
									data-bind="btr-placedrop-${universeId}"
									data-original-title=""
									title=""
									><span class="icon-more"></span
								></a>
								<div data-toggle="btr-placedrop-${universeId}" style="display:none">
									<ul class="dropdown-menu" role="menu"></ul>
								</div>
							</div>
						`)

						injectScript.call(
							"setupGamePopovers",
							(selector: string) => {
								Roblox?.BootstrapWidgets?.SetupPopover(null, null, selector)
							},
							`[data-bind='btr-placedrop-${universeId}']`,
						)
					})

					content.$find(">.spinner")?.remove()
					item.classList.add("visible")

					RobloxApi.thumbnails.getGameThumbnails.batch(universeId, "768x432").then((json: any) => {
						const thumb = json.data.find((x: any) => x.universeId === universeId)
						item.$req<HTMLImageElement>(".btr-game-thumb").src = thumb.thumbnails?.[0]?.imageUrl
					})

					RobloxApi.games.getGameDetails.batch(universeId).then(async (_gameDetails: any) => {
						const gameDetails = _gameDetails.data.find((x: any) => x.id === universeId)
						const placeId = gameDetails.rootPlaceId

						item.$req<HTMLAnchorElement>(".btr-game-thumb-container").href =
							`https://www.roblox.com/games/${placeId}/${formatUrlName(gameDetails.name)}`
						item.$req(".btr-game-title").textContent = gameDetails.name
						item.$req(".btr-game-title").classList.remove("shimmer")

						loggedInUserPromise.then((loggedInUser) => {
							if (userId !== loggedInUser) {
								return
							}

							item.$req(".dropdown-menu").append(
								html`<li>
									<a
										class="btr-btn-edit-place"
										data-gameid=${universeId}
										data-placeid=${placeId}
										><div>Edit</div></a
									>
								</li>`,
								html`<li>
									<a
										href="https://create.roblox.com/dashboard/creations/experiences/${universeId}/overview"
										><div>View Analytics</div></a
									>
								</li>`,
								html`<li>
									<a href="https://advertise.roblox.com/"
										><div>Promote this Experience</div></a
									>
								</li>`,
								html`<li>
									<a
										href="https://create.roblox.com/dashboard/creations/experiences/${universeId}/places/${placeId}/configure"
										><div>Configure this Place</div></a
									>
								</li>`,
								html`<li>
									<a
										href="https://create.roblox.com/dashboard/creations/experiences/${universeId}/configure"
										><div>Configure this Experience</div></a
									>
								</li>`,
								html`<li>
									<a
										href="https://create.roblox.com/dashboard/creations/experiences/${universeId}/localization"
										><div>Configure Localization</div></a
									>
								</li>`,
								html`<li>
									<a class="btr-btn-toggle-profile" data-placeid="${placeId}"
										><div>Remove from Profile</div></a
									>
								</li>`,
							)
						})

						item.$req(".slide-item-members-count").textContent = formatNumber(gameDetails.playing)
						item.$req(".slide-item-visits").textContent = formatNumber(gameDetails.visits)

						RobloxApi.thumbnails.getPlaceIcons.batch(placeId, "150x150").then((json: any) => {
							const thumb = json.data.find((x: any) => x.targetId === placeId)
							item.$req<HTMLImageElement>(".btr-game-icon").src = thumb.imageUrl
						})

						//

						const _placeDetails = await RobloxApi.games.getPlaceDetails.batch(placeId)
						const placeDetails = _placeDetails.find((x: any) => x.placeId === placeId)

						const desc = item.$req(".btr-game-desc-content")
						desc.textContent = placeDetails.description

						injectScript.call("linkify", (target: any) => $(target).linkify(), desc)

						if (desc.scrollHeight > desc.offsetHeight) {
							const descToggle = html`<span class="btr-toggle-description">Show More</span>`
							desc.after(descToggle)

							descToggle.$on("click", () => {
								const parent = desc.parentElement
								if (!parent) {
									return
								}

								const expanded = !parent.classList.contains("expanded")
								parent.classList.toggle("expanded", expanded)

								descToggle.textContent = expanded ? "Show Less" : "Show More"
							})
						}

						if (placeDetails.isPlayable) {
							item.$req(".btr-game-playbutton-container").replaceChildren(
								html`<div class="btr-game-playbutton btn-primary-lg" data-placeid=${placeId}>
									Play
								</div>`,
							)
						} else {
							const prohibitedReasons = {
								UniverseDoesNotHaveARootPlace: "This game has no root place",
								UniverseRootPlaceIsNotActive: "This game is not active",
								InsufficientPermissionFriendsOnly: "This game is friends only",
								InsufficientPermissionGroupOnly: "Group members only",
								UnderReview: "This game is under moderation review",
								PlaceHasNoPublishedVersion: "This place has no published version",
								ContextualPlayabilityUnrated:
									"This experience is not accessible because it is unrated",
							}

							item.$req(".btr-game-playbutton-container").replaceChildren(html`
								<div
									title="${prohibitedReasons[placeDetails.reasonProhibited] || placeDetails.reasonProhibited}"
									class="btr-place-prohibited btn-common-play-game-unplayable-lg btn-primary-lg"
									disabled
								>
									<span class="icon-status-unavailable-secondary"></span>
									<span class="btn-text">Unavailable</span>
								</div>
							`)
						}
					})

					content.append(item)

					items.push(item)
				}

				document.body.$on("click", ".btr-game-playbutton", (ev) => {
					injectScript.call(
						"profilePlayGame",
						(placeId: number) => {
							Roblox.GameLauncher.joinMultiplayerGame(placeId, true)
						},
						+ev.currentTarget.dataset.placeid!,
					)
					ev.preventDefault()
				})

				document.body.$on("click", ".btr-btn-edit-place", (ev) => {
					injectScript.call(
						"profileEditPlace",
						(gameId: number, placeId: number) => {
							Roblox.GameLauncher.editGameInStudio(placeId, gameId)
						},
						+ev.currentTarget.dataset.gameid!,
						+ev.currentTarget.dataset.placeid!,
					)
					ev.preventDefault()
				})

				document.body.$on("click", ".btr-btn-toggle-profile", (ev) => {
					const placeId = +ev.currentTarget.dataset.placeid!
					RobloxApi.inventory.toggleInCollection("asset", placeId, false)
					ev.preventDefault()
				})
			}

			initPlayerBadges()
			initGroups()
			initGames()
			initFavorites()

			if (SETTINGS.get("profile.embedInventoryEnabled")) {
				newCont.$req(".btr-profile-inventory").style.display = ""

				ready(() => {
					newCont
						.$req(".placeholder-inventory")
						.replaceWith(
							html<HTMLIFrameElement>`<iframe
								id="btr-injected-inventory"
								src="/users/${userId}/inventory"
								scrolling="no"
							></iframe>`,
						)
				})
			}

			profileContainer.after(newCont)
		})

		document.$watch(".profile-container", (angularContainer: HTMLElement) => {
			// rescue necessary elements and then remove the angular container to stop stuff from loading
			const friends = angularContainer.$find("#friends-carousel-container")
			if (friends) {
				angularContainer.before(friends)
			}

			angularContainer.remove()
		})
	})
}
