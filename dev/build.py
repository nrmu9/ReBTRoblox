"""Write manifest.json for the Firefox DEV build."""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
BRIDGE_ORIGIN = "http://127.0.0.1:8787/*"

manifest = json.loads((ROOT / "manifest.firefox.json").read_text(encoding="utf8"))

manifest["name"] = "BTRoblox DEV"
manifest["short_name"] = "BTRoblox_DEV"
manifest["permissions"] = manifest["permissions"] + [BRIDGE_ORIGIN, "tabs"]
manifest["content_security_policy"] = "script-src 'self' 'unsafe-eval'; object-src 'self'"
manifest["background"]["scripts"].append("js/devbridge.js")

for entry in manifest["content_scripts"]:
    js = entry.get("js", [])
    if "js/utility.js" in js:
        js.insert(js.index("js/utility.js") + 1, "js/devprobe.js")

(ROOT / "manifest.json").write_text(json.dumps(manifest, indent="\t") + "\n", encoding="utf8")
print("wrote manifest.json (BTRoblox_DEV)")
