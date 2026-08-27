// Content script entry.
//
// Content scripts cannot be ES modules, so this stays a small classic script. It
// performs the document_start checks synchronously, then pulls in the real
// bundle, which esbuild is free to code split. Loading the heavy optional
// features on demand is what keeps three.js out of the initial download.

if (
	document.contentType === "text/html" &&
	location.protocol !== "blob" &&
	document.readyState === "loading" &&
	!document.documentElement.getAttribute("btr-loaded")
) {
	document.documentElement.setAttribute("btr-loaded", "true")

	void import(chrome.runtime.getURL("js/main.js")).catch((err) =>
		console.error("[btr] failed to load main bundle", err),
	)
}
