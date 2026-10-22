import { html } from "@/core/html"
import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { ready } from "@/core/util"
import { btrLocalStorage } from "@/core/storage"
import { openActivity } from "@/feat/activity/dialog"
import { refreshWatched } from "@/feat/activity/data"
import { lastSeenAt } from "@/feat/activity/shared"
import { clockFormat } from "@/feat/clock"
import { getPresenceHistory, onPresenceHistoryChange, type PresenceSegment } from "@/feat/activity/presence"
import { waitForRobloxResponse } from "@/feat/robloxResponses"
import { SETTINGS } from "@/feat/settings"
import {
	createPager,
	formatNumber,
	formatUrlName,
	loggedInUser,
	loggedInUserPromise,
	onPageLoad,
	onPageReset,
	redirectEvents,
} from "@/pages/common"
import { AssetType } from "@/rbx/Constants"
import { RobloxApi } from "@/rbx/RobloxApi"

// Roblox rounds the follower and following counts once they get big, so a
// popular profile reads "17M Followers". Friends never needs this, the cap is
// far below where rounding starts.
const ROUNDED_COUNT = /^[\d.,]+[KMB]\+?\s+(Followers|Following)$/

// Writing the exact number leaves text the pattern no longer matches, so a
// react re-render is what asks for the count again. The counts come from the
// profile data Roblox loads anyway; only without it are they asked for.
const showExactCounts = (userId: number, getCounts: () => Promise<any>) => {
	document.$watch(
		".user-profile-header a span",
		(span: HTMLElement) => {
			const update = async () => {
				const label = ROUNDED_COUNT.exec(span.textContent ?? "")?.[1]

				if (!label) {
					return
				}

				const counts = await getCounts()
				let count = label === "Followers" ? counts?.followersCount : counts?.followingsCount

				if (!Number.isSafeInteger(count)) {
					const json = await (label === "Followers"
						? RobloxApi.friends.getFollowerCount(userId)
						: RobloxApi.friends.getFollowingCount(userId))
					count = json?.count
				}

				if (!Number.isSafeInteger(count)) {
					return
				}

				span.textContent = `${formatNumber(count)} ${label}`
			}

			new MutationObserver(() => void update()).observe(span, {
				characterData: true,
				childList: true,
				subtree: true,
			})

			void update()
		},
		{ continuous: true },
	)
}

/** The ids of your own communities, kept for ten minutes between profiles. */
const getOwnCommunities = async (me: number): Promise<Set<number>> => {
	const cached = btrLocalStorage.getItem<number[]>(`ownCommunities-${me}`)

	if (cached) {
		return new Set(cached)
	}

	try {
		const json = await RobloxApi.groups.getUserGroupRoles(me)
		const ids: number[] = (json?.data ?? []).map((entry: any) => entry.group.id)

		btrLocalStorage.setItem(`ownCommunities-${me}`, ids, { expires: Date.now() + 10 * 60e3 })
		return new Set(ids)
	} catch {
		return new Set()
	}
}

