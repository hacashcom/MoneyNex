MoneyNex 开放平台 SDK 接口文档
===

> 本文档是 Hacash 生态钱包 MoneyNex 的第三方接入开发指引和 SDK 接口说明，为 Hacash 生态的交易平台、矿业服务或其他工具的开发者准备

通过 MoneyNex 钱包的开放接口，可以达成诸如获取用户地址、发起转账、签名交易或铭刻 HACD 等功能，并获取相应数据返回，为用户带来更便捷和安全的产品体验。

请确保你已经在最新版本的 chrome 浏览器中安装好了 MoneyNex 钱包，特别注意，某些试验性质的 API 可能需要 Github 发布的最新版本才支持。让我们开始吧！

### 接口方式

MoneyNex 插件钱包采用向网页附加 JS 代码的形式来支持 SDK 接口，通过注入`window.MoneyNex` 全局对象来提供各项功能。

当打开网页控制台后，看到以下打印信息即表示钱包的 SDK 正常支持：

```
hacash api runtime ok.
MoneyNex SDK ok.
```
表示 Hacash 的 API 和 MoneyNex 的 SDK 都已经准备好可用。

### 检测钱包

第三方网站的前端页面可以通过注册回调、检查全局变量的形式来检查用户是否已经安装好了 MoneyNex 钱包（以下简称钱包），并获取图标、版本号等钱包信息。主要通过两种方式：

1. 注册 `MoneyNexInit` 回调函数

在任意网页添加以下代码：

```js
window.MoneyNexInit = function(wallet_info, money_nex) {
    console.log(wallet_info， window.MoneyNex.info) // Wallet Info
    console.log(money_nex, window.MoneyNex) // SDK Object
    // do something
    // ...
}
```

钱包在准备好之后，将检查页面中的 `window.MoneyNexInit` 全局函数，并调用此函数，以通知使用者钱包的状态以准备好，SDK 可用。此时，可以开始获取钱包地址、发起转账等操作。

2. 定时检查 `MoneyNex` 全局对象

如果因为前端架构等问题错过或不便注册 MoneyNexInit 全局函数时，还可以在任意时候检查 `MoneyNex` 全局对象来判断 SDK 是否已经可用：

```js
setTimeout(function(){
    if(window.MoneyNex){
        console.log(MoneyNex, MoneyNex.info)
    }else{
        alert("not find MoneyNex wallet")
    }
}, 1200)

```

window.MoneyNex 对象可用，即代表钱包 SDK 可用。

### SDK API 列表

钱包的 SDK 接口几乎都以 `MoneyNex.api_name(params, function(data){})` 的异步回调形式注册。以下是可用的 API 列表：

