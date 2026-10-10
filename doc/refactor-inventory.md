# MoneyNex 冗余清理重构 · 盘点报告（Phase 0）

> 分支 `refactor/cleanup`。基线 commit `4ee834a`（v0.4.1 之后）。
> 原则：行为保持（behavior-preserving）；红线见 `doc/ai-refactor-sandbox-prompt.md`。
> 状态标记：☐ 未做 / ☑ 已做（勾销时补 commit 号）。

## 0. 结构全景（已核实）

- 9 个页面（`build.cfg.js page_defs`）：`moneynex`（home/acinf/dotrs/chains/chainform 五视图）、`connect`、`transfer`、`signtx`、`signtext`、`raisefee`、`actionview`、`connectedsites`、`switchchain`。
- `popup/<page>.{html,css,js}`（根下同名文件）与 `content/*.min.*`、`background/background.js`、`popup/html/html.css` **均为构建产物**（未跟踪），由 `node build.js` 重新生成 —— 不是 stub 源码，不手改。
- 页面装配链：`pppjslibs`（jslib 共享库）→ `popup_common`（tokens/html/comp + wptip/wpcfm/wpass/swtgas + login/init）→ 页面视图（`<page>/<view>/vue.{html,js,less}`）→ `popup_services`（chain.js）→ `login` + 页面目录级 `<page>/<page>.{html,js,less}` + `tail`。
- Vue 模板构建期预编译（`@vue/compiler-dom`），组件对象形如 `swtgasAppObj`，经 `VueCreateApp(..., extds.components)` 注册。
- 源码量（git 跟踪的 js/css/html，不含 vendor 库）：约 9.6k 行；popup less 约 3.2k 行。

## 1. 安全级：纯删除 / 纯搬移（无行为影响）

