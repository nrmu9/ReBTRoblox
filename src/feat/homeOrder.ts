// The order of Home's rows, set in the settings. Shared by the page script that
// reorders Roblox's response and the settings list that edits it.

/** The saved order, as topic ids. */
export const parseRowOrder = (value: unknown): string[] => {
	try {
		const list = JSON.parse(typeof value === "string" && value ? value : "[]")
		return Array.isArray(list) ? list.map(String) : []
	} catch {
		return []
	}
}

/**
 * Puts the rows that have a place in `order` into that order, in the slots
 * those rows hold now. A row Roblox adds later is in no order yet, so it stays
 * where Roblox put it instead of everything else shifting around it.
 */
export const applyRowOrder = <T>(rows: T[], idOf: (row: T) => string, order: string[]): T[] => {
	const rank = new Map(order.map((id, index) => [id, index]))
	const ordered = rows
		.filter((row) => rank.has(idOf(row)))
		.toSorted((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!)

	let next = 0
	return rows.map((row) => (rank.has(idOf(row)) ? ordered[next++]! : row))
}