1. `wallet` 获取用户钱包的当前主地址，未授权则返回 Error
2. `connect` 发起连接钱包的授权，成功后返回用户钱包信息
3. `transfer` 发起各种交易并签名广播，返回交易信息
4. `signtx` 对已经构建好的交易体签名，并可选择自动广播
5. `raisefee` 为交易池中的待确认交易提升手续费
6. `chain` 无弹窗查询当前链和目标链的配置状态
7. `switchchain` 请求钱包添加或切换到指定 Chain ID
8. `signtext` 请求用户签署一段文本（见[文本签名](#文本签名)）

### 获取用户钱包地址 / 检查是否授权连接钱包

在首次获取客户地址之前，需要用户手动为网站授权（以域名为准），通过调用 `wallet` 接口来检查是否已经授权，如果已经授权，则返回用户钱包地址等信息：

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

### 发起钱包授权连接

```js
MoneyNex.connect({}, acc => {
    console.log(acc) // {address: '1LRi6Wn38...'}
    let user_addr = acc.address
})
```

调用 connect 接口，钱包将打开一个连接到钱包的授权页面，当用户完成授权时，钱包将通过回调通知成功。如果用户取消或者一直未点击确认授权，则回调函数不会被调用。

### 查询 Chain 状态

```js
MoneyNex.chain({chain_id: 1}, res => {
    console.log(res)
    // {
    //     current_chain_id: 0,
    //     current_chain: {...},
    //     target_chain_id: 1,
    //     target_chain: {...}, // 未配置时为 null
    //     request_chain: {...},
    //     configured: true,
    //     matched: false,
    //     need_add: false,
    //     need_switch: true,
    //     diff: false
    // }
})
```

`chain` 接口是只读接口，不打开钱包页面，不请求授权，也不修改钱包状态。dApp 如果需要定制用户流程，可以先调用它判断目标 Chain ID 是否已经配置、当前是否已经匹配、配置是否存在差异。

### 添加或切换 Chain ID

```js
MoneyNex.switchchain({
    chain_id: 1,
    name: 'Hacash Testnet',
    rpc: 'https://example.com/fullnode',
    explorer: 'https://example.com/explorer',
    remark: 'Test network',

    // 可选策略参数
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

调用 `switchchain` 接口可以请求钱包添加或切换到指定 Chain ID。如果钱包已经处于目标链，且 `silentIfCurrent` 未设置为 `false`，钱包会直接回调成功而不打开确认页面。目标链已经配置时，钱包只要求用户确认切换；目标链未配置时，钱包要求用户确认添加并切换。如果用户拒绝请求，回调会返回类似 `{err: 'User rejected network switch'}` 的错误。

支持参数：

- `chain_id` 或 `id`：目标 Chain ID。`0` 表示 Hacash 主网。
- `name`：链显示名称。不传时钱包会使用 `Chain ID {id}`。
- `rpc`：全节点 RPC URL。非主网链必须提供。
- `explorer`：区块浏览器 URL。
- `remark`：钱包内展示的链备注。
- `mode`：可选。默认值为 `addOrSwitch`。`switch` 表示只切换到已配置链，未配置时返回 `{err: 'Chain not configured', need_add: true}`；`add` 表示只添加或更新链配置，不切换当前链。
- `update`：可选。默认值为 `ask`。当 Chain ID 已配置但 dApp 传入的配置不同，`ask` 会让用户选择“Switch Only”或“Update & Switch”；`never` 使用钱包内保存的配置直接切换；`always` 在用户确认后更新保存的配置。
- `silentIfCurrent`：可选。默认值为 `true`。当前链已是目标链且配置无差异时，钱包直接返回 `{already_current: true, switched: false}`，不打开确认页面。

### 发起转账等交易

```js
let txobj = JSON.stringify({
    // 可选。设置后钱包会检查当前网络是否匹配这个 Chain ID。
    // 非主网链会由钱包自动向交易中添加 ChainAllow 动作。
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

通过将描述交易的 JSON 数据编码后传递给 SDK ，即可发起创建转账等交易的，并请求用户签名后广播给 Hacash 区块链打包和确认。签名成功后将交易信息回调返回：

`chain_id` 字段为可选项，可以放在 `txobj` 内，也可以作为 API 参数传入：`MoneyNex.transfer({txobj, chain_id: 1}, callback)`。传入后，钱包必须已经切换到对应链，否则回调会返回网络不匹配错误，并带上 `current_chain_id` 与 `request_chain_id`。在非主网链上，钱包会在创建交易前自动插入 ChainAllow 动作（`kind: 1041`）。在主网上，交易不能包含 ChainAllow 动作。

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

回调接口返回交易描述、哈希和交易体等信息。字段语义（DApp 侧契约）：

- `submit`（成功为 `true`）：钱包**已经广播**这笔交易到链上（在交易池 / 区块中）。`false` 只表示"已签名但未广播"。
- `txhash` 是交易的**普通 body 哈希**（浏览器上展示的链上标识）；`txhashfee` 是 `hash_with_fee`。
- `sign_hash` / `hash` 是当前签名者按地址的签名摘要。Type-2 交易中若签名者就是手续费支付方，该摘要等于 `hash_with_fee`，因此 `hash == sign_hash == txhashfee` 属正常，**不是**链上交易哈希。
- 若签名成功但链上广播被拒，钱包会回 `ret != 0`、`code: 'submit_failed'`、`err: 'Signed, but chain submission failed: ...'`，并带上已签名 `txbody`/`body`，由 DApp 决定何时、如何自行重试广播。

目前支持的交易 `actions` 如下，`kind` 既可用传统的**数字** dapp kind，也可用对应的 **SDK 注册表名称**（映射到同一个 action）：

| kind | SDK 名称 | 动作 |
| --- | --- | --- |
| 1 | `transfer_hac_to` | HAC 转账 |
| 5 | `transfer_hacd_single_to` | 单名 HACD 转账 |
| 6 | `transfer_hacd_to` | 多名 HACD 转账 |
| 8 | `transfer_sat_to` | SAT 转账 |
| 17 | `transfer_asset_to` | Asset 转账 |
| 32 | `hacd_insc_push` | HACD 铭刻 |

1. HAC 转账：

```js
{
    kind: 1, // 或 'transfer_hac_to'
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    amount: '1:248'
}
```

2. HACD 转账：

```js
{
    kind: 6, // 或 'transfer_hacd_to'
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    diamond: 'AAABBB,WWWWTT'
}
```

3. Asset 转账：

```js
{
    kind: 17, // 或 'transfer_asset_to'
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    asset: {
        serial: '1001',
        amount: '123456'
    }
}
```

`serial` 和 `amount` 建议始终使用十进制字符串，以免超出 JavaScript 安全整数范围后丢失精度。`amount` 是 Asset 的最小单位数量（atoms），不是按 Asset `decimal` 格式化后的展示数量。

4. HACD 铭刻：

```js
{
    kind: 32, // 或 'hacd_insc_push'
    diamond: 'AAABBB,WWWWTT', // one or more max 200
    inscription: 'First HACD inscription!',
    protocol_cost: '0.1' // 可选，由主账户燃烧的 HAC 金额（见下方说明）
}
```

**`protocol_cost` 是「金额」，不是费率纯度数字。** 它按普通 Hacash 金额解析——带单位串（`'0.1:248'`、`'100000000000000:232'`）或十进制 HAC 串（`'0.1'`）——链上按 **HAC 值** 比较，同一个燃烧额可以用任何单位写。约束只有两条：不得为负；**编码后不超过 4 字节**——请用整数好写的值（`'0.1'`、`'1'`），不要用长尾数串。该金额从交易主账户燃烧；`'0'`（默认）即不燃烧。

**节点返回的费率数字以链计价单位 u232 计价，不是 HAC。** 手续费与 gas 统一按 `fee_purity_unit` 子单位结算（`= 232`，即 10⁻¹⁶ HAC；1 HAC = 10¹⁶ u232）。节点给出的 `fee_purity`、`fee_purity_floor`、`fee_full_u232` / `fee_discount_u232`（`/query/contract_storage_fee`）、`minimum_fee`（`tx.estimate_fee`）、`purity`（`/query/fee/average`）都是 u232 计数，**是旧 u238 数值的 10⁶ 倍**（主网 fee purity 下限现为 `50000000000`，原为 `50000`）。若要把它们当金额用，必须先折成 HAC（`HAC = purity × 10⁻¹⁶`）；把原始费率数字直接塞进 `protocol_cost` 这类金额字段会多付约 10¹⁰–10¹⁶ 倍。

以上交易构建采用了 Hacash 的可读合约技术，多种转账可以随意组合并一次性签名，将被包裹在单笔交易内被区块打包确认，所有转账、铭刻同时生效。

更多交易 `action` 类别正在开发支持中。

### 签署多签交易

Hacash 支持原生 DEX 原子交易、多签交易等高阶功能，通过 SDK 或其他接口构建好交易之后，可以提交到钱包，请求用户签名，同一笔交易可以请求多个用户签名，只需要将签名后的 tx_body 数据保存，待全部用户签名完成后，交易即生效，可提交到链上确认。

```js
    let txbody = "02006607794700e63c33a796b3032ce6b856f68fccf06608d9ed18f40104000300010040afae783ae7927badaede2c4c97dbd53d542915f7010c000100674e11e34c472ebfba2d34528fccd8aba826f2c4f8017d000600674e11e34c472ebfba2d34528fccd8aba826f2c400e63c33a796b3032ce6b856f68fccf06608d9ed1801545548424d4500000000"
    // call api
    MoneyNex.signtx({txbody, chain_id: 1, autosubmit: false}, (a, b) => {
        sgtw.innerHTML = JSON.stringify(a)
        console.log(a, b)
    })
```

可选参数：

- `chain_id`：目标 Chain ID。不传时钱包会按主网（`0`）请求处理。
- `autosubmit`：为真值时，如果签名后所有必需签名都已完成，钱包会自动广播交易。

接口返回值：


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

其中，`body` 字段即为已经签名后的交易体数据，用户签名数据会自动添加进 body 内，需保存。等待所有用户签名完成后，即可将 body 提交上链。

钱包在签名前会检查交易体是否允许在当前链上使用。主网交易体不能包含 ChainAllow 动作；非主网交易体必须包含 ChainAllow 动作（`kind: 1041`），且其 `chains` 列表需要包含当前 Chain ID。

### TxMessage / TxBlob 显示解析

`tx_message`（kind 1025）与 `tx_blob`（kind 1026）是不透明字节载体。钱包只内置**协议级提取器**，布局是调用方传入的数据，不会为第三方业务升钱包。

布局每一项是数组，三种形式（`name` 为**未信任标注**；不传或 `""` 效果相同）：

```js
[field_id]
[field_id, "name"]
[field_id, "", len]
// 也允许 [field_id, "name", len]
```

按顺序切分，**必须精确覆盖**整段 message/blob。覆盖失败时签名页标红一句提示，**仍可签名**；字节以 HEX dump 展示。HEX 字段始终以难看的 hex dump 展示。

`field_id`（封闭集合，括号内为别名）：

| id | 宽度 | 显示 |
| --- | --- | --- |
| `hacash_addr21` (`addr`) | 21 | Hacash 地址 |
| `evm_addr20` (`evm`, `evm20`) | 20 | `0x` + 20 字节 |
| `u8` / `u16be` (`u16`) / `u32be` (`u32`) / `u64be` (`u64`) | 1/2/4/8 | 无符号大端整数 |
| `magic4` | 4 | 可打印 ASCII 或 HEX |
| `hex4` | 4 | HEX |
| `hacd_name` (`hacd`) | 6 | HACD 名称 |
| `hac_zhu` (`hac`, `amount`) | 必须带 `len` | 协议 Amount |
| `hacd_names` (`hacds`) | `len` = 6n | HACD 名称列表 |
| `asset_serial_amt` (`asset`) | 必须带 `len` | Fold64 serial + Fold64 数量 |
| `ascii` (`text`) | 必须带 `len` | 仅可打印 ASCII |
| `hex` (`bytes`) | 必须带 `len` | 原始 HEX dump |

可指定 **id** 或一次传入多张表。显示不区分 `tx_message` 与 `tx_blob`：`id`（也可用 `msgid`）是顶层 action 列表里 message/blob **出现顺序**的 0 起始序号。`action_id` 是同一 `actions[]` 的数组下标；若该槽不是 message/blob，签名页标红一句，仍允许签名。

布局解析错误**只影响显示**：签名页一句红字，不作为交易校验失败，不禁用 Sign。

```js
MoneyNex.signtx({
    txbody,
    msgid: 0,
    msglayout: [
        ['magic4'],
        ['u32be', 'net'],
        ['evm_addr20', 'to'],
    ],
}, cb)

MoneyNex.signtx({
    txbody,
    action_id: 0,
    msglayout: [
        ['magic4'],
        ['u32be', 'net'],
        ['evm_addr20', 'to'],
    ],
}, cb)

MoneyNex.signtx({
    txbody,
    msglayouts: [
        { id: 0, layout: [['magic4'], ['u32be', 'net'], ['evm_addr20', 'to']] },
        { id: 1, layout: [['ascii', 'memo', 12]] },
        { action_id: 3, layout: [['hex', '', 8]] },
    ],
}, cb)
// 等价 map（按 id）：msglayouts: { "0": [...], "1": [...] }
```

只传一张 `msglayout` 且不带 `id` / `action_id` 时，仅当交易里**恰好一条** message/blob 才套用。主标签永远来自钱包；`name` 直接作为旁注显示。转账金额以协议 Transfer 动作为准，不以 message 内 HAC 切片为准。

`signtx` / `transfer` / `signtext` / `connect` / `wallet` / `raisefee` 在不传 callback 时返回 Promise。

### 文本签名

请求用户用钱包当前账户签署**一段任意文本**。签名为本地 ECDSA（secp256k1-rfc6979-sha256）对 `SHA-256(文本)` 的签名，**不会广播上链**——它不可能被当作交易签名使用。

```js
MoneyNex.signtext({
    text: "ExampleApp 登录声明 2026-09-06 12:00:00 UTC",
}, (a) => {
    console.log(a)
    // 成功：{ret:0, success:true, text, digest, public_key, signature, address}
    //   digest    = SHA-256(text)，64 位 hex
    //   signature = 对摘要的 64 字节 r||s hex 签名
    // 取消：{ret:1, err:"...", code:"user_canceled"}
})
```

钱包强制的安全规则（拒绝时返回错误且不会签署任何内容）：

- 文本长度必须在 8 到 4096 字符之间。
- 形似**32 字节裸哈希**的文本（64 位 hex、可带 `0x`/空白，或 43 字符 base64/base64url 载荷）一律拒绝——请不要用 `signtext` 让用户为哈希背书，交易请使用 `signtx`。
- 签名前完整原文会在专门的审阅页面逐字展示给用户。

### 提升交易手续费

Hacash 支持实时提升手续费来改变在交易池内的排序，以达到尽快打包确认的目的。HACD 竞价费本质上也是交易的手续费，也可以采用此种方式来改变竞价排序。

```js
    let hash = "e2700db4558ef1e1b540fd53f5e7a0fa7b9d096947f9dc20d07bd507969987b9"
    let fee = "2:245" // or 0.002
    // call api
    MoneyNex.raisefee({hash, fee, chain_id: 1}, (a) => {
        // sgtw.innerHTML = JSON.stringify(a)
        console.log(a)
    })
```

`chain_id` 参数为可选项。传入后，钱包会在查询和签名待确认交易前检查当前网络是否匹配请求链；拉取到的交易体也会在签名并提交提高手续费交易前，再按当前链进行检查。

接口返回值：


```js
{
    "ret": 0,
    "success": true,
}
```


### 测试代码

上述 SDK 接口的测试参考用例，可以在下面目录中找到，并可作为开发者的编写示范：

- [测试代码](https://github.com/hacashcom/MoneyNex/tree/main/test)
