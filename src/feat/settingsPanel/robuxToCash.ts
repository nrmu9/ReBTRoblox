import { html } from "@/core/html"
import { formatNumber } from "@/core/util"
import { RobuxToCash } from "@/feat/robuxToCash"
import { SETTINGS } from "@/feat/settings"
import type { SettingsModalState } from "@/feat/settingsPanel/state"

// Robux to cash: the currency and rate pickers on the General page.

export const setupRobuxToCash = (modal: SettingsModalState) => {
	const currencySelect = modal.settingsDiv.$req("#btr-robuxToCash-currency") as HTMLSelectElement
	const rateSelect = modal.settingsDiv.$req("#btr-robuxToCash-rate") as HTMLSelectElement

	const currencies: any[] = Object.values(RobuxToCash.Currencies)

	for (const currency of currencies.filter((x) => !x.usdRate)) {
		currencySelect.append(html<HTMLOptionElement>`<option>${currency.name}</option>`)
	}

	for (const currency of currencies
		.filter((x) => x.usdRate)
		.toSorted((a, b) => ((a.name ?? "") < (b.name ?? "") ? -1 : 1))) {
		currencySelect.append(
			html<HTMLOptionElement>`<option
				title="Rates are estimations based on USD-${currency.name} exchange rate on ${RobuxToCash.UpdateDate}"
				value="${currency.name}"
			>
				${currency.name}*
			</option>`,
		)
	}

	const setRate = () => {
		SETTINGS.set("general.robuxToUSDRate", rateSelect.value)
	}

	currencySelect.$on("change", () => {
		SETTINGS.set(
			"general.robuxToUSDRate",
			(RobuxToCash.OptionLists as Record<string, any>)[currencySelect.value][0].name,
		)
	})

	rateSelect.$on("change", setRate)

	const updateRate = () => {
		const current = RobuxToCash.getSelectedOption()
		const name = current.currency.name!
		currencySelect.value = name

		// A name saved before the package change resolves to today's option. Save that.
		if (current.name !== SETTINGS.get("general.robuxToUSDRate") && current.name !== "none") {
			SETTINGS.set("general.robuxToUSDRate", current.name)
			return
		}

		rateSelect.replaceChildren()
		let selected = false

		for (const option of (RobuxToCash.OptionLists as Record<string, any>)[name]) {
			let fullText = ""

			if (option.name === "none") {
				fullText = "No currency selected"
			} else {
				const cash = `${option.currency.symbol}${formatNumber((option.cash / 100).toFixed(option.currency.numFractions))}`
				const usd = option.currency.usdRate
					? ` ≈ US$${formatNumber((option.usdCash / 100).toFixed(2))}`
					: ""

				fullText = `${option.label} (${cash}${usd} = R$${formatNumber(option.robux)})`
			}

			rateSelect.append(html<HTMLOptionElement>`<option value="${option.name}">${fullText}</option>`)

			if (option.name === SETTINGS.get("general.robuxToUSDRate")) {
				selected = true
			}
		}

		if (selected) {
			rateSelect.value = SETTINGS.get("general.robuxToUSDRate")
		} else {
			rateSelect.value = rateSelect.options[0].value
			setRate()
		}

		rateSelect.disabled = name === "None"
	}

	SETTINGS.onChange("general.robuxToUSDRate", updateRate)
	updateRate()
}
