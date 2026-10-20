// The shape of SettingsModal, which the settings modules are handed as `modal`.

export interface SettingsModalState {
	enabled: boolean
	visible?: boolean
	settingsDiv?: any
	contentDivs?: any
	currentContent?: any
	themeObserver?: any
	[key: string]: any
}