pageInit.profile = () => {
	if (!SETTINGS.get("profile.enabled")) {
		return
	}

	injectScript.call("profile")

	// Roblox asks for a profile in several requests, a few components each, in no
	// fixed order. Taking whichever arrived first left the bio, join date or games
	// empty whenever that one did not carry them. The page side merges them, and
	// each reader here waits for the component it needs.
	//
	// There is no timeout. One was tried, and after the tab was frozen for a
	// while the expired timer could run before the queued answer it was waiting
	// for, declaring a bio empty that had in fact arrived. A section only waits
	// on a component Roblox always sends for a profile page.
	const profileData: Record<string, any> = {}
	const componentWaiters: Array<() => void> = []

	injectScript.listen("profileData", (json: any) => {
		if (json?.profileId == null) {
			return
		}

		profileData[json.profileId] = json

		for (const check of componentWaiters.slice()) {
			check()
		}
	})

	const waitForComponent = (profileId: string, component: string) =>
		new Promise<any>((resolve) => {
			const check = () => {
				if (profileData[profileId]?.components?.[component]) {
					done()
				}
			}

			const done = () => {
				componentWaiters.splice(componentWaiters.indexOf(check) >>> 0, 1)
				resolve(profileData[profileId])
			}

			componentWaiters.push(check)
			check()
		})

	if (SETTINGS.get("profile.exactCounts")) {
		onPageLoad((userIdString: string) => {
			const userId = Number.parseInt(userIdString, 10)

			if (Number.isSafeInteger(userId)) {
				// Usually in long before the counts are drawn; without it in a few
				// seconds, they are asked for instead.
				const counts = Promise.race([
					waitForComponent(userIdString, "UserProfileHeader").then(
						(json: any) => json?.components?.UserProfileHeader?.counts,
					),
					new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
				])

				showExactCounts(userId, () => counts)
			}
		})
	}

	onPageReset(() => {
		document.body?.classList.remove("btr-profile")
		if (document.body) {
			delete document.body.dataset.btrBlocked
		}

		for (const key of Object.keys(profileData)) {
			delete profileData[key]
		}
	})

	onPageLoad((userIdString) => {
		const userId = Number.parseInt(userIdString, 10)

		document.$watch("body", (body: HTMLElement) => body.classList.add("btr-profile"))

		document.$watch(".profile-platform-container", async (profileContainer: HTMLElement) => {
			await profileContainer.$watch(">*").$promise()

			const newCont = html` <div class="btr-profile-container">
				<div class="btr-profile-left">
					<div class="btr-profile-about">
						<div class="container-header">
							<h2>About</h2>
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
									<div class="text-label">Join Date</div>
									<div class="text-lead text-overflow btr-stats-joindate"></div>
								</div>
								<div class="btr-profile-stat">
									<div class="text-label">Place Visits</div>
									<div class="text-lead text-overflow btr-stats-placevisits"></div>
								</div>
								<div class="btr-profile-stat btr-stats-lastseen-stat" style="display:none">
									<button
										type="button"
										class="btr-lastseen-toggle"
										aria-haspopup="dialog"
										title="View activity"
									>
										<span class="text-label">Last Seen Online</span>
										<span class="text-lead text-overflow btr-stats-lastseen"></span>
									</button>
								</div>
							</div>
						</div>
					</div>
					<div class="btr-profile-playerbadges">
						<div class="container-header">
							<h2>Badges</h2>
						</div>
						<div>
							<div class="btr-card-list">
								<span class="spinner spinner-default"></span>
							</div>
						</div>
					</div>
					<div class="btr-profile-groups">
						<div class="container-header">
							<h2>Communities</h2>
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
							<h2>Experiences</h2>
						</div>
						<div class="btr-games-content">
							<span class="spinner spinner-default"></span>
						</div>
					</div>
					<div class="placeholder-friends">
						<div class="container-header">
							<h2>Friends</h2>
						</div>
						<div class="spinner spinner-default"></div>
					</div>
					<div class="btr-profile-favorites">
						<div class="container-header">
							<a href="/users/${userId}/favorites">
								<h2>Favorites</h2>
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
								<h2>Inventory</h2>
								<span class="icon-chevron-heavy-right"></span>
							</a>
						</div>
						<div class="placeholder-inventory" style="display:none"></div>
					</div>
				</div>
			</div>`

			// A profile that blocked you leaves About and Friends out of everything
			// it sends, so waiting for them never ended. Without About a few seconds
			// in, it is asked for directly, and whatever that returns is final.
			const aboutPromise: Promise<any> = Promise.race([
				waitForComponent(userIdString, "About"),
				new Promise((resolve) => setTimeout(resolve, 4000)).then(() =>
					RobloxApi.userProfiles.getComponents(userId, ["About", "Actions"]).catch(() => null),
				),
			])

			// The answers may already have come and gone before this listened.
			injectScript.send("requestProfileData", userIdString)

			profileContainer
				// Roblox renders the friends carousel inside the tab content this
				// layout hides, where it measures 0px wide and shows nobody. The
				// wrapper the profile hook puts around it is what moves: react never
				// touches that node, so it survives the move. It leaves the react
				// root, so its events are sent back to the wrapper it came out of.
				.$watch(".btr-wrapper-Friends", (friends: HTMLElement) => {
					const container = friends.parentElement!

					newCont.$find(".placeholder-friends")?.replaceWith(friends)
					redirectEvents(friends, container)
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

						let lastStatus: any

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
							} else {
								statusDiv.replaceChildren()
							}
						}

						new MutationObserver(update).observe(cont, { childList: true })
						update()
					})
				})
				// Moved into the header, which is still inside the react root, so its
				// events reach react without being redirected.
				.$watch(".btr-wrapper-CurrentlyWearing", (wearing: HTMLElement) => {
					const toggleItems = html`<span class="btr-toggle-items btn-control btn-control-sm"
						>Show Items</span
					>`
					profileContainer.$req(".profile-avatar-left").parentElement!.append(toggleItems)

					wearing.classList.add(
						"btr-currently-wearing",
						"stroke-muted",
						"stroke-standard",
						"shadow-transient-high",
					)
					toggleItems.after(wearing)

					const onClick = (ev: Event) => {
						if (!ev.composedPath().includes(wearing) && ev.target !== toggleItems) {
							toggle()
						}
					}

					const toggle = () => {
						wearing.classList.toggle("visible")
						toggleItems.textContent = wearing.classList.contains("visible")
							? "Hide Items"
							: "Show Items"

						if (wearing.classList.contains("visible")) {
							document.$on("click", onClick)
						} else {
							document.$off("click", onClick)
						}
					}

					toggleItems.$on("click", toggle)
				})
				.$watch(".btr-wrapper-Store", (store: HTMLElement) => {
					const container = store.parentElement!

					newCont.$find(".placeholder-store")?.replaceWith(store)
					redirectEvents(store, container)
				})
				.$watch(".btr-wrapper-Collections", (collections: HTMLElement) => {
					const container = collections.parentElement!

					newCont.$find(".placeholder-collections")?.replaceWith(collections)
					redirectEvents(collections, container)
				})

			const gamesPromise = RobloxApi.games.getUserGames(userId, 50)

			aboutPromise.then((json: any) => {
				if (!document.contains(profileContainer)) {
					return
				}

				const about = json?.components?.About
				const descText = about?.description
				const desc = newCont.$req(".btr-profile-description-content")

				// Blocking leaves About out. Which way round shows in the menu
				// Roblox offers: Unblock when you did it, only Block when they did.
				const actions = json?.components?.Actions ?? profileData[userIdString]?.components?.Actions
				const canUnblock = actions?.contextual?.includes?.("Unblock")
				const cannotAdd = actions?.buttons?.some?.(
					(button: any) => button?.type === "CannotAddFriend",
				)

				if (canUnblock) {
					document.body.dataset.btrBlocked = "them"
				} else if (json && !about && cannotAdd) {
					document.body.dataset.btrBlocked = "you"
				}

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
						html`<div class="section-content-off btr-section-content-off">
							${about ? "No bio yet" : json ? "Hidden from you" : "Could not load the bio"}
						</div>`,
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

				if (SETTINGS.get("profile.lastSeen") && Number.isSafeInteger(userId)) {
					const stat = newCont.$req(".btr-stats-lastseen-stat")
					refreshWatched(userId)

					let segments: PresenceSegment[] = []
					let presenceOnline = false

					// Live changes since the page loaded say more than its presence.
					const isOnline = () => {
						const current = segments.at(-1)
						return current && current.to > Date.now() - 60e3 ? current.type > 0 : presenceOnline
					}

					const render = () => {
						const online = isOnline()

						// Shown with no history too, as the dialog is where watching starts.
						const when = lastSeenAt(segments)
						const value = stat.$req(".btr-stats-lastseen")
						value.textContent = online ? "Now" : when ? new Date(when).$since() : "Not seen yet"
						value.title =
							online || !when ? "" : new Date(when).$format(`MMM D, YYYY, ${clockFormat()}`)
						stat.style.display = ""
					}

					// The history is on this device, so the stat shows straight away. Whether
					// they are online right now follows once their presence is in.
					void getPresenceHistory(userId).then((history) => {
						segments = history
						render()
					})

					onPresenceHistoryChange(userId, (history) => {
						segments = history
						render()
					})

					waitForRobloxResponse(
						(url, json) =>
							url.includes("presence.roblox.com/v1/presence/users") &&
							json?.userPresences?.some((entry: any) => entry.userId === userId),
					)
						.then((json) => json ?? RobloxApi.presence.getPresence([userId]))
						.then((presences) => {
							presenceOnline =
								presences?.userPresences?.find((entry: any) => entry.userId === userId)
									?.userPresenceType > 0
							render()
						})

					stat.$req(".btr-lastseen-toggle").$on("click", () => {
						const name =
							document.querySelector(".stylistic-alts-username")?.textContent?.trim() ||
							document.title.replace(/ - Roblox$/, "")

						void openActivity(userId, name, isOnline, { isOwn: userId === loggedInUser })
					})
				}

				const joinDate = json?.components?.About?.joinDateTime
				if (joinDate) {
					newCont.$req(".btr-stats-joindate").textContent = new Date(joinDate).$format("M/D/YYYY")
				}

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
				let nextPageCursor: any

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
						const thumbClass =
							(data.thumb && (thumbClasses as Record<string, any>)[data.thumb.state]) || ""

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
									const thumbClass =
										(thumbClasses as Record<string, any>)[badge.thumb.state] || ""

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

				// Your own communities, to mark the ones you share. Skipped on your
				// own profile, where every one would match.
				const mineReady: Promise<Set<number>> = SETTINGS.get("profile.mutualCommunities")
					? loggedInUserPromise.then((me) =>
							me > 0 && me !== userId ? getOwnCommunities(me) : new Set<number>(),
						)
					: Promise.resolve(new Set<number>())

				ready(() => {
					// Asked for directly: Roblox only loads this list for its own
					// communities section, which this layout replaces.
					RobloxApi.groups.getUserGroupRoles(userId).then(async (json) => {
						const mine = await mineReady
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
						// The primary community first, then the ones you share.
						const rank = (entry: any) =>
							entry.isPrimaryGroup ? 0 : mine.has(entry.group.id) ? 1 : 2
						const groups = json.data.toSorted((a: any, b: any) => rank(a) - rank(b))

						const mutual = groups.filter((entry: any) => mine.has(entry.group.id)).length
						if (mutual) {
							newCont
								.$req(".btr-profile-groups h2")
								.append(html`<span class="btr-mutual-count">· ${mutual} mutual</span>`)
						}

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

							if (mine.has(group.id)) {
								parent.classList.add("btr-mutual-group")
								parent
									.$req(".card-thumb-container")
									.append(html`<span class="btr-mutual-badge">Mutual</span>`)
							}

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
				// Roblox does not reliably send the Experiences component, even for a
				// user with games, so waiting on it left the section spinning. The
				// games list fetched for the visit count is what this is built from.
				// The component is used only if it has already arrived, since it
				// carries Roblox's own ordering.
				const games = await gamesPromise.catch(() => null)

				const experiences: { universeId: number }[] =
					profileData[userIdString]?.components?.Experiences?.experiences ??
					(games?.data ?? []).map((game: any) => ({ universeId: game.id }))

				const content = newCont.$req(".btr-profile-games > .btr-games-content")

				if (!experiences.length) {
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

				pager.setMaxPage(Math.floor((experiences.length - 1) / pageSize) + 1)

				for (const { universeId } of experiences) {
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
											<div class="text-label slide-item-stat-title">Playing</div>
											<div class="text-lead slide-item-members-count">&nbsp;</div>
										</li>
										<li class="list-item">
											<div class="text-label slide-item-stat-title">Visits</div>
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

						injectScript.call("setupGamePopovers", `[data-bind='btr-placedrop-${universeId}']`)
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

						const _placeDetails = await RobloxApi.games.getPlaceDetails.batch(placeId)
						const placeDetails = _placeDetails.find((x: any) => x.placeId === placeId)

						const desc = item.$req(".btr-game-desc-content")
						desc.textContent = placeDetails.description || "This game has no description"

						injectScript.call("linkify", desc)

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
									title="${(prohibitedReasons as Record<string, any>)[placeDetails.reasonProhibited] || placeDetails.reasonProhibited}"
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
					injectScript.call("profilePlayGame", +ev.currentTarget.dataset.placeid!)
					ev.preventDefault()
				})

				document.body.$on("click", ".btr-btn-edit-place", (ev) => {
					injectScript.call(
						"profileEditPlace",
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
					// The inventory page frame busts:
					//   if (top.location != self.location) top.location = self.location.href
					// which navigates the whole tab to the inventory instead of
					// embedding it. The frame is not allowed to navigate the tab at all.
					// Letting it do so on user activation was not enough: a click on
					// the profile while it loaded lent the frame that activation, and
					// the frame code that removes the buster loads too late to win.
					// Links in the frame ask this page to navigate instead.
					const iframe = html<HTMLIFrameElement>`<iframe
						id="btr-injected-inventory"
						src="/users/${userId}/inventory"
						scrolling="no"
						sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
					></iframe>`

					window.addEventListener("message", (ev: MessageEvent) => {
						if (ev.origin !== location.origin || ev.source !== iframe.contentWindow) {
							return
						}

						const href = ev.data?.btrInventoryNavigate
						if (typeof href !== "string") {
							return
						}

						const url = new URL(href, location.href)
						if (url.origin === location.origin) {
							location.assign(url.href)
						}
					})

					newCont.$req(".placeholder-inventory").replaceWith(iframe)
				})
			}

			profileContainer.after(newCont)
		})
	})
}
