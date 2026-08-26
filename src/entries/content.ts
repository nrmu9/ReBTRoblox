import { IS_DEV_MODE } from "@/core/env"

if(IS_DEV_MODE) {
	void import("@/dev/probe").then(({ startDevProbe }) => startDevProbe())
}
