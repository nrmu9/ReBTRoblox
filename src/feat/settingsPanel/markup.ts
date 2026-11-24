import { html } from "@/core/html"

// The settings panel's markup, before init() turns its pages into tabs and rows.

// Each <page> becomes a tab. A page with a path and toggle gets a switch
// for its whole feature at the top, and its rows follow that switch.
// <toggle> and <choice> are rows bound to a setting, relative to the page
// path; `require` names the setting a row depends on, `!` inverting it.
export const settingsMarkup = () =>
	html` <div class="btr-settings-modal">
		<div class="btr-settings" role="dialog" aria-modal="true" aria-label="ReBTRoblox settings">
			<aside class="btr-settings-sidebar">
				<div class="btr-settings-brand">
					<span class="btr-settings-brand-title">ReBTRoblox</span>
					<button type="button" class="btr-settings-brand-version" title="What's new">
						v${chrome.runtime.getManifest().version}
					</button>
					<a
						class="btr-settings-brand-link"
						href="https://www.roblox.com/users/864843843/profile"
						target="_blank"
						rel="noopener"
						title="Made by pwu_p"
						aria-label="Made by pwu_p, on Roblox"
					>
						<span class="icon icon-filled-tilt" aria-hidden="true"></span>
					</a>
				</div>
				<label class="btr-settings-search">
					<span class="icon icon-regular-magnifying-glass" aria-hidden="true"></span>
					<input
						type="search"
						placeholder="Search settings"
						spellcheck="false"
						autocomplete="off"
					/>
					<button
						type="button"
						class="btr-settings-search-clear"
						aria-label="Clear search"
						title="Clear search"
						hidden
					>
						<span class="icon icon-regular-x" aria-hidden="true"></span>
					</button>
				</label>
				<nav class="btr-settings-tabs" role="tablist" aria-orientation="vertical"></nav>
			</aside>

			<div class="btr-settings-main">
				<header class="btr-settings-header">
					<h2 class="btr-settings-title"></h2>
					<button
						type="button"
						class="btr-settings-icon-button btr-settings-toggle"
						aria-label="Close"
						title="Close"
					>
						<span class="icon icon-regular-x" aria-hidden="true"></span>
					</button>
				</header>

				<div class="btr-settings-body">
					<page name="general" label="General" icon="gear" path="general">
						<toggle
							label="Hide Sponsored Experiences"
							path="hideSponsored"
							desc="Hides sponsored games"
						></toggle>
						<toggle
							label="Hide Disliked Games"
							path="home.hideDisliked"
							desc="Hides games you disliked from Home, Charts and search. It picks up your dislikes as you vote on games"
						></toggle>
						<toggle
							label="Fast User Search"
							path="fastSearch"
							desc="Shows matching users as you type in search"
						></toggle>
						<toggle
							label="Voice Chat Status"
							path="voiceChatStatus"
							desc="Shows your voice chat status in the top bar"
						></toggle>
						<toggle
							label="Copy ID Menu Items"
							path="enableContextMenus"
							desc="Adds a Copy ID option when you right click games, items and users"
						></toggle>
						<toggle
							label="Higher Robux Precision"
							path="higherRobuxPrecision"
							desc="Shows your full balance instead of shortening it to 1.2K"
						></toggle>
						<toggle
							label="Show Robux While Loading"
							path="cacheRobuxAmount"
							desc="Shows your last balance while the current one loads"
						></toggle>
						<toggle
							label="12-Hour Clock"
							path="twelveHourClock"
							desc="Shows times like 5:30 PM instead of 17:30"
						></toggle>
						<toggle
							label="Quick Unfriend, Unfollow and Leave"
							path="quickRemove"
							desc="Lets you unfriend, unfollow or leave straight from your friends, following and communities lists. It asks first"
						></toggle>
						<toggle
							label="Show What's New"
							path="whatsNew"
							desc="Shows what changed after an update. Click the version number at the top to see it again"
						></toggle>
						<toggle
							label="Rate Limit Notice"
							path="rateLimitNotice"
							desc="Shows a small notice in the corner while Roblox is rate limiting ReBTRoblox"
						></toggle>

						<heading>Chat</heading>
						<toggle
							label="Show Chat"
							path="!hideChat"
							desc="Shows the chat in the corner of the page"
						></toggle>
						<toggle
							label="Minimize Chat"
							path="smallChatButton"
							require="!hideChat"
							desc="Shrinks the chat into a small button"
						></toggle>
						<toggle
							label="Fix Missing Messages"
							path="fixChatMessages"
							require="!hideChat"
							desc="Fixes chats that are missing messages or only show the newest one. Also stops chat from breaking when you have a lot of Roblox tabs open"
						></toggle>
						<toggle
							label="Search Messages"
							path="chatSearch"
							require="!hideChat"
							desc="Adds a search button to chats that searches the whole conversation"
						></toggle>

						<heading>Robux to Cash</heading>
						<div
							class="btr-setting-row btr-setting-row-block"
							data-search="robux cash currency conversion rate price money"
						>
							<div class="btr-setting-text">
								<span class="btr-setting-label">Conversion Rate</span>
								<span class="btr-setting-desc">Shows Robux prices in real money</span>
							</div>
							<button type="button" class="btr-setting-reset" path="general.robuxToUSDRate">
								Reset
							</button>
							<div class="btr-setting-selects">
								<span class="btr-select"
									><select id="btr-robuxToCash-currency" aria-label="Currency"></select
								></span>
								<span class="btr-select"
									><select id="btr-robuxToCash-rate" aria-label="Rate"></select
								></span>
							</div>
							<label class="btr-robuxToCash-custom" hidden>
								<input
									id="btr-robuxToCash-custom"
									class="btr-exp-input"
									type="text"
									inputmode="decimal"
									spellcheck="false"
									autocomplete="off"
								/>
								<span class="btr-robuxToCash-custom-unit"></span>
							</label>
						</div>
					</page>

					<page
						name="navigation"
						label="Navigation"
						icon="three-bars-horizontal"
						path="navigation"
						toggle
						master="Customize navigation"
					>
						<toggle
							label="Keep Sidebar Open"
							path="noHamburger"
							require="false"
							desc="Keeps the sidebar open on wide screens"
						></toggle>
						<toggle
							label="Activity in Account Menu"
							path="activityMenu"
							desc="Adds an Activity button to the gear menu that opens the activity panel"
						></toggle>
						<p class="btr-exp-note">
							These are the top bar and sidebar of the current page. Drag an item by its handle
							to move it, or click the eye to hide it. New items that Roblox adds later stay
							next to the item before them.
						</p>
						<div class="btr-settings-nav-editor"></div>
					</page>

					<page name="home" label="Home" icon="house" path="home">
						<toggle
							label="Show More Friends"
							path="friendsSecondRow"
							desc="Shows a second row of friends"
						></toggle>
						<toggle
							label="Show Friend Usernames"
							path="friendsShowUsername"
							desc="Shows usernames under display names"
						></toggle>
						<toggle
							label="Link Friend Presence"
							path="friendPresenceLinks"
							desc="Lets you click the game a friend is playing"
						></toggle>
						<toggle
							label="Hide Friend Activity"
							path="hideFriendActivity"
							desc="Hides which friends are playing a game"
						></toggle>
						<toggle
							label="Move Favorites to Top"
							path="favoritesAtTop"
							desc="Moves your Favorites row up on Home, right after Continue"
						></toggle>
						<toggle
							label="Show Player Counts"
							path="showRecommendationPlayerCount"
							desc="Shows how many people are playing each game"
						></toggle>
						<toggle
							label="Instant Game Hover"
							path="instantGameHoverAction"
							desc="Shows game details as soon as you hover a game"
						></toggle>
						<heading>Sections</heading>
						<div class="btr-settings-home-sections"></div>
						<heading>Rows</heading>
						<div class="btr-settings-home-rows"></div>
					</page>

					<page
						name="profile"
						label="Profile"
						icon="person"
						path="profile"
						toggle
						master="Profile layout"
						desc="Uses the ReBTRoblox profile layout"
					>
						<toggle
							label="Classic Layout"
							path="classicLayout"
							desc="Puts the avatar back inside About instead of the big banner at the top"
						></toggle>
						<toggle
							label="Classic Header"
							path="classicHeader"
							require="classicLayout"
							desc="Brings back the old profile header. Extra buttons go in the ... menu"
						></toggle>
						<toggle
							label="Embed Inventory"
							path="embedInventoryEnabled"
							desc="Shows the inventory on the profile"
						></toggle>
						<toggle
							label="Mark Mutual Communities"
							path="mutualCommunities"
							desc="Puts the communities you share first and marks them"
						></toggle>
						<toggle
							label="Exact Follower Counts"
							path="exactCounts"
							desc="Shows exact friend, follower and following counts"
						></toggle>
						<toggle
							label="Full Friends Warning"
							path="fullFriends"
							desc="Turns the friend count red when someone hits Roblox's limit of 1,000 friends"
						></toggle>
					</page>

					<page name="activity" label="Activity" icon="clock" path="profile">
						<toggle
							label="Last Seen Online"
							path="lastSeen"
							require="true"
							desc="Shows when someone was last online and what they were doing. It's based on what ReBTRoblox has seen on this device"
						></toggle>
						<toggle
							label="Track Friends in the Background"
							path="liveTracking"
							require="lastSeen"
							desc="Keeps recording your friends' activity while your browser is open, even without a Roblox tab"
						></toggle>
						<toggle
							label="Friend Log"
							path="friendLog"
							require="liveTracking"
							desc="Records friends you add and lose, friend requests, and who follows and unfollows you"
						></toggle>
						<div class="btr-setting-row" data-search="friend log unfriend removed added history">
							<div class="btr-setting-text">
								<span class="btr-setting-label">View Friend Log</span>
								<span class="btr-setting-desc"
									>Everyone added to or removed from your friends</span
								>
							</div>
							<button type="button" class="btr-settings-button btr-activity-friendlog">
								View
							</button>
						</div>

						<heading>Watched People</heading>
						<p class="btr-exp-intro">
							ReBTRoblox checks on these people in the background. It records where they are,
							friends they add or remove, and changes to their profile. To watch someone, pick
							Watch activity in the ... menu on their profile.
						</p>
						<div class="btr-setting-card btr-activity-watched"></div>

						<heading>Tracked Games and Communities</heading>
						<p class="btr-exp-intro">
							ReBTRoblox checks these in the background. For games it records players, visits
							and updates. For communities it records members, shouts and new games. To track
							one, pick Track activity in the ... menu on its page.
						</p>
						<div class="btr-setting-card btr-activity-tracked"></div>

						<heading>Stored Activity</heading>
						<choice
							label="Storage Limit"
							path="activityLimit"
							require="true"
							desc="Recording stops when it reaches this size. Nothing is deleted automatically"
						>
							<option value="100">100 MB</option>
							<option value="250">250 MB</option>
							<option value="500">500 MB</option>
							<option value="1000">1 GB</option>
							<option value="2000">2 GB</option>
							<option value="0">No limit</option>
						</choice>
						<div
							class="btr-setting-row btr-activity-usage-row"
							data-search="storage size usage space"
						>
							<div class="btr-setting-text">
								<span class="btr-setting-label">Space Used</span>
								<span class="btr-setting-desc btr-activity-usage-text">Checking…</span>
								<span class="btr-activity-meter" aria-hidden="true"><span></span></span>
								<span class="btr-activity-warning" hidden></span>
							</div>
						</div>
						<div class="btr-setting-row" data-search="clear old entries delete">
							<div class="btr-setting-text">
								<span class="btr-setting-label">Clear Old Entries</span>
								<span class="btr-setting-desc">Deletes activity last seen before then</span>
							</div>
							<div class="btr-activity-clear-controls">
								<span class="btr-select"
									><select class="btr-activity-age" aria-label="Clear entries older than">
										<option value="7">Older than a week</option>
										<option value="30" selected>Older than a month</option>
										<option value="90">Older than 3 months</option>
										<option value="180">Older than 6 months</option>
										<option value="365">Older than a year</option>
									</select></span
								>
								<button type="button" class="btr-settings-button btr-activity-clear-old">
									Clear
								</button>
							</div>
						</div>
						<div class="btr-setting-row" data-search="export download backup json">
							<div class="btr-setting-text">
								<span class="btr-setting-label">Export</span>
								<span class="btr-setting-desc btr-activity-export-text"
									>Downloads everything recorded, and who you watch and track, as a JSON
									file. It holds what you recorded about other people, so keep it to
									yourself</span
								>
							</div>
							<button type="button" class="btr-settings-button btr-activity-export">
								Export
							</button>
						</div>
						<div class="btr-setting-row" data-search="import restore backup json">
							<div class="btr-setting-text">
								<span class="btr-setting-label">Import</span>
								<span class="btr-setting-desc btr-activity-import-text"
									>Adds activity from an export, keeping what is already here</span
								>
							</div>
							<div class="btr-activity-clear-controls">
								<button
									type="button"
									class="btr-settings-button btr-activity-import-cancel"
									hidden
								>
									Cancel
								</button>
								<button type="button" class="btr-settings-button btr-activity-import">
									Import
								</button>
							</div>
							<input
								type="file"
								class="btr-activity-import-file"
								accept=".json,application/json"
								hidden
							/>
						</div>
						<div class="btr-setting-row" data-search="clear all activity delete everything">
							<div class="btr-setting-text">
								<span class="btr-setting-label">Clear All Activity</span>
								<span class="btr-setting-desc"
									>Deletes everything recorded. Settings are kept</span
								>
							</div>
							<button
								type="button"
								class="btr-settings-button btr-settings-button-alert btr-activity-clear-all"
							>
								Clear all
							</button>
						</div>
					</page>

					<page
						name="gamedetails"
						label="Game Pages"
						icon="controller"
						path="gamedetails"
						toggle
						master="Game page features"
					>
						<toggle
							label="Exact Visit and Like Counts"
							path="exactCounts"
							desc="Shows exact visits, likes and favorites"
						></toggle>
						<toggle
							label="Live Stats"
							path="liveStats"
							desc="Keeps players, visits, favorites and likes up to date while the page is open"
						></toggle>
						<toggle
							label="Your Playtime and Servers"
							path="yourPlaytime"
							require="profile.lastSeen"
							desc="Shows how long you've played a game and which servers you were in recently"
						></toggle>
						<toggle
							label="Paged Server List"
							path="addServerPager"
							desc="Splits the server list into pages"
						></toggle>
						<choice
							label="Server Info"
							path="showServerRegion"
							desc="Shows each server's ping or location"
						>
							<option value="none">Off</option>
							<option value="ping">Ping</option>
							<option value="region">Region</option>
							<option value="both">Ping and region</option>
							<option value="combined">Country only</option>
						</choice>
						<toggle
							label="Server Tools"
							path="serverTools"
							desc="Adds a button to join the smallest server. With Server Info set to Region, you can also filter by region"
						></toggle>
						<choice
							label="Preview Videos"
							path="previewVideos"
							desc="How trailers on game pages behave"
						>
							<option value="paused">Don't autoplay</option>
							<option value="autoplay">Autoplay</option>
							<option value="hidden">Hide</option>
						</choice>
						<toggle
							label="Highlight Owned Badges"
							path="showBadgeOwned"
							desc="Marks badges you already have"
						></toggle>
						<toggle
							label="Compact Badge Stats"
							path="compactBadgeStats"
							desc="Shows badge stats in less space"
						></toggle>
					</page>

					<page
						name="itemdetails"
						label="Item Pages"
						icon="tag"
						path="itemdetails"
						toggle
						master="Item page features"
					>
						<toggle
							label="Show Sales"
							path="showSales"
							desc="Shows how many times an item has sold"
						></toggle>
						<toggle
							label="Show Created and Updated"
							path="showCreatedAndUpdated"
							desc="Shows when an item was created and last updated"
						></toggle>
						<toggle
							label="Exact Favorite Count"
							path="exactCounts"
							desc="Shows the exact number of favorites"
						></toggle>
						<toggle
							label="Explorer Button"
							path="explorerButton"
							desc="Adds a button to look inside models and packages"
						></toggle>
						<toggle
							label="Download Button"
							path="downloadButton"
							desc="Adds a button to download the item"
						></toggle>
						<toggle
							label="Content Button"
							path="contentButton"
							desc="Adds a button to open an item's template or texture"
						></toggle>

						<heading>Previewer</heading>
						<toggle
							label="Item Previewer"
							path="itemPreviewer"
							desc="Shows the item on your avatar in 3D"
						></toggle>
						<choice
							label="Open Automatically"
							path="itemPreviewerMode"
							require="itemPreviewer"
							desc="When the previewer opens automatically"
						>
							<option value="never">Never</option>
							<option value="animations">For animations</option>
							<option value="always">Always</option>
						</choice>
						<toggle
							label="Hover Previewer"
							path="general.hoverPreview"
							mode="general.hoverPreviewMode"
							require="true"
							desc="Previews items when you hover them"
						></toggle>
						<toggle
							label="Layered Clothing"
							path="general.previewLayeredClothing"
							require="true"
							desc="Fits layered clothing to your avatar in previews"
						></toggle>
					</page>

					<page
						name="avatar"
						label="Avatar"
						icon="person-standing"
						path="avatar"
						toggle
						master="Avatar editor features"
					>
						<toggle
							label="Remove Accessory Limits"
							path="removeAccessoryLimits"
							desc="Lets you wear more accessories at once"
						></toggle>
						<toggle
							label="Remove Layered Clothing Limits"
							path="removeLayeredLimits"
							require="removeAccessoryLimits"
							desc="Lets you wear more layered clothing at once"
						></toggle>
						<toggle
							label="Full Range Body Colors"
							path="fullRangeBodyColors"
							desc="Lets you pick any body color"
						></toggle>
						<toggle
							label="Adjust Accessories"
							path="adjustAccessories"
							desc="Adds an Adjust button to move, rotate and resize your accessories"
						></toggle>
						<toggle
							label="Skip R6 Switch Warning"
							path="ignoreR6Warning"
							desc="Switches to R6 without asking first"
						></toggle>
					</page>

					<page
						name="inventory"
						label="Inventory"
						icon="backpack"
						path="inventory"
						toggle
						master="Inventory features"
					>
						<toggle
							label="Inventory Tools"
							path="inventoryTools"
							desc="Lets you remove several items at once"
						></toggle>
					</page>

					<page
						name="catalog"
						label="Marketplace"
						icon="shopping-basket"
						path="catalog"
						toggle
						master="Marketplace features"
					>
						<toggle
							label="Show Owned Items"
							path="showOwnedAssets"
							desc="Marks items you already own"
						></toggle>
					</page>

					<page
						name="messages"
						label="Messages"
						icon="envelope"
						path="messages"
						toggle
						master="Inbox features"
					>
						<toggle
							label="Mark All as Read"
							path="markAllAsRead"
							desc="Adds a button to mark all messages as read"
						></toggle>
						<toggle
							label="Jump to Page"
							path="pageJump"
							desc="Lets you type a page number to jump to it"
						></toggle>
					</page>

					<page
						name="groups"
						label="Communities"
						icon="three-people"
						path="groups"
						toggle
						master="Community page features"
					>
						<toggle
							label="Modify Layout"
							path="modifyLayout"
							desc="Rearranges the community page and adds a payouts tab"
						></toggle>
						<toggle
							label="Exact Member Counts"
							path="exactCounts"
							desc="Shows exact member counts on community pages"
						></toggle>
					</page>

					<page
						name="create"
						label="Create"
						icon="pencil-square"
						path="create"
						toggle
						master="Creator Hub features"
					>
						<toggle
							label="Downloadable Version History"
							path="downloadVersion"
							desc="Lets you download older versions of your places and assets"
						></toggle>
						<toggle
							label="Modify Asset Options"
							path="assetOptions"
							desc="Adds extra links to your creations' menus"
						></toggle>
					</page>

					<page name="advanced" label="Experiments" icon="flag">
						<heading>Recent Errors</heading>
						<div class="btr-setting-card btr-error-log">
							<div
								class="btr-setting-row"
								data-search="errors bug report copy log github issue"
							>
								<div class="btr-setting-text">
									<span class="btr-setting-label btr-error-log-summary">No errors</span>
									<span class="btr-setting-desc"
										>Recent errors, saved on this device. Report on GitHub copies them and
										opens a bug report to paste them into</span
									>
								</div>
								<div class="btr-activity-clear-controls">
									<button type="button" class="btr-settings-button btr-error-log-clear">
										Clear
									</button>
									<button type="button" class="btr-settings-button btr-error-log-copy">
										Copy report
									</button>
									<button type="button" class="btr-settings-button btr-error-log-report">
										Report on GitHub
									</button>
								</div>
							</div>
							<ol class="btr-error-log-list"></ol>
						</div>
						<heading>Unlisted Settings</heading>
						<div id="btr-settings-wip" class="btr-setting-card"></div>
						<heading>Roblox Experiments</heading>
						<div class="btr-exp-toolbar">
							<label class="btr-settings-search btr-exp-filter">
								<span class="icon icon-regular-magnifying-glass" aria-hidden="true"></span>
								<input
									type="search"
									placeholder="Filter experiments"
									spellcheck="false"
									autocomplete="off"
								/>
							</label>
							<button
								type="button"
								id="btr-exp-edited"
								class="btr-settings-button"
								aria-pressed="false"
							>
								Edited only
							</button>
							<button type="button" id="btr-exp-reset" class="btr-settings-button">
								Reset all
							</button>
						</div>
						<p class="btr-exp-intro">
							Some of these are only used by Roblox's apps, not the website. Those are greyed
							out because changing them does nothing here. Most changes apply after you reload.
						</p>
						<p class="btr-exp-note"></p>
						<div id="btr-settings-experiments"></div>
					</page>

					<page name="backup" label="Backup" icon="shield-check" path="general">
						<toggle
							label="Sync Settings"
							path="syncSettings"
							desc="Syncs your settings to other browsers signed in to the same Firefox or Chrome account. They also come back after a reinstall. Recorded activity isn't synced"
						></toggle>
						<heading>Backups</heading>
						<div class="btr-setting-card">
							<div
								class="btr-setting-row"
								data-search="backup export everything settings activity json"
							>
								<div class="btr-setting-text">
									<span class="btr-setting-label">Back Up Everything</span>
									<span class="btr-setting-desc btr-backup-export-text"
										>Downloads your settings and all recorded activity as one file. It
										holds what you recorded about other people, so keep it to
										yourself</span
									>
								</div>
								<button type="button" class="btr-settings-button btr-backup-export">
									Back up
								</button>
							</div>
							<div
								class="btr-setting-row"
								data-search="restore import backup settings activity json"
							>
								<div class="btr-setting-text">
									<span class="btr-setting-label">Restore</span>
									<span class="btr-setting-desc btr-backup-import-text"
										>Brings back settings and activity from a backup. Activity already
										here is kept</span
									>
								</div>
								<div class="btr-activity-clear-controls">
									<button
										type="button"
										class="btr-settings-button btr-backup-import-cancel"
										hidden
									>
										Cancel
									</button>
									<button type="button" class="btr-settings-button btr-backup-import">
										Restore
									</button>
								</div>
								<input
									type="file"
									class="btr-backup-import-file"
									accept=".json,application/json"
									hidden
								/>
							</div>
						</div>
						<heading>Reset</heading>
						<div class="btr-setting-card">
							<div class="btr-setting-row" data-search="reset default all">
								<div class="btr-setting-text">
									<span class="btr-setting-label">Reset All Settings</span>
									<span class="btr-setting-desc"
										>Puts every setting back to its default</span
									>
								</div>
								<button
									type="button"
									id="btr-reset-settings"
									class="btr-settings-button btr-settings-button-alert"
								>
									Reset
								</button>
							</div>
						</div>
					</page>

					<div class="btr-settings-empty" hidden>No settings match your search.</div>
				</div>

				<div class="btr-settings-reload" hidden>
					<span>Some changes apply after a reload.</span>
					<button type="button" class="btr-settings-button btr-settings-button-emphasis">
						Reload
					</button>
				</div>
			</div>
		</div>
	</div>`
