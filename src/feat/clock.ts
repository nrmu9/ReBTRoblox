import { SETTINGS } from "@/feat/settings"

/** The time part of a date format, in the clock the settings ask for. */
export const clockFormat = (seconds = false): string =>
	SETTINGS.get("general.twelveHourClock")
		? seconds
			? "h:mm:ss A"
			: "h:mm A"
		: seconds
			? "HH:mm:ss"
			: "HH:mm"
