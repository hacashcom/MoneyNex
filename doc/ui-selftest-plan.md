# MoneyNex 测试环境自包含 + 全功能钉死 + Connected 浮层 · 计划报告（Phase 0）

任务书：本轮输入（需求 A1/A2、需求 B1/B2/B3、红线）。基线：分支 `refactor/cleanup`
（HEAD `8dd8667`，v0.4.1，上一轮重构 31/31 UI 全绿）。本文档 = Phase 0 产出：档案核实、
MetaMask 调研结论、分阶段实施计划与架构决策。

## 0. 项目档案核实结果（动手前逐条验证）

| 任务书条目 | 核实结果 |
|------|------|
| 仓库 / 分支 / v0.4.1 | ✅ manifest.json `0.4.1`，HEAD `8dd8667`（含 RPC 对话框/Connected sites in-page/菜单重排） |
| 构建链 | ✅ `build.js` + `build.cfg.js`；`page_defs` 9 页与任务书一致（moneynex/connect/transfer/signtx/signtext/raisefee/actionview/connectedsites/switchchain）；`--fullnode-url`/`--chain-id` 非默认 → TEST 警告（build.js:368） |
| `popup/<page>.*` 为产物 | ✅ .gitignore `popup/*.html` 等；真实源 `popup/<page>/<view>/vue.{html,js,less}` |
| 上一轮重构 | ✅ 9 commits；共享提取（`mnx_dapp_reply` 等）、`popup/comp/pghead`、mixin 归并、2 个渲染崩溃修复，报告 `doc/refactor-summary.md` |
| 用户本地改动 | ✅ 工作区仅 `popup/comp/comp.less`（`.bg.dark` 透明度 0.88→0.2 + 一处圆点尺寸）；**不提交不回滚**（本文档所有 commit 用显式路径 add） |
| test/ui 现状 | ✅ 4 套件（suite-locked/pages/dapp/errors）31 用例 + env/provision/onboard/lib/run-all/README；lib.mjs L15 仍 import 外部 `wallet-sandbox/lib.mjs` |
| 外部依赖 1（wallet-sandbox） | ✅ `chrome.sh`（CFT 启动 + ext-id 派生 + **MetaMask/stub-mainnet/anvil 全家桶**）、`lib.mjs`（puppeteer-core 23.11.1 CDP 基座 + 大量 MetaMask 专用逻辑）、`bin/chrome-linux64`（CFT 152.0.7977.82）、`node_modules/puppeteer-core@23.11.1` |
| 外部依赖 2（localnet） | ✅ `scripts/hacash-chain.sh`（fullnode+poworker 起停）、`chains/hacash/hacash.config.ini` + `poworker.config.ini` 模板、Rust 源 `hacash-testnet/`（workspace，path 依赖 `../../../../../hacash/rust/fullnode` ⇒ 需 `hacash/` 与 `defi/` 同级；**本机 `hacash/` 不是 git 仓库**，是普通拷贝）；genesis（`node/src/initialize.rs`）：faucet `1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9` 得 1,000,000 HAC + 3870 HACD + HUSD serial=1（6 位小数）+ AST1001–1012，挖矿收益走 `1Drrsep4vZVKhKWx2vVmiw8umYN3ETYraB` |
| 端口租约 | ✅ 现由外部 `instance-env.sh` 写 `/tmp/hacash-defi-tests/mnxref/env.sh`（当前块 20150 起）；A1 要去依赖 |
| 测试约定 | ✅ 密码 `MoneyNexTest88`、账户口令 `123456`、dapp-sim 127.0.0.1:18652；`test/` 根下的 `mm-*`/`*.loc` 文件均**未入库**（gitignore），无 EVM 内容需要从 git 里删除 |
| `MoneyNex.pem`/crx/zip | ✅ 存在且 gitignore；全程不读不改 |

与任务书的一处出入：任务书写 suite 组织为 `suite-locked/pages/dapp/errors.mjs`，实际是
4 个独立 `suite-*.mjs` 文件（内容一致），以实际为准。

## 1. MetaMask 调研结论（需求 B 前置）

子代理对 `MetaMask/metamask-extension` main 分支 + `MetaMask/providers` 做了证据级调研（文件级）：

