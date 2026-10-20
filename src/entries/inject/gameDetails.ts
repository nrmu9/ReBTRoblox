import { hijackFunction } from "@/entries/inject/hooks"
import { reactHook } from "@/entries/inject/react"

// Injected functions for the game details page, apart from its server list.

export const gameDetailsFunctions: Record<string, (...args: any[]) => any> = {
	// Sets up the ... menu ReBTRoblox adds to games that come without one.
	gamedetailsSetupMenu: () => {
		Roblox?.BootstrapWidgets?.SetupPopover(null, null, "[data-bind='game-context-menu']")
	},
	// Closes that menu, which clicking its button from a script does not.
	gamedetailsCloseMenu: () => {
		;(window as any).jQuery?.("[data-bind='game-context-menu']").popover?.("hide")
	},
	gamedetails: () => {
		reactHook.inject(".game-description-container", (elem: any) => {
			elem.replaceWith(
				reactHook.createElement(
					"div",
					{ style: { display: "contents" } },
					reactHook.createElement(
						"div",
						{ id: "btr-description-wrapper", style: { display: "contents" } },
						elem[0],
					),
				),
			)
		})

		reactHook.inject(".container-list.games-detail", (elem: any) => {
			elem.replaceWith(
				reactHook.createElement(
					"div",
					{ style: { display: "contents" } },
					reactHook.createElement(
						"div",
						{ id: "btr-recommendations-wrapper", style: { display: "contents" } },
						elem[0],
					),
				),
			)
		})

		// Each link is now a component of its own, keyed by the social link id
		// and taking its address as url, so it is matched by its classes
		// rather than as a child of the list. The list keeps the links in its
		// first state, which is what a match is checked against.
		reactHook.inject(".btn-secondary-lg.border", (elem: any) => {
			const socials = reactHook.renderTarget?.state[0]?.[0]
			const entry = Array.isArray(socials)
				? socials.find((x: any) => x?.id === +elem[0].key && typeof x.url === "string")
				: null

			if (entry) {
				elem[0].props.url = entry.url
				elem[0].props.href = entry.url

				hijackFunction(elem[0].props, "onClick", (target: any, thisArg: any, args: any[]) => {
					const event = args[0]
					event.preventDefault()

					const result = target.apply(thisArg, args)
					return result
				})
			}
		})
	},
	gamedetailsJoinServer: (placeId: number, jobId: string) => {
		Roblox.GameLauncher.joinGameInstance(placeId, jobId)
	},
	gamedetailsPlayGame: (placeId: number) => {
		Roblox.GameLauncher.joinMultiplayerGame(placeId, true)
	},
}
