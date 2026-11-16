export interface CurrencyInfo {
	symbol: string
	name?: string
	usdRate?: number
	fixed?: boolean
	// Local price of each package in cents: all of PACKAGES, or the six in CORE_PACKAGES.
	prices?: number[]
	numFractions?: number
}

export interface RateOption {
	name: string
	label?: string
	cash: number
	robux: number
	usdCash?: number
	currency: CurrencyInfo
}

import { SETTINGS } from "@/feat/settings"
import { formatNumber } from "@/core/util"

// Robux in each package, [website, app]. Buying on the website adds a bonus.
// Roblox Plus has no monthly Robux and the old Premium bonus ended in May 2026,
// so these are the only two ways to buy.
const PACKAGES = [
	[500, 400],
	[1000, 800],
	[1500, 1200],
	[2000, 1700],
	[3625, 3150],
	[5250, 4500],
	[11000, 10000],
	[24000, 22500],
]

// The packages every currency has a local price for ($4.99, $9.99, $19.99, $49.99, $99.99, $199.99).
const CORE_PACKAGES = [0, 1, 3, 5, 6, 7]

/** What a custom rate's text means: a positive amount, with a dot or a comma. */
export const parseCustomRate = (text: unknown) => {
	const amount = Number(
		String(text ?? "")
			.trim()
			.replace(",", "."),
	)
	return Number.isFinite(amount) && amount > 0 ? amount : null
}

/** The custom rate, in cents per 1,000 Robux. */
const customCash = () =>
	SETTINGS.loaded ? Math.round((parseCustomRate(SETTINGS.get("general.robuxToCashCustom")) ?? 0) * 100) : 0

// Currencies that were replaced, so an old choice moves to the new one.
const REPLACED: Record<string, string> = {
	ang: "xcg",
	sll: "sle",
	cuc: "usd",
	hrk: "eur",
	bgn: "eur",
	mxv: "mxn",
}

