# MoneyNex

A Hacash and Bitcoin wallet — Chrome browser extension (Manifest V3), with an open SDK.

Your key to future money.

Current release: **0.4.0** — see the [release notes](doc/release-notes-0.4.0.md) / [中文发布说明](doc/release-notes-0.4.0.cn.md).

### SDK API

Third-party sites interact with the wallet through the injected `window.MoneyNex` global object (detected via the `MoneyNexInit` callback or polling), offering 8 APIs: `wallet` / `connect` / `transfer` / `signtx` / `raisefee` / `chain` / `switchchain` / `signtext`.

- [doc/sdk.md](doc/sdk.md)
- [doc/sdk.cn.md](doc/sdk.cn.md) (Chinese)

### Build

Environment preparation:

- The latest version of Node.js and npm

Execute the commands:

```sh
git clone https://github.com/hacashcom/MoneyNex.git
cd MoneyNex
npm install
npm test                     # jslib unit tests (importkey / assetamt / msglayout)
node build.js --release      # production build, output in release/
```

Once the build is complete, the `release/` directory can be loaded into Chrome via `chrome://extensions` → "Load unpacked" (developer mode).

Of course, you can also download the version we have already built for you:

- [releases/latest](https://github.com/hacashcom/MoneyNex/releases)

Build-time options:

```sh
node build.js --release --fullnode-url=http://127.0.0.1:8009/fullnode
# optional flags:
#   --fullnode-host=http://...   adds a host_permissions entry for a custom node origin
#   --chain-id=N                 target a non-mainnet chain (test builds)
```

- The default fullnode is `http://wallet.hacash.com/fullnode`. It is kept on `http` because the https gateway for this domain is currently unavailable (see the release notes).
- Runtime RPC resolution priority: the user's explicit RPC override (wallet home setting, stored as `mnx_fullnode_url`) > the selected network's RPC (`chain_configs` / `current_chain_id`) > the build-time default (`--fullnode-url`).

### Test-chain constraint

For development and functional testing, always point `--fullnode-url` at your own local/test node. A `--release` build that carries a non-default `--fullnode-url` or `--chain-id` is flagged as a TEST config by `build.js` and must not be distributed to users.

### Directory layout

- `build.js`, `build.cfg.js` — build pipeline: page bundling, Vue template pre-compilation, less/csso/uglify, build-time RPC injection
- `manifest.json` — MV3 manifest (requires Chrome >= 102)
- `background/` — service worker: message dispatch, connect authorization (`connect_sites`), dApp request windows, chain config store
- `content/` — content scripts: inject `window.MoneyNex` (hidden-div + `did`/`dmu` message bridge)
- `jslib/` — shared libraries: signing/SDK facade (`moneynx_sdk_facade.js`), tx view, message types, unit tests (`jslib/*.test.js`)
- `popup/` — UI sources as `<page>/<component>/vue.{html,js,less}` triplets, shared runtime (`popup/html/`) and design tokens (`popup/tokens/tokens.less`)
- `image/` — icons and fonts
- `test/` — unit-test drivers and `test/dapp-sim.html`, a local dApp simulator page for exercising the SDK APIs
- `doc/` — SDK documentation, refactor plan, release notes
- `release/` — build output (generated, not committed)
