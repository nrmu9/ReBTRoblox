import { IS_DEV_MODE } from "@/entries/inject/state"
import { hijackXHR } from "@/entries/inject/hooks"
import { contentScript } from "@/entries/inject/messaging"
import { reactHook } from "@/entries/inject/react"

// Injected functions for profile pages.

export const profileFunctions: Record<string, (...args: any[]) => any> = {
	profile: () => {
		// Roblox dropped the tabs for one long page, .profile-content.
		reactHook.inject(">.profile-tab-content,>.profile-content", (tabContent: any) => {
			if (!Array.isArray(tabContent[0].props.children)) {
				return
			}

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
						// The page code moves these into the profile layout. Moving a
						// section's own nodes breaks react, which throws on its next
						// update and unmounts the whole profile. Two wrappers of our
						// own sit between them: react never touches the inner one,
						// which is what gets moved, and everything the section
						// updates is inside it and moves along with it.
						if (!child.props.children?.props?.className?.startsWith("btr-wrapper-")) {
							child.props.children = reactHook.createElement("div", {
								className: `btr-wrapper-container-${child.key}`,
								children: reactHook.createElement("div", {
									className: `btr-wrapper-${child.key}`,
									children: child.props.children,
								}),
							})
						}
						break
					default:
						if (IS_DEV_MODE) {
							console.log(`Unknown component '${child.key}'`)
						}
				}
			}
		})

		// Kept as well as sent. On a cold load the content script starts
		// listening after Roblox has already answered, and a message nobody
		// hears is gone, which left the bio, join date and visits empty until
		// a refresh. So the content script asks again once it is listening.
		const profileResponses: Record<string, unknown> = {}

		hijackXHR((request: any) => {
			if (request.url === "https://apis.roblox.com/profile-platform-api/v1/profiles/get") {
				request.onResponse.push((json: any) => {
					if (json?.profileId == null) {
						return
					}

					// Each request carries a few components, so they are merged rather
					// than replaced, and the merged profile is what gets sent.
					const prev: any = profileResponses[json.profileId]
					const merged = prev
						? { ...prev, ...json, components: { ...prev.components, ...json.components } }
						: json

					profileResponses[json.profileId] = merged
					contentScript.send("profileData", merged)
				})
			}
		})

		contentScript.listen("requestProfileData", (profileId: string) => {
			const json = profileResponses[profileId]

			if (json) {
				contentScript.send("profileData", json)
			}
		})
	},
	profilePlayGame: (placeId: number) => {
		Roblox.GameLauncher.joinMultiplayerGame(placeId, true)
	},
	profileEditPlace: (gameId: number, placeId: number) => {
		Roblox.GameLauncher.editGameInStudio(placeId, gameId)
	},
}