1. **MetaMask 没有页面底部 Connected 浮层。** `app/scripts/contentscript.js` 只做钓鱼检测/
   cookie 流/cashtag/通信流，零 DOM UI；全仓库 `indicator/connected-bar` 命中全在扩展自身
   React 界面内。底部浮层是 OKX/新版 TronLink/Phantom 等钱包的行为（闭源，仅有用户反馈佐证，
   标注待确认）。⇒ 本任务 B 属自加功能，视觉规格以任务书为准，不照抄 MetaMask。
2. **断开通知链路**（可借鉴的核心骨架）：background `PermissionController` 状态 →
   `controllerMessenger.subscribe('…stateChange', selector)` 对「每 origin 许可」投影做 diff
   （`metamask-controller.js` L1896）→ 唯一出口 `_notifyAccountsChange → notifyConnections`
   对该 origin 的每个连接（`connections[origin][id] = {tabId, engine}`）推 JSON-RPC notification
   → content script Port 流 → inpage provider → 页面事件。要点：**不在各撤销入口手工发消息，
   而是订阅状态 diff**，任何撤销路径天然全覆盖。
3. **语义**：MetaMask 撤销站点权限时页面收 `accountsChanged: []`，**不发** EIP-1193 `disconnect`；
   `disconnect`（code 1013/1011）只留给传输/链层故障。我们的规格（`'disconnect'` + `{origin}`）
   是自有 SDK 面，与 EIP-1193 无冲突，但文档要写清触发时机，避免类比误解。
4. **样式隔离两档**（cashtag 是仓库内唯一注入宿主页面的先例）：
   - 轻：marker `<style data-mm-…>` + `mm-` 前缀类名 + dataset 挂钩 + 可完整卸载；
   - 重：`attachShadow({mode:'closed'})` + 扩展页 iframe（主题/CSP 全隔离）。
   ⇒ 浮层取中档：**closed shadow DOM + 内联样式**（不往宿主 document 插任何 style 标签）。
5. MV3 SW 生命周期：MetaMask 用「background 广播 READY → content script 重连 → 重放积压」。
   我们的通知走 `chrome.tabs.sendMessage`（on-demand 唤醒 SW，无需常驻端口），页面重载时的
   授权态由 content script 主动查询（任务书 B2 原文即此方案）。

## 2. 分支与提交策略

- `test/self-contained-ui`（自 `refactor/cleanup` 切出）：Phase 1（A1）+ Phase 2（A2），
  只动 `test/ui/`、`test/dapp-sim.html`、`.gitignore`、`package.json`（devDependencies）与 doc。
- `feature/connected-floatbar`（自 `test/self-contained-ui` 切出，理由：B3 浮层用例需要
  自包含测试环境；两分支 commit 零重叠）：Phase 3（B），动 `content/*.js` 源、`background/`、
  `jslib/message-types.js`（新增内部 action 常量，不改 8 API 面）、`test/dapp-sim.html`、doc。
- 每 commit：`npm test` + `node build.js`（Phase 3 起加 `--release` 双跑）+ UI 全量回归全绿；
  失败即停。工作区用户的 `popup/comp/comp.less` 改动用显式路径 add 隔离。
- 每 Phase 结束在会话内汇报进度 + 证据路径（截图、日志、run-all 汇总输出）。

## 3. Phase 1（需求 A1）实施设计

目标：`test/ui/` 内一条命令从零到可跑测试；外部 `wallet-sandbox`/`localnet` 不再被引用；
旧 31 用例全绿为验收。

### 3.1 新文件布局（test/ui/ 内自包含）

```
test/ui/
  env.sh            # 重写：自有固定端口块 + 冲突自动换块 + 实例 env 文件；不再 source 外部 instance-env
  provision.sh      # 重写：链(自管) → 构建 → 刷新扩展 → 重启沙盒 → dapp 服务；保留 --ext-only/--down
  fetch-cft.sh      # Chrome for Testing 下载安装（pin 152.0.7977.82，支持 CFT_VERSION=LKG）
  chain.sh          # hacash 测试链 start|stop|status|height|build|wipe|logs
  chrome.sh         # CFT 沙盒启动（只装 MoneyNex；无 MetaMask/stub-rpc/anvil/resolver 规则）
  lib.mjs           # 移植基座（getBrowser/sleep/closePage/quietWindow 等）+ 既有套件助手
  package.json      # puppeteer-core@23.11.1（与验证过的版本一致；npm install 用）
  chain/            # 链配置模板（自包含提交）：hacash.config.ini、poworker.config.ini
  .cache/           # gitignore：CFT、可选的 hacash-testnet 源码 clone、二进制缓存
  bin/              # （或 .cache/cft）CFT 解压位置，gitignore
```

