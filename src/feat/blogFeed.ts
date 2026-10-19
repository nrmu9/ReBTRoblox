import { STORAGE } from "@/core/env"
import { contentScript } from "@/core/messaging"
import { SHARED_DATA } from "@/feat/sharedData"

const BlogFeed = {
	lastRequest: 0,

	fetching: null as Promise<any[]> | null,
	cached: null as any[] | null,

	// The index below is large, so it is fetched at most this often and the
	// cached posts are shown in between. The time is stored with them, as the
	// chrome background worker restarts far more often than that.
	canRequest() {
		return Date.now() > this.lastRequest + 30 * 60e3
	},

	request() {
		if (!this.fetching && this.canRequest()) {
			this.lastRequest = Date.now()

			// The newsroom moved off ButterCMS, whose token now answers 403. The
			// new site's search index lists every post with its date and summary.
			const feedUrl = "https://about.roblox.com/search-index/en.json"

			this.fetching = fetch(feedUrl).then(async (res) => {
				const json: any[] = await res.json()

				const posts = json
					.filter((post) => post.page_type === "newsroom" && post.publishDate && post.url)
					.toSorted((a, b) => Date.parse(b.publishDate) - Date.parse(a.publishDate))
					.slice(0, 3)
					.map((post) => ({
						url: post.url,
						date: post.publishDate,
						title: post.title ?? "",
						desc: post.description ?? "",
					}))

				this.cached = posts

				STORAGE.set({ cachedBlogFeedV3: this.cached, blogFeedFetchedAt: this.lastRequest })
				SHARED_DATA.set("blogfeed", this.cached)

				return this.cached
			})

			this.fetching.finally(() => {
				this.fetching = null
			})
		}

		return this.fetching || Promise.reject()
	},
}

// Requests wait for this, or a worker that just woke would fetch again before
// learning it fetched minutes ago.
const loaded = new Promise<void>((resolve) => {
	STORAGE.get(["cachedBlogFeedV3", "blogFeedFetchedAt"], (data) => {
		if (data.cachedBlogFeedV3 && !BlogFeed.cached) {
			BlogFeed.cached = data.cachedBlogFeedV3 as any[]
			BlogFeed.lastRequest = Math.max(BlogFeed.lastRequest, Number(data.blogFeedFetchedAt) || 0)
			SHARED_DATA.set("blogfeed", BlogFeed.cached)
		}

		resolve()
	})
})

// What the ButterCMS feed left behind.
STORAGE.remove("cachedBlogFeedV2")

contentScript.listen({
	requestBlogFeed(_: any, respond: ((value?: any, hasMore?: boolean) => void) & { cancel: () => void }) {
		void loaded.then(() => {
			if (BlogFeed.cached) {
				respond(BlogFeed.cached, true)
			}

			BlogFeed.request().then(
				(data: any) => respond(data),
				() => respond.cancel(),
			)
		})
	},
})