| # | 位置 | 问题 | 动作 | 状态 |
|---|------|------|------|------|
| S1 | `jslib/moneynx_sdk_facade.js` | 16 个 facade 包装函数零引用（`sdk_tx_verify` / `sdk_tx_signature_report` / `sdk_tx_encode` / `sdk_tx_attach_signature_unbound` / `sdk_system_sdk_version` / `sdk_system_params` / `sdk_account_verify_address` / `sdk_account_verify_signature` / `sdk_amount_parse` / `sdk_amount_format` / `sdk_message_prepare_signature` / `sdk_message_verify` / `sdk_policy_evaluate` / `sdk_action_describe` / `sdk_vm_decode_call` / `sdk_diamond_lookup`）。grep 全库（含 test/*.mjs）仅命中定义处。它们不是 `window.MoneyNex` 的 8 个 API（那是 content/hacash_api.js 按 `optkey_list_to_popup` 生成的），也不在 doc/sdk.md。**保留 `MNX_OP` 完整表**（wire 协议序号文档，不能漂移） | 删除包装函数，保留 MNX_OP | ☑ (批次A/B) |
| S2 | `popup/html/html.js` | `sendMessage`（L131，chrome.runtime.sendMessage 封装）零引用 | 删除 | ☑ (批次A/B) |
| S3 | `popup/html/html.js` | `hexToString`（L168）零引用 | 删除 | ☑ (批次A/B) |
| S4 | `popup/comp/wptip/vue.js` | `showWPcopyok` 零引用 | 删除 | ☑ (批次A/B) |
| S5 | `popup/chain/chain.js` | `chainRpcText` 零引用（home 有自己的 `chainRpc`） | 删除 | ☑ (批次A/B) |
| S6 | `background/init.js` | `sendMessageToCurrentTabContent` 零引用（回复全部绑定 sender.tab） | 删除 | ☑ (批次A/B) |
| S7 | `popup/login/login.js` L493 | `btlglogok = $id('logok')` 赋值后从未读取（`#logok` 容器本身是页面挂载点，保留） | 删变量 | ☑ (批次A/B) |
| S8 | 注释死代码块 | `content/content.js` L99-126（document.body.onclick / window.hacash 大段注释）；`popup/login/init/vue.js` L409-416、L195-196、L68-69 测试注释；`popup/index/home/vue.js` L413-416、L432、L448-453；`popup/comp/wptip/vue.js` L71-77、`wpcfm` L64-73、`wpass` L89-94 测试注释；`popup/login/login.html` L18-21 `<!-- pass -->`；`background/main.js` L1；`jslib/message-types.js` L11-15 注释掉的 optkey；`popup/html/html.js` L15、L84；`build.js` 头部陈旧注释 L3-7 | 清理 | ☑ (批次A/B) |
| S9 | `popup/connect/conn/vue.css`、`popup/comp/swtgas/vue.css` | 未跟踪的旧构建残留（swtgas 的是空文件；conn 的是旧编译产物），构建链从不生成/读取 vue.css | 删除文件（本地清理，非 commit 内容） | ☑ (批次A/B) |
| S10 | `test/index.html` | 旧手工 dApp 测试页，被 `test/dapp-sim.html`（更完整、覆盖 sdk.md 全部契约路径）完全取代，无任何引用 | 删除；**同时把未跟踪的 `test/dapp-sim.html` 纳入 git**（UI 基线套件依赖它） | ☑ (批次A/B) |
| S11 | `jslib/moneynx_txview.js` | `mnx_esc_pre` 与 `mnx_esc_html`（msglayout.js）几乎相同（仅少 `"` 转义；用于 `<pre>` 内容，视觉等价） | 删 `mnx_esc_pre`，调用点改 `mnx_esc_html`（渲染输出视觉等价：`&quot;` 在 `<pre>` 中显示为 `"`） | ☑ (批次A/B) |

## 2. 中等级：提取共享组件 / 函数（行为等价搬移）

| # | 位置 | 重复证据 | 动作 | 状态 |
|---|------|----------|------|------|
| M1 | 6 个请求页模板 | `pchead`+`acctmenu`+`netsmenu` 头部 ~40 行 × 6（signtx/sigtrs 为"页面自管账号切换"变体，signtext/raisefee/connect/switchchain 为"mixin 静态徽标"变体）；行为逻辑已在 `jslib/moneynx_pghead.js` mixin 里但又各抄一份模板 | 新建 `popup/comp/pghead/`（vue.html/vue.js/vue.less），参照 swtgas 组件模式注册；mixin 数据/方法整体搬入组件；两变体用 props（`:adr/:sadr` 覆盖 + `@swt` 事件）统一；6 页模板换成 `<pghead/>`；`VueCreateAppEx` 的 `MNX_PGHEAD` mixin 注入逻辑随 mixin 一起移除 | ☑ (批次C) |
| M2 | `popup/html/html.js` `mnx_dapp_reply` | 6 页 `nop()` 三行样板完全一致（仅文案不同） | `mnx_dapp_reply(label, cancelMsg)` 返回值增加 `nop()` 闭包，页面删除各自的 nop | ☑ (批次A/B) |
| M3 | signtx/sigtrs/raisefee/dotrs/home×2 | `try { if(typeof stoReadCurrentChain==='function'){ t.chain=await stoReadCurrentChain(); t.chaintip=chainTip(t.chain) } } catch(e){}` 6 处复制 | 提取 `mnx_load_chaintip()` 到 `popup/chain/chain.js`（页面与 chain 服务同包） | ☑ (批次A/B) |
| M4 | signtx/sigtrs `openactv()` | 两页几乎逐字相同（10 行 × 2，仅 body 来源不同） | 提取 `mnx_open_actionview_for(body, txres)` 到 `jslib/moneynx_txview.js` | ☑ (批次A/B) |
| M5 | signtx/sigtrs/raisefee `openadrswct()`+`swtcuraddr()`；home 同名 | 账号切换样板 3-5 处复制（M1 组件化后请求页的变体 B 直接受益；signtx/sigtrs 的 live 切换保留页面方法，由 `@swt` 事件驱动） | 随 M1 收敛 | ☑ (批次C) |
| M6 | `popup/transfer/sigtrs/vue.js` `dosign()` L302-334 | txlog 构造时把 SDK action 名映射回数字 kind 的 if-else 链与 `mnx_map_txobj_actions` 顶部的名字→数字映射重复 | 提取 `mnx_action_numeric_kind(kind)` 帮助函数（sigtrs 内部），两处共用 | ☑ (批次A/B) |
| M7 | 钻石名归一化 `dnames()` | 同一函数体复制 3 份：`moneynx_txview.js`（txjson_to_spec 内）、`moneynx_txview.js`（parseTxDesc 内）、`actionview/vue.js`（内联 dn）；`sigtrs/vue.js` 也有一次 split+trim+filter | 提取 `mnx_split_diamond_names(v)` 到 `jslib/moneynx_txview.js` 顶部，4 处调用 | ☑ (批次A/B) |
| M8 | 请求页 less | `.txerr`（4 页逐字相同）、`.success`（4 页逐字相同）、`.wtip`（4 页相同）、`.txd`（signtx/sigtrs 逐字相同）、`.ldw`（signtext 重复定义 comp.less 已有全局 `.ldw`）、`.card/.lbl`（sigtrs 重复 comp.less `.reqpage .reqbody .card` 语义） | 归并到 `popup/comp/comp.less` 的 `.reqpage` 作用域下（.txd/.txerr/.success/.wtip/.lbl），各页只留真正页面特有的样式 | ☑ (批次D) |
| M9 | `home/acinf/connlists` 的 `cpadr/cppvk/cpdianms/cpbody` | `copyToClipboard(x); showWPtip(copyoktip)` 4+ 处 | 提取 `copyShowTip(s)` 到 html.js（紧邻 copyToClipboard） | ☑ (批次A/B) |

## 3. 高危级：涉及 crypto/协议或跨包语义（默认不做）

| # | 位置 | 说明 | 决定 |
|---|------|------|------|
| H1 | `background/account.js` 的 `bg_*` 链配置族 vs `popup/chain/chain.js` | 两套近似实现（~60 行重复）。**语义有故意差异**：popup 读链配置时会把缺失的 builtin 默认写回 storage，background 只读不写；合并需引入 write-back 开关，收益低风险实 | 不做，保留现状（两 bundle 隔离本就是构建约束） |
| H2 | `hac_mei_unit`/`hac_show_mei_unit`（html.js） | 依赖 `hacash_api`（已永久为 nil，P2-2 移除了 wasm boot）。输入含 `:` 时会抛 `Cannot read properties of null` —— **潜在 bug**（dApp 传 fin 格式 fee、或用户在自定义 gas 输 `1:245` 时触发，错误被上层 catch 显示原始 TypeError）。修复属行为变更 | 不改；标注待确认，建议后续单独修复（换成 `mnx_fin_to_decimal`） |
| H3 | `hexToBytes`(html.js) / `Buffer_from_hex`(facade) / `mnx_hex_to_bytes`(msglayout) 三套 hex→bytes | 校验语义不同（null vs 乱码）；hexToBytes 位于 submitTransaction 路径 | 不做（红线 2） |
| H4 | signtx/sigtrs 的 `dosign()` 签名+提交+回复主流程 | 结构相似但分支差异实质（autosubmit/txlog/fee 回退），强行合并会引入回归面 | 不做，仅做 M4/M6 的局部提取 |
| H5 | `content/define.js` 与 `popup/html/html.js` 的 DOM 帮助函数重复 | 两个隔离世界（content script vs 页面）各自打包所需，合并会让 content 世界背上页面依赖 | 不做（设计如此） |

## 4. 执行计划（Phase 2 批次）

1. **批次 A（=§1 全部）**：死代码清除。预期净删 ~250 行。
2. **批次 B（M2/M3/M4/M6/M7/M9）**：jslib/服务层小提取，不动模板。
3. **批次 C（M1/M5）**：pghead 共享组件（6 页模板 + mixin 移除）。
4. **批次 D（M8）**：请求页 less 归并。
5. 每批：`npm test` + `node build.js`（测试配置指向本地链）+ `test/ui/` 全量回归 + 沙盒 ext 刷新，全绿才 commit。

## 5. 测试基线（Phase 1）设计

- `test/ui/`：`run-all.mjs` 一键；`README.md` 说明环境。复用沙盒 `lib.mjs`（只读）。
- 覆盖矩阵：未登录态 9 页 / 已登录态主页 5 视图 + connectedsites / dApp 触发流（connect 批准、transfer/signtx/signtext/raisefee/switchchain 出窗+取消、transfer 全批）/ 错误态（错密码、signtext 拒签 hash、switchchain 缺参）。
- 本地链：`defi/tests/localnet/scripts/hacash-chain.sh start`（只读复用）；不可用时按 README 声明无链模式降级（仅去掉 transfer-approve 与 raisefee-成功 断言，其余照跑）。
- 沙盒刷新纪律：每次重建后删 `wallet-sandbox/ext/moneynex` 再 `chrome.sh --restart`。

## 6. 勘察结论摘要

代码库总量不大（~9.6k 行源码），主要漂移集中在：**请求页 6 份手抄的头部模板与控制器样板**（M1/M2/M5）、**4 份请求页 less 的复制块**（M8）、**facade 的未用包装**（S1）。jslib 分层（facade/txview/msglayout/assetamt）本身清晰，crypto/协议区无需也不应动。background 与 popup 的链配置双实现属构建隔离的合理成本（H1）。