### 3.2 关键决策

1. **CFT**：pin `152.0.7977.82`（当前沙盒同版本，已验证吃 `--load-extension`）；
   `CFT_VERSION=lkg` 时按 `last-known-good-versions.json` 解析。下载 `linux64` zip +
   校验 SHA（`known-good-versions.json` 自带 hashes；缺失时校验 zip 可解压 + chrome
   `--version` 可执行）。缓存 `test/ui/.cache/cft/<ver>/`。本机已存在 `/tmp/cft/…` 时
   直接复用（软链或复制）避免重复下载。
2. **链源码**：`chain.sh` 接受 `HACASH_TESTNET_DIR`（探测顺序：env → `test/ui/.cache/src/defi/tests/localnet/hacash-testnet` →
   本机已有 checkout `/media/jji/data/repo/hacashdiamonds/defi/tests/localnet/hacash-testnet`）。
   缺失时打印 clone 指引并支持 `chain.sh clone`（sparse clone defi + fullnode 源仓库到
   `.cache/src/`，保持 `defi/` 与 `<fullnode>/` 同级的相对 path 依赖布局；fullnode 源仓库
   URL 由 `HACASH_FULLNODE_REPO` 指定，默认 hacash 官方 rust fullnode 仓库，因本机副本非
   git 仓库无法读 remote —— 标注待确认，首次使用时以实际能编过为准）。`build` 用
   `cargo build -p hacash-testnet-node --bin fullnode` + `-p hacash-testnet-poworker`
   （testsleep 默认 feature，1s 块）。产物沿用源仓库 `target/debug/`（cargo 自带缓存）。
3. **端口块自分配**：默认块基 `MNX_UI_PORT_BASE=20150`，占 8 个连续口（fullnode RPC、
   P2P、CDP、dapp-http…）；`env.sh` 首次运行检查空闲，冲突则 +10 递增，选定后写入
   `$MNX_INSTANCE_DIR/env.sh`（跨会话稳定，语义对齐旧 instance-env 但完全自管）。
   实例目录 `/tmp/mnx-ui-tests/<id>`（默认 id `mnxui`）。**一次性迁移动作**：切换时先停
   外部旧链/旧沙盒（外部数据不删），让新实例落在默认块，避免双链并存。
4. **扩展装载刷新纪律**：`provision.sh` 每次先 `rm -rf $EXT_ROOT/moneynex` 再 `cp -a
   release`，再 `chrome.sh --restart`（旧目录不刷新会测旧代码——脚本默认行为）。
   `ext-ids.json` 由 chrome.sh 按加载路径派生写入，lib.mjs 只读它。
5. **lib.mjs 移植范围**：`getBrowser`（保留重连/0 页交叉校验/targets() 慢路径兜底与
   bringToFront 静默补丁；**删除** MetaMask prune 评分、mmTargets、approveMM 等全部
   MM 专用逻辑）、`sleep/closePage/quietWindow/openSilentWindow`（wheel 输入场景保留）、
   ext-ids 读取。puppeteer-core 以 `test/ui/package.json` 独立安装（不进根 package.json，
   避免污染发布依赖面；根 package-lock 不在 git，影响面为零）。
6. **无链模式**：run-all preflight 维持「链不可达直接失败」不静默降级（现状语义不变），
   README 写明哪些 case 依赖链。
7. **README 重写**：前置条件（Node≥18、cargo 仅编译链时、Linux x64）、一键运行、端口/实例
   隔离、无链模式、常见坑（扩展 id 按路径派生、`.hide` 是位移/透明不是 display:none、
   原生 value setter+input 事件、CFT 必需性、链 genesis 余额断言的确定性）。

### 3.3 验收

`bash test/ui/provision.sh && node test/ui/run-all.mjs` 全绿（31 用例），且
`grep -r "wallet-sandbox\|localnet" test/ui/` 仅剩文档性历史说明（代码零引用）。

## 4. Phase 2（需求 A2）测试矩阵设计

沿用纪律：fail-fast DOM 断言 + 每步真实截图 + run-all 汇总 + 单 suite 可独立跑
（`node test/ui/run-all.mjs <suite>`，自然满足「每个功能簇单独脚本、单独可执行」）。
最终 `test/ui/README.md` 的套件矩阵表即「总文档」入口，`doc/` 出总结报告。