export const RobuxToCash = {
	// cash is in cents

	UpdateDate: "November 16, 2026",

	Currencies: <Record<string, CurrencyInfo>>{
		None: { symbol: "" },

		USD: { symbol: "$", prices: [499, 999, 1499, 1999, 3499, 4999, 9999, 19999] },
		EUR: { symbol: "€", prices: [599, 1199, 2399, 5999, 11999, 23999] },
		AUD: { symbol: "$", prices: [849, 1699, 3499, 9099, 18499, 36999] },
		GBP: { symbol: "£", prices: [499, 999, 1999, 4999, 9999, 19999] },
		NZD: { symbol: "$", prices: [999, 1899, 3899, 9999, 19999, 39999] },
		CAD: { symbol: "CA$", prices: [699, 1399, 2799, 6999, 13999, 27999] },
		SEK: { symbol: "kr", prices: [6500, 12900, 26900, 69500, 139500, 259500] },
		NOK: { symbol: "kr", prices: [7000, 14000, 28000, 70000, 140000, 280000] },
		DKK: { symbol: "kr.", prices: [4500, 8900, 16900, 44900, 89900, 169900] },
		PLN: { symbol: "zł", prices: [2999, 5999, 7999, 11999, 19999, 29999, 59999, 114999] },
		CZK: { symbol: "Kč", prices: [15000, 30000, 60000, 150000, 300000, 600000] },
		RON: { symbol: "RON", prices: [2499, 4999, 9999, 24999, 49999, 99999] },
		HUF: { symbol: "Ft", prices: [249000, 449000, 949000, 2399000, 4799000, 9499000] },
		CHF: { symbol: "CHF", prices: [500, 1000, 2000, 4800, 10000, 20000] },
		RUB: { symbol: "₽", prices: [53900, 108000, 215000, 560000, 1139000, 2299000] },
		MXN: { symbol: "$", prices: [12900, 24900, 49900, 129900, 249900, 499900] },
		CLP: { symbol: "$", prices: [550000, 1090000, 2190000, 5490000, 10990000, 21990000] },
		BRL: { symbol: "R$", prices: [2990, 5900, 11790, 29490, 58990, 117990] },
		COP: { symbol: "$", prices: [2990000, 5990000, 11490000, 29990000, 59990000, 114990000] },
		PEN: { symbol: "S/", prices: [1790, 3790, 7490, 18990, 37990, 74990] },
		INR: { symbol: "₹", prices: [50000, 100000, 200000, 500000, 1000000, 2000000] },
		THB: { symbol: "฿", prices: [20000, 40000, 80000, 200000, 400000, 800000] },
		SGD: { symbol: "$", prices: [698, 1498, 2898, 6898, 14898, 28898] },
		JPY: { symbol: "￥", prices: [80000, 160000, 320000, 800000, 1580000, 3180000] },
		KRW: { symbol: "₩", prices: [750000, 1500000, 3000000, 7900000, 14900000, 29900000] },
		IDR: { symbol: "Rp", prices: [9000000, 18000000, 36000000, 90000000, 179900000, 359900000] },
		PHP: { symbol: "₱", prices: [26900, 56900, 115000, 289000, 570000, 1149000] },
		MYR: { symbol: "RM", prices: [2390, 4490, 9490, 23990, 47990, 94990] },
		VND: { symbol: "₫", prices: [12900000, 24900000, 49900000, 129900000, 249900000, 529900000] },
		HKD: { symbol: "HK$", prices: [3800, 7800, 15800, 39800, 78800, 158800] },
		TWD: { symbol: "$", prices: [17000, 33000, 67000, 169000, 329000, 659000] },
		SAR: { symbol: "ر.س.‏", prices: [2499, 4999, 9999, 24999, 49999, 99900] },
		AED: { symbol: "د.إ.‏", prices: [1799, 3699, 7499, 18499, 36999, 74999] },
		ZAR: { symbol: "R", prices: [9999, 19999, 39999, 99999, 199999, 399999] },

		// Pegged to the US dollar

		AWG: { symbol: "", usdRate: 1.79, fixed: true },
		BBD: { symbol: "$", usdRate: 2, fixed: true },
		BHD: { symbol: "", usdRate: 0.376, fixed: true },
		BMD: { symbol: "$", usdRate: 1, fixed: true },
		BSD: { symbol: "$", usdRate: 1, fixed: true },
		BZD: { symbol: "$", usdRate: 2, fixed: true },
		DJF: { symbol: "", usdRate: 177.721, fixed: true },
		ERN: { symbol: "Nfk ", usdRate: 15, fixed: true },
		JOD: { symbol: "", usdRate: 0.709, fixed: true },
		KYD: { symbol: "$", usdRate: 1 / 1.2, fixed: true },
		OMR: { symbol: "", usdRate: 0.3845, fixed: true },
		PAB: { symbol: "", usdRate: 1, fixed: true },
		QAR: { symbol: "", usdRate: 3.64, fixed: true },
		SVC: { symbol: "", usdRate: 8.75, fixed: true },
		XCD: { symbol: "EC$", usdRate: 2.7, fixed: true },
		XCG: { symbol: "", usdRate: 1.79, fixed: true },

		// Floating exchange rates

		AFN: { symbol: "", usdRate: 65.501863 },
		ALL: { symbol: "", usdRate: 81.700112 },
		AMD: { symbol: "", usdRate: 360.56995 },
		AOA: { symbol: "", usdRate: 925.01665 },
		ARS: { symbol: "", usdRate: 1547.0336 },
		AZN: { symbol: "", usdRate: 1.700657 },
		BAM: { symbol: "", usdRate: 1.771945 },
		BDT: { symbol: "", usdRate: 124.60136 },
		BIF: { symbol: "FBu ", usdRate: 3008.5556 },
		BND: { symbol: "", usdRate: 1.287566 },
		BOB: { symbol: "", usdRate: 11.803952 },
		BTN: { symbol: "", usdRate: 94.261675 },
		BWP: { symbol: "P ", usdRate: 14.366837 },
		BYN: { symbol: "", usdRate: 2.995771 },
		CDF: { symbol: "", usdRate: 2254.9459 },
		CLF: { symbol: "", usdRate: 0.025102 },
		CNY: { symbol: "CN¥", usdRate: 6.689676 },
		CRC: { symbol: "", usdRate: 452.75167 },
		CUP: { symbol: "", usdRate: 24 },
		CVE: { symbol: "", usdRate: 99.897988 },
		DOP: { symbol: "", usdRate: 60.950781 },
		DZD: { symbol: "", usdRate: 136.79254 },
		EGP: { symbol: "", usdRate: 53.439277 },
		ETB: { symbol: "", usdRate: 161.27 },
		FJD: { symbol: "$", usdRate: 2.262812 },
		FKP: { symbol: "£", usdRate: 0.756391 },
		GEL: { symbol: "", usdRate: 2.594184 },
		GHS: { symbol: "GH₵", usdRate: 11.747527 },
		GIP: { symbol: "£", usdRate: 0.756391 },
		GMD: { symbol: "D ", usdRate: 74.823996 },
		GNF: { symbol: "", usdRate: 8854.2011 },
		GTQ: { symbol: "", usdRate: 7.659179 },
		GYD: { symbol: "$", usdRate: 209.50618 },
		HNL: { symbol: "", usdRate: 26.955156 },
		HTG: { symbol: "", usdRate: 131.08447 },
		ILS: { symbol: "₪", usdRate: 3.208773 },
		IQD: { symbol: "", usdRate: 1515.0527 },
		IRR: { symbol: "", usdRate: 1722457.4 },
		ISK: { symbol: "", usdRate: 123.42477 },
		JMD: { symbol: "$", usdRate: 158.95426 },
		KES: { symbol: "Ksh", usdRate: 129.98554 },
		KGS: { symbol: "", usdRate: 87.480006 },
		KHR: { symbol: "", usdRate: 4068.0386 },
		KMF: { symbol: "", usdRate: 445.7134 },
		KPW: { symbol: "", usdRate: 899.99657 },
		KWD: { symbol: "", usdRate: 0.31116 },
		KZT: { symbol: "", usdRate: 445.06647 },
		LAK: { symbol: "", usdRate: 22424.493 },
		LBP: { symbol: "", usdRate: 89500 },
		LKR: { symbol: "", usdRate: 332.55983 },
		LRD: { symbol: "$", usdRate: 170.74853 },
		LSL: { symbol: "", usdRate: 16.919544 },
		LYD: { symbol: "", usdRate: 6.427677 },
		MAD: { symbol: "", usdRate: 9.882546 },
		MDL: { symbol: "", usdRate: 18.126952 },
		MGA: { symbol: "Ar ", usdRate: 4574.1308 },
		MKD: { symbol: "", usdRate: 54.865608 },
		MMK: { symbol: "", usdRate: 2101.7666 },
		MNT: { symbol: "", usdRate: 3613.0684 },
		MOP: { symbol: "MOP$", usdRate: 8.081368 },
		MUR: { symbol: "Rs ", usdRate: 47.560791 },
		MVR: { symbol: "", usdRate: 15.464456 },
		MWK: { symbol: "MK ", usdRate: 1745.3482 },
		MZN: { symbol: "", usdRate: 63.721689 },
		NAD: { symbol: "$", usdRate: 16.919544 },
		NGN: { symbol: "₦", usdRate: 1352.0722 },
		NIO: { symbol: "", usdRate: 36.899171 },
		NPR: { symbol: "", usdRate: 150.81868 },
		PGK: { symbol: "K ", usdRate: 4.544846 },
		PKR: { symbol: "Rs ", usdRate: 276.6624 },
		PYG: { symbol: "", usdRate: 6204.0182 },
		RSD: { symbol: "", usdRate: 106.49614 },
		RWF: { symbol: "RF ", usdRate: 1479.6093 },
		SBD: { symbol: "$", usdRate: 7.987692 },
		SCR: { symbol: "Rs ", usdRate: 13.938149 },
		SDG: { symbol: "", usdRate: 498.09303 },
		SHP: { symbol: "£", usdRate: 0.756391 },
		SLE: { symbol: "Le ", usdRate: 23.06523 },
		SOS: { symbol: "", usdRate: 571.98059 },
		SRD: { symbol: "", usdRate: 37.725515 },
		SYP: { symbol: "", usdRate: 121.95534 },
		SZL: { symbol: "E ", usdRate: 16.919544 },
		TJS: { symbol: "", usdRate: 9.209008 },
		TMT: { symbol: "", usdRate: 3.500401 },
		TND: { symbol: "", usdRate: 3.018899 },
		TOP: { symbol: "T$", usdRate: 2.398434 },
		TRY: { symbol: "", usdRate: 50.381173 },
		TTD: { symbol: "$", usdRate: 6.748321 },
		TZS: { symbol: "TSh ", usdRate: 2640.8305 },
		UAH: { symbol: "", usdRate: 45.442934 },
		UGX: { symbol: "USh ", usdRate: 3997.9217 },
		UYU: { symbol: "", usdRate: 40.693726 },
		UZS: { symbol: "", usdRate: 11997.012 },
		VES: { symbol: "", usdRate: 914.0218 },
		VUV: { symbol: "VT ", usdRate: 120.36325 },
		WST: { symbol: "WS$", usdRate: 2.764606 },
		XAF: { symbol: "FCFA ", usdRate: 594.28454 },
		YER: { symbol: "", usdRate: 236.7461 },
		ZMW: { symbol: "K ", usdRate: 20.431723 },
	},

	OptionLists: {
		None: [{ name: "none", cash: 1, robux: 1 }],
		USD: [
			{ name: "devex", label: "DevEx", cash: 380, robux: 1000 },
			{ name: "devexUS18", label: "DevEx (US 18+)", cash: 540, robux: 1000 },
		],
	} as Record<string, any[]>,

	Options: {} as Record<string, RateOption>,

	// Maps a saved name from before the package change (usdRegular0, usdPremium2,
	// usdSubscription1, angRegular3, ...) to today's option, or returns it as is.
	resolveName(name: string) {
		if (this.Options[name]) {
			return name
		}

		const match = name.match(/^([a-z]{3})(Regular|Premium|Subscription|Web|App)(\d+)$/)
		if (!match) {
			return name
		}

		const currency = REPLACED[match[1]] ?? match[1]
		const kind = match[2]
		let tier: number | undefined

		if (kind === "Web" || kind === "App") {
			tier = PACKAGES.findIndex((amounts) => amounts[kind === "Web" ? 0 : 1] === Number(match[3]))
		} else {
			tier = CORE_PACKAGES[Number(match[3])]
		}

		if (tier === undefined || tier < 0) {
			return name
		}

		// Regular was the plain app price, Premium and Subscription got more Robux
		// for the same money, which is what the website gives now.
		const app = kind === "Regular" || kind === "App"
		const resolved = `${currency}${app ? "App" : "Web"}${PACKAGES[tier][app ? 1 : 0]}`

		return this.Options[resolved] ? resolved : name
	},

	isEnabled() {
		// A Custom rate with no amount yet converts nothing.
		const option = this.getSelectedOption()
		return option !== this.Options.none && option.cash > 0
	},

	getSelectedOption() {
		if (!SETTINGS.loaded) {
			return this.Options.none
		}

		return this.Options[this.resolveName(SETTINGS.get("general.robuxToUSDRate"))] || this.Options.none
	},

	convertAngular(expr: any) {
		const option = this.getSelectedOption()

		return `${option.currency.symbol}{{((${expr})*${option.cash}/${option.robux} + 0.4999)/100 | number: ${option.currency.numFractions}}}`
	},

	convert(robux: number) {
		const option = this.getSelectedOption()

		const cash = Math.round((robux * option.cash) / option.robux + 0.4999) / 100
		const cashString = formatNumber(cash.toFixed(option.currency.numFractions))

		return `${option.currency.symbol}${cashString}`
	},
}

