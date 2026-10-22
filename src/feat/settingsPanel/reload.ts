import { html } from "@/core/html"
import { SETTINGS } from "@/feat/settings"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// The reload prompt, and the marks on settings that only apply after a reload.

// The reload prompt. Settings that already re-read their value apply
// live, so only the rest ask for one, and only while they differ from
// what the page booted with. Anything listed as live must genuinely
// handle being switched off again, not just on.
export const setupReloadPrompt = (modal: SettingsModalState) => {
	const APPLIES_LIVE = new Set([
		"general.syncSettings",
		"general.theme",
		"general.enableContextMenus",
		"general.robuxToUSDRate",
		"general.hideSponsored",
		"navigation.noHamburger",
		"navigation.elements",
		"navigation.order",
		"navigation.hiddenItems",
		"home.hiddenSections",
		"messages.markAllAsRead",
		"messages.pageJump",
		"general.hideChat",
		"general.smallChatButton",
		"general.whatsNew",
		"general.voiceChatStatus",
		"general.hoverPreviewMode",
		"profile.liveTracking",
		"profile.activityLimit",
		"profile.friendLog",
		"itemdetails.itemPreviewer",
		"itemdetails.explorerButton",
		"itemdetails.downloadButton",
		"itemdetails.contentButton",
	])

	const bar: HTMLElement = modal.settingsDiv.$req(".btr-settings-reload")

	// Settings that wait for a reload say so up front, with a small mark.
	for (const row of modal.settingsDiv.$findAll(".btr-setting-row[data-path]")) {
		if (!APPLIES_LIVE.has(row.dataset.path)) {
			row.$find(".btr-setting-label")?.append(
				html`<span
					class="btr-setting-reload-mark"
					title="Applies after a reload"
					aria-label="Applies after a reload"
					>↻</span
				>`,
			)
		}
	}
	const bootValues = new Map<string, any>()

	// Objects never compare equal by identity, so values are compared
	// serialised, which keeps the revert check working for them.
	const stamp = (value: any) => (value instanceof Object ? JSON.stringify(value) : value)

	const collect = (group: any, prefix: string) => {
		for (const [key, value] of Object.entries(group) as [string, any][]) {
			if (key.startsWith("_") || !(value instanceof Object)) {
				continue
			}

			if ("value" in value) {
				bootValues.set(prefix + key, stamp(value.value))
			} else {
				collect(value, prefix + key + ".")
			}
		}
	}

	collect(SETTINGS.loadedSettings, "")

	const dirty = new Set<string>()

	bar.$req("button").$on("click", () => location.reload())

	SETTINGS.onChange((value: any, _isDefault: boolean, settingPath: string) => {
		if (!settingPath || APPLIES_LIVE.has(settingPath)) {
			return
		}

		if (bootValues.has(settingPath) && bootValues.get(settingPath) === stamp(value)) {
			dirty.delete(settingPath)
		} else {
			dirty.add(settingPath)
		}

		bar.hidden = dirty.size === 0

		for (const row of modal.settingsDiv.$findAll(".btr-setting-row[data-path]")) {
			row.classList.toggle("btr-setting-pending", dirty.has(row.dataset.path))
		}
	})
}