新增套件（每套一个文件、一批 commit）：

| 套件文件 | 覆盖（功能簇） |
|------|------|
| `suite-settings.mjs` | RPC 覆盖（非法 URL 拒绝/保存生效/重置默认）；网络管理全流程（chains 添加→chainform 校验：非法 ID、重复主网、RPC 必填/协议→编辑→切换→删除→主网不可删）；主 profile 上的锁定/解锁循环 |
| `suite-accounts.mjs` | acinf：查看私钥（密码框门禁+复制）、删除账户、最后一个账户拒删（在一次性 profile 上） |
| `suite-onboard.mjs` | **一次性 profile**（独立实例 `mnxui-once`，run-all 以子进程编排：fresh profile → 跑完 → 收摊）：熵创建流程、导入 64-hex、导入助记词（合法/校验和错）、密码 <8 位/不一致拒绝、备份确认、doexit 三重确认重置钱包 |
| `suite-onchain.mjs` | dotrs 发 HAC（余额前后差值 + Activity pending→confirm 刷新）；发 HACD（genesis 钻石）；发 Asset（HUSD#1 decimals 显示）；给自己转账拒绝；余额不足报错 |
| `suite-dappchain.mjs` | dApp 批准链：signtx autosubmit 上链成功；raisefee 对真实 pending hash 提费成功；signtext 成功且 {public_key,signature,digest} ECDSA 校验（Node 侧或页内 facade 校验路径）；switchchain 批准+切换后**切回主网**；connect 拒绝路径（user_canceled） |
| `suite-sdk.mjs` | 回归锚：8 个 API resolve/reject 契约逐条对 doc/sdk.md 断言字段（在既有套件已覆盖的行为上补齐字段级断言，独立成锚） |
| 既有 `suite-dapp.mjs` 扩展 | actionview 完整 review 内容（meta 网格/动作卡/签名者状态/canonical json 折叠）；connectedsites 列表/断开/断开后同 origin 再请求重弹 connect |

分批 commit：批 1 settings+accounts，批 2 onboard（一次性 profile 编排），批 3 onchain，
批 4 dappchain+sdk+actionview 收尾。每批全绿后提交。

已知边界（README 注明，不算静默降级）：transfer/signtx 缺参走原生 `alert()` 依旧不自动化；
「导入助记词」如源码仅支持口令/私钥两种方式则以实际支持面为准（实施时核实 login/init）。

## 5. Phase 3（需求 B）实施设计

### 5.1 通道与数据流（简化等价 MetaMask 骨架）

```
撤销路径 A: 浮层「退出」   → content script sendMessage{action:mnx_disconnect_site}
撤销路径 B: connectedsites → stoRemoveConnectSite（现有代码，不动）
              ↓ 两条路径都落 chrome.storage.local.connect_sites
background: chrome.storage.onChanged(connect_sites)  ← 单点真相 + diff（旧→新）
             对被移除 origin 的已注册 tab 逐个 chrome.tabs.sendMessage{action:mnx_site_revoked}
             （新增路径时无需逐个改——订阅 diff 天然全覆盖，MetaMask L1896 模式）
content script: 收到 revoked → 移除浮层 → DOM 桥（hacash_api div 新属性 event=JSON + click）
page world(hacash_api.js): 分发 MoneyNex.on('disconnect') 回调 + window MoneyNexDisconnect CustomEvent
```

- **origin→tabs 注册表**：content script 每次 `document_idle` 注入时（top frame）向 background
  发 `mnx_tab_register`（background 从 MessageSender 取 origin+tab.id，不信任页面自报），
  存 `chrome.storage.session`（跨 SW 重启，浏览器会话结束自清）——避开 `tabs` 权限
  （红线：manifest 权限面不扩权，`chrome.tabs.query({url})` 不可用）。
- **页面加载时的授权态**：content script（仅 top frame）发 `mnx_connect_state` 查询
  `isConnectAuthorized(origin)`，失败/未连接不渲染浮层（B2 原文）。授权新增也走同一
  storage diff → `mnx_site_granted` 通知（浮层即时出现，无需重载页面；B3 用例直接可断言）。
