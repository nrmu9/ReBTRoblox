const Months = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
]

const Days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

const Fixed = (num: number, len: number): string => {
	const str = String(num)
	const amt = len - str.length
	return amt > 0 ? "0".repeat(amt) + str : str
}

let DTF: Intl.DateTimeFormat | undefined

export const dateFormat = (date: any, format: string): string => {
	if (typeof date === "string") {
		date = new Date(date)
	}

	return format.replace(/a|A|Z|T|S(SS)?|ss?|mm?|HH?|hh?|D{1,4}|M{1,4}|YY(YY)?|'([^']|'')*'/g, (str) => {
		switch (str[0]) {
			case "'":
				return str.slice(1, -1).replace(/''/g, "'")
			case "a":
				return date.getHours() < 12 ? "am" : "pm"
			case "A":
				return date.getHours() < 12 ? "AM" : "PM"
			case "Z":
				return (
					("+" + -date.getTimezoneOffset() / 60)
						.replace(/^\D?(\D)/, "$1")
						.replace(/^(.)(.)$/, "$10$2") + "00"
				)
			case "T":
				if (!DTF) {
					DTF = new Intl.DateTimeFormat("en-us", { timeZoneName: "short" })
				}
				return DTF.format(date).split(" ")[1]
			case "Y":
				return ("" + date.getFullYear()).slice(-str.length)
			case "M":
				return str.length > 2
					? Months[date.getMonth()].slice(0, str.length > 3 ? 9 : 3)
					: Fixed(date.getMonth() + 1, str.length)
			case "D":
				return str.length > 2
					? Days[date.getDay()].slice(0, str.length > 3 ? 9 : 3)
					: str.length === 2
						? Fixed(date.getDate(), 2)
						: date.getDate()
			case "H":
				return Fixed(date.getHours(), str.length)
			case "h":
				return Fixed(date.getHours() % 12 || 12, str.length)
			case "m":
				return Fixed(date.getMinutes(), str.length)
			case "s":
				return Fixed(date.getSeconds(), str.length)
			case "S":
				return Fixed(date.getMilliseconds(), str.length)
			default:
				return "dapoop?"
		}
	})
}

export const dateSince = (date: any, relativeTo?: any, short = false): string => {
	if (relativeTo instanceof Date) {
		relativeTo = relativeTo.getTime()
	} else if (typeof relativeTo === "string") {
		relativeTo = new Date(relativeTo).getTime()
	} else if (!relativeTo) {
		relativeTo = Date.now()
	}

	if (date instanceof Date) {
		date = date.getTime()
	} else if (typeof date === "string") {
		date = new Date(date).getTime()
	}

	const since = (relativeTo - date) / 1000

	if (Math.floor(since) <= 0) {
		return "Just now"
	}

	const y = Math.floor(since / 3600 / 24 / 365)
	if (y >= 1) {
		return Math.floor(y) + (short ? " yr" : " year" + (y < 2 ? "" : "s")) + " ago"
	}

	const M = Math.floor(since / 3600 / 24 / 31)
	if (M >= 1) {
		return Math.floor(M) + (short ? " mon" : " month" + (M < 2 ? "" : "s")) + " ago"
	}

	const w = Math.floor(since / 3600 / 24 / 7)
	if (w >= 1) {
		return Math.floor(w) + (short ? " wk" : " week" + (w < 2 ? "" : "s")) + " ago"
	}

	const d = Math.floor(since / 3600 / 24)
	if (d >= 1) {
		return Math.floor(d) + (short ? " dy" : " day" + (d < 2 ? "" : "s")) + " ago"
	}

	const h = Math.floor(since / 3600)
	if (h >= 1) {
		return Math.floor(h) + (short ? " hr" : " hour" + (h < 2 ? "" : "s")) + " ago"
	}

	const m = Math.floor(since / 60)
	if (m >= 1) {
		return Math.floor(m) + (short ? " min" : " minute" + (m < 2 ? "" : "s")) + " ago"
	}

	const s = Math.floor(since)
	return Math.floor(s) + (short ? " sec" : " second" + (Math.floor(s) === 1 ? "" : "s")) + " ago"
}
