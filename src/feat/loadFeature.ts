// Optional feature loading.
//
// The legacy version asked the background page to executeScript a list of raw
// files, which then defined globals. Bundled modules have no such globals, so
// each feature is a dynamic import instead. Execution stays deferred until a
// page actually needs the feature, and the resolved namespace is cached.

import { insertCSS } from "@/core/page"

const loaders = {
	previewer: () => import("@/rbx/Preview"),
	explorer: () => import("@/rbx/Explorer"),
	sourceViewer: () => import("@/feat/sourceViewer"),
	parser: () => import("@/rbx/Parser/ModelParser"),
}

type FeatureName = keyof typeof loaders

/** What the module actually resolves to, so callers get its exports typed. */
type Feature<K extends FeatureName> = Awaited<ReturnType<(typeof loaders)[K]>>

const styles: Record<string, string[]> = {
	sourceViewer: ["css/sourceviewer.css"],
}

const pending: Record<string, Promise<unknown>> = {}

export const loadOptionalFeature = <K extends FeatureName>(name: K): Promise<Feature<K>> => {
	const loader = loaders[name]

	if (!loader) {
		return Promise.reject(new Error(`Unknown optional feature "${name}"`))
	}

	if (!pending[name]) {
		if (styles[name]) {
			insertCSS(...styles[name])
		}

		pending[name] = loader()
	}

	return pending[name] as Promise<Feature<K>>
}
