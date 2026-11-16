import { test } from "node:test"
import assert from "node:assert/strict"
import { formatNumber } from "@/core/util"
import { RobuxToCash } from "@/feat/robuxToCash"

test("Numbers get thousands separators", () => {
	assert.equal(formatNumber(446605), "446,605")
	assert.equal(formatNumber("1149.99"), "1,149.99")
	assert.equal(formatNumber("999"), "999")
})

test("Every currency has website and app packages", () => {
	const usd = RobuxToCash.OptionLists.USD.map((x) => x.name)
	assert.ok(usd.includes("usdWeb500") && usd.includes("usdApp400"))
	assert.ok(usd.includes("usdWeb3625") && usd.includes("usdApp1200"))
	assert.equal(RobuxToCash.Options.usdWeb24000.cash, 19999)

	// Six local prices: the in-between packages are left out.
	assert.equal(RobuxToCash.Options.eurWeb1000.cash, 1199)
	assert.equal(RobuxToCash.Options.eurApp1200, undefined)

	// Floating currencies follow the USD packages.
	const lbp = RobuxToCash.Options.lbpWeb500
	assert.equal(lbp.usdCash, 499)
	assert.equal(lbp.cash, 499 * RobuxToCash.Currencies.LBP.usdRate!)
})

test("Rates saved before the package change move to today's options", () => {
	assert.equal(RobuxToCash.resolveName("usdRegular0"), "usdApp400")
	assert.equal(RobuxToCash.resolveName("usdRegular5"), "usdApp22500")
	assert.equal(RobuxToCash.resolveName("eurPremium2"), "eurWeb2000")
	assert.equal(RobuxToCash.resolveName("gbpSubscription1"), "gbpWeb1000")
	assert.equal(RobuxToCash.resolveName("angRegular3"), "xcgApp4500")
	assert.equal(RobuxToCash.resolveName("bgnPremium0"), "eurWeb500")
	assert.equal(RobuxToCash.resolveName("devex"), "devex")
	assert.equal(RobuxToCash.resolveName("none"), "none")
	assert.equal(RobuxToCash.resolveName("garbage"), "garbage")
})
