MoneyNex Open Platform SDK Interface Documentation
===

> This document is a third-party access development guide and SDK interface description for the Hacash ecosystem wallet MoneyNex, which is intended for developers of trading platforms, mining services, or other tools in the Hacash ecosystem

> Applies to wallet version **0.4.0**. Everything described here is backward compatible with 0.3.x; the 0.4.0 additions (explicit rejection codes, connected-sites management) are incremental — see [Request lifecycle: cancel and error semantics](#request-lifecycle-cancel-and-error-semantics) and the [0.4.0 release notes](release-notes-0.4.0.md).

Through the open interface of the MoneyNex wallet, functions such as obtaining the user's address, initiating a transfer, signing a transaction or inscribed HACD can be achieved, and the corresponding data can be returned, bringing users a more convenient and secure product experience.

Make sure you have the latest version of MoneyNex installed in the latest version of chrome, especially because some experimental APIs may require the latest version from Github to support them. Let's get started!

### Interface mode

The MoneyNex plugin wallet supports the SDK interface in the form of attaching JS code to a web page, by injecting `window. MoneyNex` global object to provide functionality.

When you open the web console, you see the following printed message, which means that the SDK of the wallet is normally supported:

```
hacash api runtime ok.
MoneyNex SDK ok.
```

This means that both Hacash's API and MoneyNex's SDK are ready to use.

### Check wallets

The front-end page of a third-party website can check whether the user has installed the MoneyNex wallet (hereinafter referred to as the wallet) in the form of registering callbacks, checking global variables, and obtaining wallet information such as icons and version numbers. There are two main ways:

1. Register the 'MoneyNexInit' callback function

Add the following code to any web page:


```js
window.MoneyNexInit = function(wallet_info, money_nex) {
    console.log(wallet_info， window.MoneyNex.info) // Wallet Info
    console.log(money_nex, window.MoneyNex) // SDK Object
    // do something
    // ...
}
```

Once the wallet is ready, it will check the `window. MoneyNexInit` global function and call this function to notify the consumer of the status of the wallet to be ready for the SDK to be available. At this point, you can start to get the wallet address, initiate a transfer, and other operations.

2. Check the `MoneyNex` global object at regular intervals

If you miss or are inconvenient to register the MoneyNexInit global function due to front-end architecture issues, you can also check the `MoneyNex` global object at any time to determine if the SDK is already available:

```js
setTimeout(function(){
    if(window.MoneyNex){
        console.log(MoneyNex, MoneyNex.info)
    }else{
        alert("not find MoneyNex wallet")
    }
}, 1200)

```

window.MoneyNex object is available, which means that the wallet SDK is available.

Once the SDK is ready, `MoneyNex.info` carries the wallet information `{ icon, name, version }`. `version` is read from the extension manifest at runtime — it is **`0.4.0`** in the current release (source: `content/content.js` sets it via `chrome.runtime.getManifest().version`; `content/hacash_api.js` exposes it as `MoneyNex.info`). Read it at runtime when you need to gate version-specific behavior.

### SDK API List

The SDK interface of the wallet is almost always registered in the form of an asynchronous callback of `MoneyNex.api_name(params, function(data){})`. Here's a list of available APIs:

1. `wallet` obtains the current primary address of the user's wallet; if the site is not authorized yet, the request is rejected with `{err:'need connect first', code:'need_connect'}` (and the wallet opens the connect window automatically)
2. `connect` initiates authorization to connect to the wallet, and returns the user's wallet information after success
3. `transfer` initiates various transactions and signs broadcasts, returning transaction information
4. `signtx` signs a built transaction body and optionally broadcasts it
5. `raisefee` raises the fee of a pending transaction
6. `chain` queries the current chain and a target chain's configuration status without opening a confirmation page
7. `switchchain` requests the wallet to add or switch to a chain ID
8. `signtext` requests a text signature from the user (see [Sign Text](#sign-text))

### Get the user's wallet address / Check if the wallet is authorized to be connected

Before obtaining the customer's address for the first time, the user needs to manually authorize the website (subject to the domain name), call the 'wallet' interface to check whether it has been authorized, and if so, return the user's wallet address and other information:

```js
MoneyNex.wallet({}, acc => {
    console.log(acc) // {address: '1LRi6Wn38...'}

    if(!acc || !acc.address){
        alert("The user is not connected to the wallet")
    }

    // connected ok
    let user_addr = acc.address
})
```

If the site's origin is not authorized, the request is rejected with `{err: 'need connect first', code: 'need_connect'}` — and, at the same time, the wallet opens the connect approval window for the user. After the user approves, re-issue the `wallet` call and it returns `{address}`.

### Initiate authorization connection

```js
MoneyNex.connect({}, acc => {
    console.log(acc) // {address: '1LRi6Wn38...'}
    let user_addr = acc.address
})
```

Call the connect interface, the wallet will open an authorization window connected to the wallet, and when the user completes the authorization, the wallet will notify the success through a callback. If the user cancels the request (Cancel button, or closing the confirmation window without confirming), the request is **rejected with `{ret:1, code:'user_canceled'}`** — the promise rejects and the callback receives that object. This is an explicit rejection rather than a lost callback: dApps written against the earlier wording ("the callback is not called on cancel") keep working unchanged, they simply additionally observe a rejection they may ignore.

Users can revoke an authorization at any time from the wallet's "Connected sites" management page; after a revoke, the next `connect`/`wallet` call opens the authorization window again. Since 0.4.0 authorizations are recorded per origin (scheme, host and port); authorizations created by 0.3.x are migrated and keep working for their host.

### Request lifecycle: cancel and error semantics

Every SDK request gets **exactly one reply**, whether it succeeds, is canceled, or fails. The reply is delivered on the request's `did` channel: the callback receives it as its first argument, and the returned Promise **rejects** with the same object when it carries an `err` field. A `did` is settled by the first reply only — late or duplicate replies (e.g. a fallback cancel racing a normal resolve) are dropped by the page side, so dApps never see two answers for one request.

The common rejection codes and how a dApp should handle them:

| code | triggered when | typical reply shape | suggested dApp handling |
| --- | --- | --- | --- |
| `user_canceled` | the user pressed Cancel on the request window, or closed the window without confirming (X / Ctrl+W) | page cancel: `{ret:1, err:'User canceled the ... request', code:'user_canceled'}`; window closed without confirming: `{ret:1, err:'... canceled (popup closed)', code:'user_canceled'}` | a normal, expected rejection: abort the flow quietly or show a neutral "canceled" hint; do not retry automatically |
| `sign_refused` | the wallet refuses to sign for a policy reason: transfer `main_address` does not match the current account; `signtx` body fails the local review (signer/format rules); `signtext` text looks like a raw 32-byte hash or violates the length rule (8–4096 chars); `raisefee` target tx missing, or its fee is paid by another account | `{ret:1, err:'<human readable reason>', code:'sign_refused'}` | surface `err` to the user and let them correct the input; re-initiate only after something actually changed |
| `need_connect` | a gated API (`wallet`, `transfer`, `signtx`, `signtext`, `raisefee`, `switchchain`) is called while the site's origin is not authorized | `{err:'need connect first', code:'need_connect'}` | the wallet opens the connect approval window together with this rejection; after the user approves, re-issue the original request |
| `submit_failed` | signing succeeded, but broadcasting the signed transaction to the chain failed (`transfer`; `signtx` with `autosubmit`; `raisefee` submit) | `{ret:1, err:'Signed, but chain submission failed: ...', code:'submit_failed', txbody, body}` (`txbody`/`body` present for transfer/signtx only) | the signed body is in your hands: retry broadcasting it yourself or build a fresh request; do not assume the transaction reached the chain |

Additional semantics worth knowing:

- **Request window form.** Request pages open as a standalone 400×620 notification window (fallback: a regular tab next to the requesting tab when window creation fails). Replies are bound to the requesting tab either way, so the dApp-side integration is unaffected.
- **Closing the window without confirming still answers.** Two independent fallbacks deliver the cancel: the page's `beforeunload` handler makes a best-effort reply during teardown, and the wallet background additionally watches `chrome.windows.onRemoved` / `chrome.tabs.onRemoved` and sends the authoritative `{did, ret:1, err:'Request canceled (popup closed)', code:'user_canceled'}`; the pending-request registry behind this fallback persists in `chrome.storage.session`, so the cancel still fires even when the MV3 service worker is restarted between the request and the close. Because duplicate replies are dropped, dApps can treat cancel handling as optional — code written against the old "cancel is silent" wording keeps working.
- **Chain-mismatch refusals carry no `code`.** When a transfer/signtx `chain_id` does not match the wallet's current network, or a mainnet body contains a ChainAllow action (or a non-mainnet body lacks the required one), the reply is `{ret:1, err, current_chain_id?, request_chain_id?}` without a `code` field — the `err` text and the network fields identify the case.
- **Local signing failure.** If the signing step itself fails inside the wallet (e.g. the account could not be unlocked), the reply is `{ret:1, err, code:'sign_failed'}`; resolve the wallet-side problem and re-initiate.

Implementation references (MoneyNexNew repository): single-reply helper `mnx_dapp_reply` in `popup/html/html.js`; per-page cancel/refusal paths in `popup/connect/conn/vue.js`, `popup/transfer/sigtrs/vue.js`, `popup/signtx/signtx/vue.js`, `popup/signtext/signtext/vue.js`, `popup/raisefee/raisefee/vue.js`; notification-window open, tab fallback and the close listeners in `background/init.js` (`openRequestPopupWindow`, `registerPendingReqReply`/`firePendingCancel` backed by `chrome.storage.session`, `chrome.windows.onRemoved`, `chrome.tabs.onRemoved`); connect gate and `need_connect` in `background/listener.js` and `background/account.js`; page-side message bridge, single-settle `did` table and Promise in `content/hacash_api.js`.

### Query chain status

```js
MoneyNex.chain({chain_id: 1}, res => {
    console.log(res)
    // {
    //     current_chain_id: 0,
    //     current_chain: {...},
    //     target_chain_id: 1,
    //     target_chain: {...}, // null when not configured
    //     request_chain: {...},
    //     configured: true,
    //     matched: false,
    //     need_add: false,
    //     need_switch: true,
    //     diff: false
    // }
})
```

The `chain` interface is read-only. It does not open a wallet page, does not request authorization, and does not modify the wallet. Use it before `switchchain` when a dApp wants to customize the user flow.

### Add or switch chain ID

```js
MoneyNex.switchchain({
    chain_id: 1,
    name: 'Hacash Testnet',
    rpc: 'https://example.com/fullnode',
    explorer: 'https://example.com/explorer',
    remark: 'Test network',

    // Optional policy fields
    mode: 'addOrSwitch',        // addOrSwitch | switch | add
    update: 'ask',              // ask | never | always
    silentIfCurrent: true
}, res => {
    console.log(res)
    // {
    //     chain_id: 1,
    //     chain: {id: 1, name: 'Hacash Testnet', rpc: '...', explorer: '...', remark: '...', builtin: false},
    //     switched: true
    // }
})
```

Call the `switchchain` interface to request the wallet to add or switch to a specific chain ID. If the wallet is already on the target chain and `silentIfCurrent` is not `false`, the callback returns success without opening a confirmation page. If the target chain is already configured, the wallet only asks the user to confirm switching. If the target chain is not configured, the wallet asks the user to confirm adding the chain and switching to it. If the user rejects the request, the callback returns an error such as `{err: 'User rejected network switch'}`.

Supported parameters:

- `chain_id` or `id`: target chain ID. `0` means Hacash mainnet.
- `name`: chain display name. If omitted, the wallet uses `Chain ID {id}`.
- `rpc`: full node RPC URL. This field is required for non-mainnet chains.
- `explorer`: explorer URL.
- `remark`: chain description shown in the wallet.
- `mode`: optional. `addOrSwitch` is the default. `switch` only switches to an already configured chain and returns `{err: 'Chain not configured', need_add: true}` if missing. `add` only adds or updates the chain configuration and does not switch.
- `update`: optional. `ask` is the default. When the chain ID is already configured but the dApp provides different settings, `ask` lets the user choose "Switch Only" or "Update & Switch"; `never` switches using the saved wallet configuration; `always` asks for one confirmation and updates the saved configuration.
- `silentIfCurrent`: optional. Defaults to `true`. When the current chain already matches the target and there is no configuration difference, the wallet returns `{already_current: true, switched: false}` without opening a confirmation page.

### Initiate transactions such as HAC transfers

```js
let txobj = JSON.stringify({
    // Optional. When set, the wallet checks that the current network matches this chain ID.
    // For non-mainnet chains, the wallet automatically adds a ChainAllow action to the transaction.
    chain_id: 1,
    actions: [{
        kind: 1, // HAC transfer
        to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
        amount: '1:248'
    }/*{kind: 6, ....}*/]
})
txobj = encodeURIComponent(btoa(txobj))
// call api
MoneyNex.transfer({txobj}, (a, b) => {
    trsw.innerHTML = JSON.stringify(a)
    console.log(a, b)
})

```

By encoding the JSON data describing the transaction and passing it to the SDK, you can initiate the creation of a transaction such as a transfer, request the user's signature, and broadcast it to the Hacash blockchain for packaging and confirmation. After the signature is successful, the transaction information will be return back as follows:

The `chain_id` field is optional and can be placed either inside `txobj` or in the API params as `MoneyNex.transfer({txobj, chain_id: 1}, callback)`. If it is provided, the wallet must already be switched to the requested chain; otherwise the callback returns a network mismatch error with `current_chain_id` and `request_chain_id`. On non-mainnet chains, the wallet automatically inserts a ChainAllow action (`kind: 1041`) before creating the transaction. On mainnet, transactions must not include a ChainAllow action.

```js
{
    description: ['1ARE89cbY5UnVv8UT14p1WiCMEh21YLfQT as executed account and pay 0.00011HAC tx fee', 'Transfer 1HAC to 19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod'],
    ret: 0,
    success: true,
    txbody: "020065f198e800674e11e34c472ebfba2d34528fccd8aba826f2c4f3010b000100010061f6092ccb33aae47d219f801a7fa41a4649fdb9f8010100000000",
    txfee: "ㄜ11:243",
    txhash: "90ce0536b9cfd37a9d11e2d99980da4d21179affb705fce3ca4e3d1f4f96ce24",
    txhashfee: "6e9640bda5f4a3ba65a5b86745f3dc30f05a7c6525bf4477ba42d64041578c9d"
}
```

The callback API returns information such as the transaction description, hash, and transaction body. Field semantics (dapp-side contract):

- `submit` (`true` on success): the wallet has **already broadcast** this transaction to the chain and it sits in the txpool / a block. `false` must only mean the transaction was signed but not sent.
- `txhash` is the transaction's **plain body hash** (the on-chain identifier an explorer shows); `txhashfee` is the `hash_with_fee`.
- `sign_hash` / `hash` are the current signer's per-address sign digest. For a Type-2 transaction whose signer is also the fee payer, that digest equals `hash_with_fee` — so `hash == sign_hash == txhashfee` is normal and **not** the on-chain tx hash.
- If signing succeeded but the chain broadcast was rejected, the wallet replies with `ret != 0`, `code: 'submit_failed'`, `err: 'Signed, but chain submission failed: ...'` plus the signed `txbody`/`body`; the DApp decides when/how to retry broadcasting that body itself.

The currently supported trading `actions` are listed below. Each `kind` accepts either the legacy **numeric** dapp kind or its **SDK registry name** (they map to the same action):

| kind | SDK name | action |
| --- | --- | --- |
| 1 | `transfer_hac_to` | HAC transfer |
| 5 | `transfer_hacd_single_to` | single-name HACD transfer |
| 6 | `transfer_hacd_to` | multi-name HACD transfer |
| 8 | `transfer_sat_to` | SAT transfer |
| 17 | `transfer_asset_to` | Asset transfer |
| 32 | `hacd_insc_push` | HACD inscription |

1. HAC transfer:

```js
{
    kind: 1, // or 'transfer_hac_to'
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    amount: '1:248'
}
```

2. HACD transfer:

```js
{
    kind: 6, // or 'transfer_hacd_to'
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    diamond: 'AAABBB,WWWWTT'
}
```

3. Asset transfer:

```js
{
    kind: 17, // or 'transfer_asset_to'
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    asset: {
        serial: '1001',
        amount: '123456'
    }
}
```

Always prefer decimal strings for `serial` and `amount` so values above JavaScript's safe integer range remain exact. `amount` is expressed in the Asset's smallest units (atoms), not as a display amount formatted using the Asset's `decimal` value.

4. HACD inscription:

```js
{
    kind: 32, // or 'hacd_insc_push'
    diamond: 'AAABBB,WWWWTT', // one or more max 200
    inscription: 'First HACD inscription!',
    protocol_cost: '0.1' // optional HAC burn paid by the main address (see the note below)
}
```

**`protocol_cost` is an amount, not a fee-purity figure.** It is parsed like any other Hacash amount — a unit-annotated string (`'0.1:248'`, `'100000000000000:232'`) or a decimal HAC string (`'0.1'`) — and the chain compares HAC value, so the same burn can be written in any unit. The only constraints are that it must not be negative and must **encode in at most 4 bytes**: keep it a round value (`'0.1'`, `'1'`), never a long-digit string. The amount is burned from the transaction's main address; `'0'` (the default) means no burn.

**Node fee figures are priced in the chain pricing unit u232, not in HAC.** Fees and gas are billed in the `fee_purity_unit` sub-unit (`= 232`, i.e. 10⁻¹⁶ HAC; 1 HAC = 10¹⁶ u232). Every figure the node reports — `fee_purity`, `fee_purity_floor`, `fee_full_u232` / `fee_discount_u232` (`/query/contract_storage_fee`), `minimum_fee` (`tx.estimate_fee`), `purity` (`/query/fee/average`) — is a u232 count and is **10⁶ × the legacy u238 value** (the mainnet fee-purity floor is now `50000000000`, formerly `50000`). Convert to HAC before using one as an amount (`HAC = purity × 10⁻¹⁶`); passing a raw purity number into a field that expects an amount such as `protocol_cost` overpays by ~10¹⁰–10¹⁶.

The above transaction construction adopts Hacash's readable contract technology, a variety of transfers can be combined at will and signed at one time, which will be wrapped in a single transaction and confirmed by the block, and all transfers and inscriptions will take effect at the same time.

More transaction 'action' categories are in development.

### Sign a multi-signature transaction

Hacash supports high-end functions such as native DEX atomic transactions and multi-signature transactions, after building a transaction through SDK or other interfaces, it can be submitted to the wallet and request user signatures, and the same transaction can request multiple user signatures, only need to save the signed tx_body data, and after all user signatures are completed, the transaction will take effect and can be submitted to the chain for confirmation.

```js
    let txbody = "02006607794700e63c33a796b3032ce6b856f68fccf06608d9ed18f40104000300010040afae783ae7927badaede2c4c97dbd53d542915f7010c000100674e11e34c472ebfba2d34528fccd8aba826f2c4f8017d000600674e11e34c472ebfba2d34528fccd8aba826f2c400e63c33a796b3032ce6b856f68fccf06608d9ed1801545548424d4500000000"
    // call api
    MoneyNex.signtx({txbody, chain_id: 1, autosubmit: false}, (a, b) => {
        sgtw.innerHTML = JSON.stringify(a)
        console.log(a, b)
    })
```

Optional parameters:

- `chain_id`: target chain ID. If omitted, the wallet treats the request as mainnet (`0`).
- `autosubmit`: when truthy, the wallet submits the transaction after signing if all required signatures are complete.

API return:


```js
{
    "sign_hash": "e2700db4558ef1e1b540fd53f5e7a0fa7b9d096947f9dc20d07bd507969987b9",
    "hash": "e2700db4558ef1e1b540fd53f5e7a0fa7b9d096947f9dc20d07bd507969987b9",
    "hash_with_fee": "4001dd689105d2174c15a21814a7e832747ed986c171b370030f43ebbdd5e9fc",
    "body": "02006607794700e63c33a796b3032ce6b856f68fccf06608d9ed18f40104000300010040afae783ae7927badaede2c4c97dbd53d542915f7010c000100674e11e34c472ebfba2d34528fccd8aba826f2c4f8017d000600674e11e34c472ebfba2d34528fccd8aba826f2c400e63c33a796b3032ce6b856f68fccf06608d9ed1801545548424d4500020231745adae24044ff09c3541537160abb8d5d720275bbaeed0b3d035b1e8b263caafe3ea70ad599f9afaef4381c5678b47a6fad4be9d7b5603ca00577f494ae741d0649eebe6e67d33efb430e70691fae544016d1e84925b25282fb1c9c9f5e08037bb06e880a8afb03f4035bdcd9354e798a0cbdee613bebe17d2c8db14f0eb7344d7baf705d2efec958c3a3aa9b2752c142572b4f3c5bf0f84f6a92a112ebbd49398e738f82356a0d3ea9f0181138568ede3b3d3b90d2848d116785222289ff140000",
    "fee": "0.0004",
    "address": "1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9",
    "need_sign_address": {
        "1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9": true,
        "1ARE89cbY5UnVv8UT14p1WiCMEh21YLfQT": false
    },
    "description": [
        "Pay 0.0004HAC tx fee by 1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9",
        "Transfer 1.2HAC from 1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9 to 16u2hqur4h537JL4ef5uat6xQW99Z1JNYC",
        "Transfer 125HAC from 1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9 to 1ARE89cbY5UnVv8UT14p1WiCMEh21YLfQT",
        "Transfer 1 HACD (TUHBME) from 1ARE89cbY5UnVv8UT14p1WiCMEh21YLfQT to 1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9"
    ],
    "ret": 0
}
```

Among them, the `body` field is the signed transaction body data, and the user's signature data will be automatically added to the body and needs to be saved. Wait for all users to sign and then submit the body to the chain.

The wallet checks whether the transaction body is allowed on the current chain before signing. Mainnet transaction bodies must not contain a ChainAllow action. Non-mainnet transaction bodies must contain a ChainAllow action (`kind: 1041`) whose `chains` list includes the current chain ID.

### TxMessage / TxBlob display layouts

`tx_message` (kind 1025) and `tx_blob` (kind 1026) are opaque byte carriers. The wallet only ships a closed set of protocol extractors; the **layout is data** supplied by the caller. The wallet never upgrades for a third-party business schema.

Each layout item is an array in one of three forms (`name` is an **untrusted caption**; omit it or pass `""` — both mean no caption):

```js
[field_id]                 // fixed-width extractor
[field_id, "name"]         // same, plus untrusted note
[field_id, "", len]        // variable-width extractor (empty name == omitted)
// also allowed: [field_id, "name", len]
```

Fields are sliced **in order** and **must cover the entire message/blob**. If coverage fails, the sign page shows a single red warning and still allows signing; the bytes remain as a HEX dump. HEX fields are always rendered as an ugly hex dump.

`field_id` (closed set, aliases in parentheses):

| id | width | display |
| --- | --- | --- |
| `hacash_addr21` (`addr`) | 21 | Hacash address |
| `evm_addr20` (`evm`, `evm20`) | 20 | `0x` + 20 bytes |
| `u8` / `u16be` (`u16`) / `u32be` (`u32`) / `u64be` (`u64`) | 1/2/4/8 | unsigned big-endian |
| `magic4` | 4 | printable ASCII or HEX |
| `hex4` | 4 | HEX |
| `hacd_name` (`hacd`) | 6 | HACD name |
| `hac_zhu` (`hac`, `amount`) | `len` required | protocol Amount |
| `hacd_names` (`hacds`) | `len` = 6n | HACD name list |
| `asset_serial_amt` (`asset`) | `len` required | Fold64 serial + Fold64 atoms |
| `ascii` (`text`) | `len` required | printable ASCII only |
| `hex` (`bytes`) | `len` required | raw HEX dump |

Pass **one table + `id`**, or **several tables at once**. Display does not distinguish `tx_message` vs `tx_blob`. `id` (also `msgid`) is the 0-based order of appearance among message/blob actions in the transaction's top-level action list. `action_id` is the array subscript in that same `actions[]`; if that slot is not a message/blob, the sign page shows a red one-line warning and still allows signing.

Layout parse errors **only affect display**: one red sentence on the sign page. They never set a validation failure or disable Sign.

```js
// one message (id 0): BaseBridge deposit carrier magic|net|to
MoneyNex.signtx({
    txbody,
    msgid: 0,
    msglayout: [
        ['magic4'],
        ['u32be', 'net'],
        ['evm_addr20', 'to'],
    ],
}, cb)

// or pin by actions[] subscript
MoneyNex.signtx({
    txbody,
    action_id: 0,
    msglayout: [
        ['magic4'],
        ['u32be', 'net'],
        ['evm_addr20', 'to'],
    ],
}, cb)

// several messages / blobs (shared id sequence)
MoneyNex.signtx({
    txbody,
    msglayouts: [
        { id: 0, layout: [['magic4'], ['u32be', 'net'], ['evm_addr20', 'to']] },
        { id: 1, layout: [['ascii', 'memo', 12]] },
        { action_id: 3, layout: [['hex', '', 8]] },
    ],
}, cb)
// equivalent map form for id: msglayouts: { "0": [...], "1": [...] }
```

A single `msglayout` without `id` / `action_id` is applied only when the transaction contains **exactly one** message/blob. Main labels always come from the wallet; `name` is shown as a plain caption. Transfer amounts stay on the protocol Transfer action, not on message HAC slices.

`signtx` / `transfer` / `signtext` / `connect` / `wallet` / `raisefee` return a Promise if you omit the callback.

### Sign Text

Request the user to sign an **arbitrary text** with the wallet's current account. The signature is a local ECDSA signature (secp256k1-rfc6979-sha256) of `SHA-256(text)` and is **never broadcast on-chain** — it cannot be used as a transaction signature.

```js
MoneyNex.signtext({
    text: "Login to ExampleApp at 2026-09-06 12:00:00 UTC",
}, (a) => {
    console.log(a)
    // success: {ret:0, success:true, text, digest, public_key, signature, address}
    //   digest  = SHA-256(text), 64-char hex
    //   signature = 64-byte r||s hex over the digest
    // canceled: {ret:1, err:"...", code:"user_canceled"}
})
```

Security rules enforced by the wallet (the request is refused with an error — `{ret:1, err, code:"sign_refused"}` is delivered to the page and nothing is signed):

- The text must be 8 to 4096 characters long.
- Text that looks like a **raw 32-byte hash** (64 hex chars with optional `0x`/whitespace, or a 43-char base64/base64url payload) is always refused — never use `signtext` to ask the user to endorse a hash; use `signtx` for transactions.
- The full text is displayed to the user verbatim in a dedicated review page before signing.

A refusal keeps the review window open showing the reason; nothing is signed and the dApp receives `{ret:1, err, code:"sign_refused"}`. If the local signing step itself fails (for example the account could not be unlocked), the reply is `{ret:1, err, code:"sign_failed"}` instead — resolve the wallet-side problem and re-initiate the request.

### Raise Tx Fee

Hacash supports real-time fee increases to change the order of transactions in the transaction pool, so as to achieve the purpose of packaging and confirming as soon as possible. The HACD Bidding Fee is essentially a transaction fee, and it can also be used in this way to change the bidding order.

```js
    let hash = "e2700db4558ef1e1b540fd53f5e7a0fa7b9d096947f9dc20d07bd507969987b9"
    let fee = "2:245" // or 0.002
    // call api
    MoneyNex.raisefee({hash, fee, chain_id: 1}, (a) => {
        // sgtw.innerHTML = JSON.stringify(a)
        console.log(a)
    })
```

The `chain_id` parameter is optional. If provided, the wallet checks that the current network matches the requested chain before querying and signing the pending transaction. The fetched transaction body is also checked against the current chain before the fee-raising transaction is signed and submitted.

API return:


```js
{
    "ret": 0,
    "success": true,
}
```


### Test code

The test reference use cases of the above SDK interfaces can be found in the following directory and can be used as a writing example for developers:

- [SDK Test](https://github.com/hacashcom/MoneyNex/tree/main/test)
