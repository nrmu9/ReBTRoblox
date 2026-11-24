import { html } from "@/core/html"
import { formatNumber } from "@/core/util"
import { parseCustomRate, RobuxToCash } from "@/feat/robuxToCash"
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
				title="Estimated from the USD to ${currency.name} exchange rate on ${RobuxToCash.UpdateDate}"
				value="${currency.name}"
			>
				${currency.name}*
			</option>`,
		)
	}

	const customField = modal.settingsDiv.$req(".btr-robuxToCash-custom")
	const customInput = customField.$req("input") as HTMLInputElement

	const setRate = () => {
		// Read first: saving the amount below redraws the list, which puts the
		// picker back on the rate still saved.
		const value = rateSelect.value
		const option = RobuxToCash.Options[value]

		// Picking Custom for the first time starts it at the rate that was in use,
		// so prices don't drop to nothing until an amount is typed.
		if (option?.label === "Custom" && !parseCustomRate(SETTINGS.get("general.robuxToCashCustom"))) {
			const previous = RobuxToCash.getSelectedOption()

			if (previous.name !== "none" && previous.label !== "Custom") {
				const perThousand = (previous.cash * 1000) / previous.robux / 100
				SETTINGS.set("general.robuxToCashCustom", String(Math.round(perThousand * 100) / 100))
			}
		}

		SETTINGS.set("general.robuxToUSDRate", value)
	}

	customInput.$on("change", () => {
		const amount = parseCustomRate(customInput.value)
		customInput.classList.toggle("btr-exp-invalid", !amount && customInput.value.trim() !== "")

		if (amount || customInput.value.trim() === "") {
			SETTINGS.set("general.robuxToCashCustom", amount ? String(amount) : "")
		}
	})

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
			} else if (option.label === "Custom" && !option.cash) {
				fullText = "Custom"
			} else {
				const cash = `${option.currency.symbol}${formatNumber((option.cash / 100).toFixed(option.currency.numFractions))}`
				const usd =
					option.usdCash !== undefined
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

		const custom = RobuxToCash.getSelectedOption().label === "Custom"
		customField.hidden = !custom

		if (custom) {
			customField.$req(".btr-robuxToCash-custom-unit").textContent = `${name} for 1,000 Robux`
			customInput.setAttribute("aria-label", `${name} for 1,000 Robux`)
			customInput.placeholder = "3.80"

			// Not while it is being typed in.
			if (document.activeElement !== customInput) {
				customInput.value = SETTINGS.get("general.robuxToCashCustom")
				customInput.classList.remove("btr-exp-invalid")
			}
		}
	}

	SETTINGS.onChange("general.robuxToUSDRate", updateRate)
	SETTINGS.onChange("general.robuxToCashCustom", updateRate)
	updateRate()
}