- **SDK 面（只增不改）**：`MoneyNex.on(event,cb)` / `.off(event,cb)`，首版事件
  `'disconnect'`（detail `{origin}`）；同时 `window.dispatchEvent(new CustomEvent(
  'MoneyNexDisconnect',{detail:{origin}}))` 双通道。8 个既有 API 入参/返回/拒绝零变化；
  `hacash_api.js` 的 onclick 桥先查 event 属性再走原 did/data 回复路径，旧页面不受影响。
- **浮层 UI**：top-frame 注入 `position:fixed;bottom:0;left:0;right:0;height:34px` 宿主
  div（host `pointer-events:none`，bar `pointer-events:auto`——条外页面交互不受影响），
  `attachShadow({mode:'closed'})`，样式全部内联在 shadow 内（零宿主 CSS 污染，MetaMask
  cashtag 隔离模式的轻量版）。黑底、`border-top:1px solid`（取 `popup/tokens/tokens.less`
  的 `@bg-card`/`@line-*` 同色系常量，构建期手抄具体色值进内联样式——content script 不跑
  less）。左：绿色线形灯泡 SVG + `Connected`（绿）+ `location.host`（白）；右：齿轮（白）
  + 退出（红）图标，非按钮形态（无边框无背景，hover 才出现圆角矩形 card 色背景）。
  齿轮点击 → sendMessage `mnx_open_connectedsites` → background `chrome.tabs.create`
  （content script 无 tabs API，与 home 菜单同路径 `popup/connectedsites.html`）。
  退出点击 → 上图路径 A。
- **MV3 SW 生命周期**：所有通知为 on-demand `chrome.runtime`/`tabs` 消息（事件唤醒 SW，
  无常驻 Port）；SW 重启后注册表在 storage.session，页面重载靠查询兜底——两层都覆盖。

### 5.2 测试（B3，feature 分支上并入套件）

`suite-floatbar.mjs`：未连接不出现；connect 批准后出现（DOM 断言：宿主高 34、文案
Connected、host、两图标存在）；hover 背景变化（computed style）；点设置 →
connectedsites 页打开；点退出 → 浮层消失 + dapp-sim 收到 `MoneyNexDisconnect`
（dapp-sim.html 加监听渲染到 out-events 区）+ connectedsites 列表同步为空；断开后同
origin 再调 API 走 need_connect。`test/dapp-sim.html` 增加事件监听区块（回渲染证据）。

### 5.3 文档

`doc/sdk.md` + `doc/sdk.cn.md` 新增「Events」节：`MoneyNex.on/off`、`disconnect` 语义
（授权被用户撤销时触发，detail `{origin}`）、`MoneyNexDisconnect` CustomEvent 双通道、
示例代码；明确既有 8 API 契约不变。

## 6. Phase 4 终验清单

1. `npm test` 全过；
2. `node build.js --release`（默认参数）无 TEST 警告、无 INSECURE http 警告；
3. `bash test/ui/provision.sh && node test/ui/run-all.mjs` 全绿（含新套件全量）；
4. 关键截图抽查（真实渲染，不编辑）；
5. 总结报告 `doc/`（前后对比、每批证据、遗留风险）。

## 7. 风险与待确认

| 项 | 说明 | 处置 |
|----|------|------|
| hacash fullnode 源仓库 URL | 本机 `/media/jji/data/repo/hacash` 非 git 仓库，读不到 remote | `HACASH_FULLNODE_REPO` 可配 + README 指引；本机默认走已有 checkout 不受影响 |
| 链二进制体积（~254MB debug） | 不入库 | `.cache/` gitignore；本机复用已有构建产物 |
| background 直接写 connect_sites 的跨上下文竞争 | 浮层退出走 background 写，与 popup 页的整表读改写理论上可竞争 | 概率极低（用户双处同时断开同一站点）；实现时 background 侧也走串行队列，并在代码注释+总结报告注明 |
| doexit 用了原生 `prompt()` | 三重确认第三步是 prompt，会阻塞渲染进程 | 一次性 profile 上用 CDP `Page.handleJavaScriptDialog`（或 `page.on('dialog')`）自动应答——沙盒 puppeteer 可处理，不属于「mock 被测页面」 |
| 助记词导入是否存在于 init 流程 | 任务书要求测「导入助记词（合法/校验和错）」 | 实施时核实 `popup/login/init`；若钱包只支持口令/私钥导入，如实注明并以实际支持面交付 |
| CFT 新版本兼容 | pin 152.0.7977.82 已验证 | 默认 pin；升级显式改版本号 |
