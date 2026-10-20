import { html } from "@/core/html"
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
		const name = RobuxToCash.getSelectedOption().currency.name
		currencySelect.value = name

		rateSelect.replaceChildren()
		let selected = false

		for (const option of (RobuxToCash.OptionLists as Record<string, any>)[name]) {
			let fullText = ""

			if (option.name === "none") {
				fullText = "No currency selected"
			} else {
				const display =
					option.label ??
					(option.name.includes("Subscription")
						? "Subscription"
						: option.name.includes("Premium")
							? "Premium"
							: "Regular")

				const rateText = option.currency.usdRate
					? `${option.currency.symbol}${(option.cash / 100).toFixed(option.currency.numFractions)} ≈ US$${(option.usdCash / 100).toFixed(2)} = R$${option.robux}`
					: `${option.currency.symbol}${(option.cash / 100).toFixed(option.currency.numFractions)} = R$${option.robux}`

				fullText = `${display} (${rateText})`
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
