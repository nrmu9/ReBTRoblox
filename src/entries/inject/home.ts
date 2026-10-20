import { settings } from "@/entries/inject/state"
import { hijackXHR } from "@/entries/inject/hooks"
import { contentScript } from "@/entries/inject/messaging"
import { reactHook } from "@/entries/inject/react"

// Injected functions for Home and the game lists: friends, rows and the game filter.

/**
 * Whether a game stays in a list: sponsored ones go with Hide Sponsored,
 * disliked ones with Hide Disliked. Null when neither is on. Read per
 * response, so changes apply on the next load without a reload of this.
 */
export const gameFilter = (): ((game: any) => boolean) | null => {
	const hideSponsored = !!settings.general?.hideSponsored
	let disliked = new Set<string>()

	if (settings.home?.hideDisliked) {
		try {
			disliked = new Set(
				JSON.parse(localStorage.getItem("ReBTRoblox:dislikedPlaces") || "[]").map(String),
			)
		} catch {}
	}

	if (!hideSponsored && !disliked.size) {
		return null
	}

	return (game: any) => !(hideSponsored && game?.isSponsored) && !disliked.has(String(game?.rootPlaceId))
}

export const homeFunctions: Record<string, (...args: any[]) => any> = {
	initReactFriends: () => {
		reactHook.hijackConstructor(
			// FriendsCarouselContainer
			(props: any) => "profileUserId" in props && "carouselName" in props,
			(target: any, thisArg: any, args: any[]) => {
				// disable MustHideConnections so that friends load in faster
				reactHook.hijackUseState(
					(value: any, index: number) => value === false && index === 4,
					(value: any, initial: any) => (initial ? true : value),
				)

				const result = target.apply(thisArg, args)

				// if MustHideConnect is enabled, communicate that to profile code somehow
				if (reactHook.renderTarget?.state?.[4]?.[0] === false) {
					const noFriendsLabel = reactHook.querySelector(result, ".friends-carousel-0-friends")

					if (noFriendsLabel) {
						noFriendsLabel.props.className += " btr-friends-carousel-disabled"
					}
				}

				return result
			},
		)

		reactHook.hijackConstructor(
			// FriendsList
			(props: any) => "friendsList" in props,
			(target: any, thisArg: any, args: any[]) => {
				const props = args[0]
				const friendsList = props.friendsList
				const carouselName = props.carouselName

				let showSecondRow = false

				if (carouselName === "WebHomeFriendsCarousel") {
					showSecondRow = settings.home?.friendsSecondRow
				} else if (carouselName === "WebProfileFriendsCarousel") {
					showSecondRow = settings.home?.friendsSecondRow

					// Fixes an issue where profile friends list shows one too few friends
					props.isAddFriendsTileEnabled = false
				}

				if (showSecondRow) {
					reactHook.hijackUseState(
						// visibleFriendsList
						(value: any, _index: number) => value === friendsList,
						(value: any, initial: any) => {
							if (value && friendsList && !initial) {
								let count = value.length * 2

								if (carouselName === "WebHomeFriendsCarousel") {
									const isTwoLines = value.length < friendsList.length
									localStorage.setItem(
										"ReBTRoblox:homeFriendsIsTwoLines",
										isTwoLines ? "true" : "false",
									)

									// account for Add Friends button
									count += 1
								}

								return friendsList.slice(0, count)
							}

							return value
						},
					)
				}

				const result = target.apply(thisArg, args)

				try {
					result.props.className = `${result.props.className ?? ""} btr-friends-list`
				} catch (ex) {
					console.error(ex)
				}

				if (showSecondRow) {
					try {
						result.props.className = `${result.props.className ?? ""} btr-friends-secondRow`
					} catch (ex) {
						console.error(ex)
					}

					if (carouselName === "WebHomeFriendsCarousel") {
						if (
							!friendsList &&
							localStorage.getItem("ReBTRoblox:homeFriendsIsTwoLines") === "true"
						) {
							try {
								result.props.className = `${result.props.className ?? ""} btr-friends-loading-two-lines`
							} catch (ex) {
								console.error(ex)
							}
						}
					}
				}

				return result
			},
		)

		if (settings.home?.friendsShowUsername) {
			const friendsState = reactHook.createGlobalState({})

			hijackXHR((request: any) => {
				if (
					request.method === "POST" &&
					request.url === "https://apis.roblox.com/user-profile-api/v1/user/profiles/get-profiles"
				) {
					request.onRequest.push((request: any) => {
						const json = JSON.parse(request.body)

						if (!json.fields.includes("names.username")) {
							json.fields.push("names.username")
						}

						request.body = JSON.stringify(json)
					})

					request.onResponse.push((json: any) => {
						for (const user of json.profileDetails) {
							friendsState.value[user.userId] = user
						}

						friendsState.update()
					})
				}
			})

			reactHook.hijackConstructor(
				// FriendTileContent
				(props: any) => props.displayName && props.userProfileUrl,
				(target: any, thisArg: any, args: any[]) => {
					const result = target.apply(thisArg, args)

					try {
						const userId = args[0].id

						const labels = reactHook.queryElement(result, (x: any) =>
							x.props.className?.includes("friends-carousel-tile-labels"),
						)
						if (labels && Array.isArray(labels.props.children)) {
							const friends = reactHook.useGlobalState(friendsState)
							const friend = friends[userId]

							if (friend) {
								labels.props.children.splice(
									1,
									0,
									reactHook.createElement("div", {
										className:
											"friends-carousel-tile-sublabel btr-friends-carousel-username-label",
										children: reactHook.createElement("span", {
											className: "btr-friends-carousel-username",
											children: `@${friend.names.username}`,
										}),
									}),
								)
							}
						}
					} catch (ex) {
						console.error(ex)
					}

					return result
				},
			)
		}

		if (settings.home?.friendPresenceLinks) {
			reactHook.hijackConstructor(
				// FriendTileDropdown
				(props: any) => props.friend && props.gameUrl,
				(target: any, thisArg: any, args: any[]) => {
					const result = target.apply(thisArg, args)

					try {
						const card = result.props.children?.[0]

						if (card?.props.className?.includes("in-game-friend-card")) {
							result.props.children[0] = reactHook.createElement("a", {
								href: args[0].gameUrl,
								style: { display: "contents" },
								onClick: (event: Event) => event.preventDefault(),
								children: card,
							})
						}
					} catch (ex) {
						console.error(ex)
					}

					return result
				},
			)
		}
	},
	// The same filter on Charts and search, which list games their own way.
	filterGames: () => {
		hijackXHR((request: any) => {
			const charts = /^https:\/\/apis\.roblox\.com\/explore-api\/v1\/get-sort/i.test(request.url)
			const search = /^https:\/\/apis\.roblox\.com\/search-api\/omni-search/i.test(request.url)

			if (!charts && !search) {
				return
			}

			request.onResponse.push((json: any) => {
				const keep = gameFilter()

				if (!keep) {
					return
				}

				if (charts) {
					for (const sort of json?.sorts ?? [json]) {
						if (Array.isArray(sort?.games)) {
							sort.games = sort.games.filter(keep)
						}
					}
				} else if (Array.isArray(json?.searchResults)) {
					json.searchResults = json.searchResults.filter((result: any) => {
						if (result?.contentGroupType !== "Game" || !Array.isArray(result.contents)) {
							return true
						}

						result.contents = result.contents.filter(keep)
						return result.contents.length > 0
					})
				}
			})
		})
	},
	// Reports the rows Home loads, so the settings can list them, and drops
	// the hidden ones from the response before Roblox renders any of it.
	// Rows are matched by topic id, which unlike the title is not translated.
	homeRows: () => {
		hijackXHR((request: any) => {
			if (
				request.method !== "POST" ||
				!/^https:\/\/apis\.roblox\.com\/discovery-api\/omni-recommendation$/i.test(request.url)
			) {
				return
			}

			request.onResponse.push((json: any) => {
				if (!Array.isArray(json?.sorts)) {
					return
				}

				contentScript.send(
					"homeRows",
					json.sorts.map((sort: any) => ({
						id: String(sort.topicId),
						title: sort.topic,
						subtitle: sort.subtitle,
					})),
				)

				let hidden: string[] = []

				try {
					hidden = JSON.parse(settings.home?.hiddenRows || "[]")
				} catch {}

				if (Array.isArray(hidden) && hidden.length) {
					for (let i = json.sorts.length - 1; i >= 0; i--) {
						if (hidden.includes(String(json.sorts[i].topicId))) {
							json.sorts.splice(i, 1)
						}
					}
				}

				const keep = gameFilter()

				if (keep) {
					const games = json.contentMetadata?.Game ?? {}

					for (const sort of json.sorts) {
						if (Array.isArray(sort.recommendationList)) {
							sort.recommendationList = sort.recommendationList.filter(
								(item: any) => item?.contentType !== "Game" || keep(games[item.contentId]),
							)
						}
					}
				}
			})
		})
	},
	hideFriendActivity: () => {
		hijackXHR((request: any) => {
			if (
				request.method === "POST" &&
				request.url.match(
					/^https:\/\/apis\.roblox\.com\/discovery-api\/omni-recommendation(-metadata)?$/i,
				)
			) {
				request.onResponse.push((json: any) => {
					if (json?.contentMetadata?.Game) {
						for (const gameData of Object.values(json.contentMetadata.Game) as any[]) {
							delete gameData.friendActivityTitle
						}
					}
				})
			}
		})
	},
	favoritesAtTop: () => {
		hijackXHR((request: any) => {
			if (
				request.method === "POST" &&
				request.url.match(
					/^https:\/\/apis\.roblox\.com\/discovery-api\/omni-recommendation(-metadata)?$/i,
				)
			) {
				request.onResponse.push((json: any) => {
					if (settings.home.favoritesAtTop && json?.sorts) {
						const favoritesSort = json.sorts.find((x: any) => x.topicId === 100000001)
						const continueSort = json.sorts.find((x: any) => x.topicId === 100000003)

						if (favoritesSort) {
							json.sorts.splice(json.sorts.indexOf(favoritesSort), 1)
							json.sorts.splice(1, 0, favoritesSort)
						}

						if (continueSort) {
							json.sorts.splice(json.sorts.indexOf(continueSort), 1)
							json.sorts.splice(1, 0, continueSort)
						}
					}
				})
			}
		})
	},
	showRecommendationPlayerCount: () => {
		reactHook.hijackConstructor(
			(props: any) => "wideTileType" in props && "gameData" in props && "playerCountStyle" in props,
			(target: any, thisArg: any, args: any[]) => {
				const props = args[0]
				props.playerCountStyle = "Footer"
				return target.apply(thisArg, args)
			},
		)
	},
	instantGameHoverAction: () => {
		reactHook.inject(".hover-game-tile.old-hover", (elem: any) => {
			const props = elem[0].props

			const [isFocused, setIsFocused] = reactHook.React.useState(false)

			props.className = (props.className ?? "").replace(/\bfocused\b/, "")
			props.className += " btr-game-hover-fix"

			if (isFocused) {
				props.className += " focused"
			}

			props.onMouseOver = new Proxy(props.onMouseOver ?? (() => {}), {
				apply(target: any, thisArg: any, args: any[]) {
					setIsFocused(true)
					return target.apply(thisArg, args)
				},
			})

			props.onMouseLeave = new Proxy(props.onMouseLeave ?? (() => {}), {
				apply(target: any, thisArg: any, args: any[]) {
					setIsFocused(false)
					return target.apply(thisArg, args)
				},
			})
		})
	},
}
