import { injectScript } from "@/core/messaging"
import { pageInit } from "@/core/page"
import { SETTINGS } from "@/feat/settings"
import { startDownload } from "@/pages/common"
import { AssetCache } from "@/rbx/AssetCache"

pageInit.create_dashboard = () => {
	if (!SETTINGS.get("create.enabled")) {
		return
	}

	// Adjust options menu items
	if (SETTINGS.get("create.assetOptions")) {
		injectScript.call("createAssetOptions")
	}

	// Add download option to version history
	if (SETTINGS.get("create.downloadVersion")) {
		injectScript.call("createDownloadVersion")

		let isDownloading = false

		document.$on("click", ".btr-download-version", (ev) => {
			const button = ev.currentTarget

			const assetId = parseInt(button.getAttribute("btrAssetId") ?? "", 10)
			const assetVersionNumber = parseInt(button.getAttribute("btrVersion") ?? "", 10)

			if (!Number.isSafeInteger(assetId) || !Number.isSafeInteger(assetVersionNumber)) {
				return
			}

			if (isDownloading) {
				return
			}
			isDownloading = true

			button.$req(".btr-mui-circular-progress-root").style.display = ""
			button.$req(".btr-download-icon").style.opacity = "0"

			const placeNameRaw = document.title.match(/^(.*) \/ Version History$/)?.[1] ?? "place"
			const placeName = placeNameRaw.replace(/\W+/g, "-").replace(/^-+|-+$/g, "")

			const fileExt = document.location.href.includes("/creations/experiences/") ? "rbxl" : "rbxm"
			const fileName = `${placeName}-${assetVersionNumber}.${fileExt}`

			AssetCache.loadBuffer({ id: assetId, version: assetVersionNumber }, (buffer: any) => {
				const blobUrl = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }))
				startDownload(blobUrl, fileName)
				URL.revokeObjectURL(blobUrl)

				isDownloading = false
				button.$req(".btr-mui-circular-progress-root").style.display = "none"
				button.$req(".btr-download-icon").style.opacity = ""
			})
		})
	}
}
