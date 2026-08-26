import { installExtensions } from "@/core/extend"
import { IS_DEV_MODE } from "@/core/env"

installExtensions()

if(IS_DEV_MODE) {
	void import("@/dev/probe").then(({ startDevProbe }) => startDevProbe())
}