for (const [name, currency] of Object.entries(RobuxToCash.Currencies)) {
	currency.name = name
	currency.numFractions = 2

	if (name === "None") {
		// Leave the symbol empty. The defaulting below keys off a falsy symbol,
		// so None would otherwise render as a literal "None " prefix.
		continue
	}

	if (!currency.symbol || (currency.usdRate && (currency.symbol === "$" || currency.symbol === "£"))) {
		currency.symbol = `${name} `
	}

	try {
		currency.numFractions =
			new Intl.NumberFormat("en-US", {
				style: "currency",
				currency: name,
			}).resolvedOptions().maximumFractionDigits ?? 2
	} catch (ex) {}

	const options = (RobuxToCash.OptionLists[name] ??= [])
	const prices = (currency.usdRate ? RobuxToCash.Currencies.USD : currency).prices!
	const tiers = prices.length === PACKAGES.length ? PACKAGES.map((_, i) => i) : CORE_PACKAGES

	for (const [label, column] of [
		["Website", 0],
		["App", 1],
	] as const) {
		for (const [index, tier] of tiers.entries()) {
			const robux = PACKAGES[tier][column]
			const option: Record<string, any> = {
				name: `${name.toLowerCase()}${column === 0 ? "Web" : "App"}${robux}`,
				label,
				cash: prices[index],
				robux,
			}

			if (currency.usdRate) {
				option.usdCash = option.cash
				option.cash *= currency.usdRate
			}

			options.push(option)
		}
	}

	// A rate of your own, such as a DevEx rate in your currency: the amount in
	// general.robuxToCashCustom buys 1,000 Robux. The getter keeps it current
	// when that setting changes.
	options.push({
		name: `${name.toLowerCase()}Custom`,
		label: "Custom",
		robux: 1000,
		get cash() {
			return customCash()
		},
	})
}

for (const [name, options] of Object.entries(RobuxToCash.OptionLists)) {
	const currency = RobuxToCash.Currencies[name]

	for (const option of options) {
		option.currency = currency
		RobuxToCash.Options[option.name] = option
	}
}
