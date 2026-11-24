<a href="https://addons.mozilla.org/en-US/firefox/addon/rebtroblox/"><img src="https://img.shields.io/badge/Add%20to%20Firefox-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white" alt="Add to Firefox"></a>
<a href="https://chromewebstore.google.com/detail/rebtroblox-continuing-the/dplimibgmlomamaljcclnjgcolbijcad"><img src="https://img.shields.io/badge/Add%20to%20Chrome-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Add to Chrome"></a>
<a href="https://github.com/nrmu9/ReBTRoblox/releases/latest"><img src="https://img.shields.io/badge/Download%20release-57606A?style=for-the-badge&logo=github&logoColor=white" alt="Download the latest release"></a>

# ReBTRoblox

A browser extension that adds features to the Roblox website. You get 3D item
previews, a model explorer, exact counts, server tools, last seen on profiles,
no accessory limits in the avatar editor, and a lot more.

ReBTRoblox is a fork of [BTRoblox](https://github.com/AntiBoomz/BTRoblox) by
[AntiBoomz](https://github.com/AntiBoomz). BTRoblox is barely maintained now.
Most of its features have broken as Roblox changed the site, and its settings
don't even open anymore. This fork fixes what broke and keeps adding new things.
Most of the code is still AntiBoomz's work.

## Install

- **Firefox:** [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/rebtroblox/)
- **Chrome and other Chromium browsers:** [Chrome Web Store](https://chromewebstore.google.com/detail/rebtroblox-continuing-the/dplimibgmlomamaljcclnjgcolbijcad)

To change settings, open the gear menu in Roblox's top bar and click
**BTR Settings**. You can turn every feature on or off.

## Features

**Items and avatars**

- 3D previewer on item pages, and when you hover items in the catalog and
  inventories
- Explorer to look inside an item's model
- Buttons to download items and open their templates
- Sales, created and updated dates, and exact favorite counts
- No limit on how many accessories or layered clothing items you wear
- Move, rotate and resize accessories, and pick any body color

**Profiles and activity**

- Classic profile layout and header, with the inventory on the profile
- Last seen online, plus a timeline of when someone was on and what they played
- Watch people to see their friend, follower and profile changes
- Track games and communities over time
- A friend log of everyone you add or remove
- Shared communities and exact follower counts

**Games**

- Exact visits and likes that update live
- Your playtime and recent servers
- Server list with pages, ping or region, and a button to join the smallest
  server
- Badges you own are highlighted

**Other**

- Robux prices in real money, using Roblox's rate or your own
- Reorder and hide rows on Home
- Faster user search and Copy ID in right-click menus
- Chat search and fixes for missing messages
- Mark all messages as read
- Payouts tab on community pages
- Download old versions of your places and assets
- Settings sync through your browser account, and backups

## Privacy

ReBTRoblox doesn't collect any data. See [PRIVACY.md](PRIVACY.md).

## Reporting bugs

[Open an issue](https://github.com/nrmu9/ReBTRoblox/issues/new/choose) and fill
in the form. If you saw errors, go to **Experiments** in the settings and click
**Report on GitHub** under Recent Errors. It opens the form with your version
and browser already filled in.

## Building

You need [Node](https://nodejs.org). The version is in
[.node-version](.node-version).

```sh
npm ci
npm run build                     # Firefox build in dist/
npm run build -- --target=chrome  # Chrome build in dist/
npm run watch                     # rebuilds when files change
```

In Firefox, load `dist/` at `about:debugging`. In Chrome, turn on Developer mode
at `chrome://extensions` and load `dist/` as an unpacked extension.

Before you send a change, run `npm run lint`, `npm run typecheck` and
`npm run test:unit`.

Release builds are reproducible. Check out a release tag and run
`npm ci && npm run package`. You get the same files as the release, and you can
compare them with its `SHA256SUMS`.

Each release also has an `-unsigned.xpi`. It's the Firefox build without
Mozilla's signature, for Nightly and Developer Edition. Normal Firefox only
installs the signed version from the add-on site.

## Links

- [Roblox API notes](docs/roblox-apis.md), carried over from BTRoblox
- [BTRoblox](https://github.com/AntiBoomz/BTRoblox)
