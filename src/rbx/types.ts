// Shapes for the Roblox web APIs used in rbx/RobloxApi.
//
// These describe the fields this codebase actually reads, not the full payloads.
// Anything not modelled here stays absent on purpose: adding speculative fields
// would claim guarantees Roblox has not made, and the point of these types is to
// fail loudly when a response Roblox changed stops matching what we consume.

// Fixed-shape numeric data. These arrive from the parsers as plain arrays, but
// their length is fixed by the format, so saying so lets indexing be checked
// rather than assumed.

/** Roblox CFrame: position xyz followed by a row major 3x3 rotation. */
export type CFrameTuple = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
]

/** A quaternion, x y z w. */
export type QuatTuple = readonly [number, number, number, number]

/** A position or scale, x y z. */
export type Vector3Tuple = readonly [number, number, number]

/** A uv rectangle: x, y, width, height. */
export type UVBox = readonly [number, number, number, number]

/** Colour channels, 0 to 255. */
export type RGB = readonly [number, number, number]

export type AssetId = number
export type UserId = number
export type PlaceId = number
export type UniverseId = number
export type GroupId = number
export type BadgeId = number
export type BundleId = number
export type OutfitId = number
export type GamePassId = number

/** Path segment for the collections endpoints. */
export type CollectionItemType = "asset" | "bundle"

/** Query values accepted by the endpoints that take a raw parameter bag. */
export type UrlParams = URLSearchParams | Record<string, string | number | boolean> | string

/** Cursor paged list, the standard envelope across the v1 and v2 APIs. */
export interface Paged<T> {
	data: T[]
	nextPageCursor?: string | null
	previousPageCursor?: string | null
}

/** Endpoints that return a bare list under `data` with no cursor. */
export interface Listed<T> {
	data: T[]
}

//

export type ThumbnailState =
	"Completed" | "Pending" | "Blocked" | "Error" | "InReview" | "TemporarilyUnavailable"

export interface Thumbnail {
	targetId: number
	state: ThumbnailState
	imageUrl: string
	version?: string
}

/** Thumbnails keyed by universe rather than by the requested id. */
export interface UniverseThumbnails {
	universeId: UniverseId
	error: unknown
	thumbnails: Thumbnail[]
}

export type ThumbnailSize = string

//

export interface UserDetail {
	id: UserId
	name: string
	displayName: string
	hasVerifiedBadge?: boolean
	description?: string
	created?: string
	isBanned?: boolean
}

export interface UsernameLookup {
	id: UserId
	name: string
	displayName: string
	requestedUsername: string
}

export type PresenceType = 0 | 1 | 2 | 3

export interface UserPresence {
	userId: UserId
	userPresenceType: PresenceType
	lastLocation?: string
	placeId?: PlaceId | null
	rootPlaceId?: PlaceId | null
	gameId?: string | null
	universeId?: UniverseId | null
	lastOnline?: string
}

export interface PresenceResponse {
	userPresences: UserPresence[]
}

//

export interface AssetDetails {
	AssetId: AssetId
	ProductId?: number
	Name: string
	Description?: string
	AssetTypeId: number
	Creator?: { Id: UserId; Name: string; CreatorType?: string; CreatorTargetId?: number }
	IsForSale?: boolean
	PriceInRobux?: number | null
	Created?: string
	Updated?: string
}

export interface CatalogItemRequest {
	itemType: "Asset" | "Bundle"
	id: AssetId | BundleId
}

export interface CatalogItemDetail {
	id: AssetId | BundleId
	itemType: "Asset" | "Bundle"
	assetType?: number
	name: string
	description?: string
	price?: number | null
	lowestPrice?: number | null
	creatorTargetId?: UserId
	creatorName?: string
	creatorType?: string
	productId?: number
}

export interface BundleDetails {
	id: BundleId
	name: string
	description?: string
	bundleType?: string
	items?: { id: AssetId; name: string; type: string }[]
	creator?: { id: UserId; name: string; type: string }
}

//

export interface PlaceDetails {
	placeId: PlaceId
	name: string
	description?: string
	universeId: UniverseId
	url?: string
	builder?: string
	builderId?: UserId
	isPlayable?: boolean
	price?: number | null
}

export interface GameDetails {
	id: UniverseId
	rootPlaceId: PlaceId
	name: string
	description?: string | null
	creator: { id: number; name: string; type: string }
	playing?: number
	visits?: number
	maxPlayers?: number
	created?: string
	updated?: string
	favoritedCount?: number
}

//

export interface BadgeDetails {
	id: BadgeId
	name: string
	description?: string | null
	displayName?: string
	enabled?: boolean
	iconImageId?: AssetId
	awardingUniverse?: { id: UniverseId; name: string; rootPlaceId: PlaceId }
}

export interface AwardedDate {
	badgeId: BadgeId
	awardedDate: string
}

//

export interface AvatarRules {
	playerAvatarTypes?: string[]
	scales?: Record<string, { min: number; max: number; increment: number }>
	bodyColorsPalette?: { brickColorId: number; name: string; hexColor: string }[]
	basicBodyColorsPalette?: { brickColorId: number; name: string; hexColor: string }[]
	wearableAssetTypes?: { maxNumber: number; id: number; name: string }[]
}

export interface AvatarBodyColors {
	headColorId?: number
	torsoColorId?: number
	rightArmColorId?: number
	leftArmColorId?: number
	rightLegColorId?: number
	leftLegColorId?: number
}

export interface AvatarDefinition {
	scales?: Record<string, number>
	playerAvatarType?: string
	bodyColors?: AvatarBodyColors
	bodyColor3s?: Record<string, string>
	assets?: { id: AssetId; name: string; assetType: { id: number; name: string } }[]
}

export interface OutfitDetails extends AvatarDefinition {
	id: OutfitId
	name: string
}

//

export interface GamePassDetails {
	TargetId?: GamePassId
	Name?: string
	Description?: string
	IsForSale?: boolean
	PriceInRobux?: number | null
	Creator?: { Id: UserId; Name: string }
}

export interface GroupRole {
	group: { id: GroupId; name: string; memberCount?: number }
	role: { id: number; name: string; rank: number }
}

export interface GroupRolesResponse {
	data: GroupRole[]
}

//

export interface InventoryItem {
	assetId: AssetId
	name?: string
	assetType?: string
	created?: string
	userAssetId?: number
}

export interface AssetOwner {
	id: number
	serialNumber?: number | null
	owner: { id: UserId; type: string; name: string } | null
	created?: string
	updated?: string
}

//

export interface PrivateMessage {
	id: number
	sender: { id: UserId; name: string; displayName?: string }
	subject: string
	body: string
	created: string
	isRead: boolean
	isSystemMessage?: boolean
}

export interface UnreadCount {
	count: number
}

export interface Conversation {
	id: number
	title?: string
	participants?: { targetId: UserId; name: string }[]
}

//

/** Protobuf duration, so the fields are capitalised and Seconds is a string. */
export interface VoiceBanDuration {
	Seconds: string | number
	Nanos?: string | number
}

export interface VoiceSettingsResponse {
	isVoiceEnabled: boolean
	isUserOptIn: boolean
	isUserEligible: boolean
	isBanned: boolean
	banReason?: number
	bannedUntil: VoiceBanDuration | null
	isVerifiedForVoice?: boolean
	canVerifyAgeForVoice?: boolean
	isOptInDisabled?: boolean
	hasEverOpted?: boolean
}
