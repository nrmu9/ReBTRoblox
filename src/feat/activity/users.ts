// Names for user ids, as they are now: asked for 100 at a time, banned users
// included, so a log can show who someone was even after they are gone.

export type UserName = { name: string; displayName: string }

export const userNames = async (userIds: number[]): Promise<Map<number, UserName>> => {
	const names = new Map<number, UserName>()

	for (let i = 0; i < userIds.length; i += 100) {
		const res = await fetch("https://users.roblox.com/v1/users", {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userIds: userIds.slice(i, i + 100), excludeBannedUsers: false }),
		}).catch(() => null)

		for (const user of res?.ok ? ((await res.json().catch(() => null))?.data ?? []) : []) {
			names.set(user.id, { name: user.name, displayName: user.displayName })
		}
	}

	return names
}
