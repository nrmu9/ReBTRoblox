export const dateSince = (date: any, relativeTo?: any, short = false): string => {
	if(relativeTo instanceof Date) {
		relativeTo = relativeTo.getTime()
	} else if(typeof relativeTo === "string") {
		relativeTo = new Date(relativeTo).getTime()
	} else if(!relativeTo) {
		relativeTo = Date.now()
	}

	if(date instanceof Date) {
		date = date.getTime()
	} else if(typeof date === "string") {
		date = new Date(date).getTime()
	}

	const since = (relativeTo - date) / 1000

	if(Math.floor(since) <= 0) {
		return "Just now"
	}

	const y = Math.floor(since / 3600 / 24 / 365)
	if(y >= 1) { return Math.floor(y) + (short ? " yr" : " year" + (y < 2 ? "" : "s")) + " ago" }

	const M = Math.floor(since / 3600 / 24 / 31)
	if(M >= 1) { return Math.floor(M) + (short ? " mon" : " month" + (M < 2 ? "" : "s")) + " ago" }

	const w = Math.floor(since / 3600 / 24 / 7)
	if(w >= 1) { return Math.floor(w) + (short ? " wk" : " week" + (w < 2 ? "" : "s")) + " ago" }

	const d = Math.floor(since / 3600 / 24)
	if(d >= 1) { return Math.floor(d) + (short ? " dy" : " day" + (d < 2 ? "" : "s")) + " ago" }

	const h = Math.floor(since / 3600)
	if(h >= 1) { return Math.floor(h) + (short ? " hr" : " hour" + (h < 2 ? "" : "s")) + " ago" }

	const m = Math.floor(since / 60)
	if(m >= 1) { return Math.floor(m) + (short ? " min" : " minute" + (m < 2 ? "" : "s")) + " ago" }

	const s = Math.floor(since)
	return Math.floor(s) + (short ? " sec" : " second" + (Math.floor(s) === 1 ? "" : "s")) + " ago"
}
