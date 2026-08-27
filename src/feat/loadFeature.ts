// Optional feature loading.
//
// The legacy version asked the background page to executeScript a list of raw
// files, which then defined globals. Bundled modules have no such globals, so
// each feature is a dynamic import instead. Execution stays deferred until a
// page actually needs the feature, and the resolved namespace is cached.

import { insertCSS } from "@/core/page"

const loaders: Record<string, () => Promise<unknown>> = {
	previewer: () => import("@/rbx/Preview"),
	explorer: () => import("@/rbx/Explorer"),
	sourceViewer: () => import("@/feat/sourceViewer"),
	parser: () => import("@/rbx/Parser/ModelParser"),
}

const styles: Record<string, string[]> = {
	sourceViewer: ["css/sourceviewer.css"],
}

const pending: Record<string, Promise<unknown>> = {}

export const loadOptionalFeature = (name: string): Promise<unknown> => {
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

	return pending[name]
}
