# 任务：MoneyNex 钱包「冗余清理重构 + Chrome 沙盒 UI 仿真测试」

## 背景与目标

MoneyNex（`/media/jji/data/repo/hacashcom/nodejs/MoneyNex`）是一个 Hacash + Bitcoin 的 Chrome MV3 钱包扩展（当前 v0.4.1）。它经过多轮 AI 修改，积累了大量冗余与重复代码。你的任务是：

1. **自己探索、盘点**代码库，找出冗余/重复/死代码，制定优化计划；
2. **先建立 UI 仿真测试基线**（基于既有的 Chrome 沙盒设施），再动手重构；
3. 在测试门禁保护下**分批做行为保持的重构**，全程不引入 BUG。

这是行为保持（behavior-preserving）重构任务，**不是**功能再设计、不是 UI 改版。

## 项目档案（动手前先自行验证）

- 技术栈：原生 JS + Vue 3（模板在构建期用 `@vue/compiler-dom` 预编译）+ less/csso + uglify-js + html-minifier；自定义构建链 `build.js` + `build.cfg.js`，**没有** webpack/vite。
- `npm test` = jslib 的 3 个单元测试（importkey / assetamt / msglayout）；`node build.js` 构建到 `release/`，`--release` 为生产构建；带非默认 `--fullnode-url`/`--chain-id` 的 release 会被标记 TEST 配置，禁止分发。
- 真实页面清单以 `build.cfg.js` 的 `page_defs` 为准，共 9 个：`moneynex`（主页，含 index/home、acinf、dotrs、chains、chainform 视图）、`connect`、`transfer`、`signtx`、`signtext`、`raisefee`、`actionview`、`connectedsites`、`switchchain`。
- **结构陷阱**：每个页面在 `popup/` 根有一个同名 stub 文件（如 `popup/transfer.js`），真实视图在同名目录（如 `popup/transfer/`），构建时按 `page_defs` 组装。重构前必须先弄懂这对关系，不要当死代码误删。
- 共享组件已存在：`popup/comp/`（wptip/wpcfm/wpass/swtgas）、`popup/tokens`（design tokens）、`popup/login/init`。提取公共逻辑时优先复用它们，而不是新造一套。
- `jslib/` 是共享库（签名 facade `moneynx_sdk_facade.js`、`moneynx_txview.js`、`message-types.js`、crypto 等），部分带 `.test.js`。`jslib/hacash_sdk.js`（wasm，约 1.1MB）通过 `tail.html` 单独 `<script>` 加载，不进 bundle。
- `content/` 下的 `.min.js`/`.min.css` 是**构建产物**，禁止手改，改源头后重新构建。
- 根目录 `MoneyNex.pem` 是扩展签名私钥：**绝对禁止读取内容、修改、提交或外传**。`.crx`/`.zip` 构建产物同样不动。
- 背景必读：`README.md`、`doc/sdk.md`、`build.cfg.js` 顶部注释（有历史合并记录，能解释很多现状）、`test/ui-shot.mjs` 与 `test/final-shots.mjs` 的注释。

## 不可破坏的红线

1. **对外行为 100% 保持**：`window.MoneyNex` SDK 的 8 个 API（wallet / connect / transfer / signtx / raisefee / chain / switchchain / signtext）；content script 注入机制与 hidden-div `did`/`dmu` 消息桥；storage key（`connect_sites`、`mnx_fullnode_url`、`chain_configs`、`current_chain_id` 等）；manifest 权限面与 CSP。
2. **加密与密钥逻辑禁止重构语义**：`jslib/` 的 crypto-util、importkey、crypto-js、elliptic、hacash_sdk，以及 transfer/signtx/signtext 的签名与交易构造流程。只允许整体搬移位置/提取函数且逻辑逐字等价；拿不准就不动。
3. **不改用户可见行为**：UI 文案、样式呈现、交互流程保持不变（删除确认无引用的残留除外）。
4. **小步提交**：在独立分支（如 `refactor/cleanup`）上工作；每个独立优化一个 commit，改完立即跑全部验证（`npm test` + `node build.js` + UI 仿真套件全量），全绿才提交；禁止攒大包、禁止混入行为变更。
5. **失败即停**：任何断言失败先修复；禁止放宽断言、注释/跳过测试、加 known-issue 白名单、catch 后继续跑。
6. **证据真实**：截图一律来自真实渲染页面；禁止编辑图片、禁止 mock 被测页面本身。
7. **零主网规则**：测试构建必须 `--fullnode-url` 指向本地/测试节点；所有自动化不得请求主网、不得使用真实资金或真实私钥（测试账号/密码约定见沙盒 `mnx-suite.mjs` 顶部常量）。
8. **只读边界**：除 MoneyNex 仓库外一切只读；`/media/jji/data/repo/hacashdiamonds/defi/tests` 沙盒只许复用、不许修改（你可以在 MoneyNex 内写测试脚本 import 它的 `lib.mjs`）。
9. 不引入新框架、新构建工具、新大依赖；不做大规模重命名。

## 参考基础设施（只读复用）

沙盒根：`/media/jji/data/repo/hacashdiamonds/defi/tests/wallet-sandbox`

- `chrome.sh`：启动 Chrome for Testing（含已装好的 MetaMask/MoneyNex 扩展），CDP 端口默认 9336，profile 常驻沙盒 `profile/`。环境变量 `WALLET_SANDBOX_CDP_PORT` / `WALLET_SANDBOX_PROFILE` / `WALLET_SANDBOX_IDS_FILE` / `WALLET_SANDBOX_EXT_ROOT` / `TEST_INSTANCE_ID` 支持多实例隔离。
- `lib.mjs`：puppeteer 基座，导出 `getBrowser` / `MNX_ID` / `MM_ID` / `sleep` / `closePage` / `newPage` / `tidySandbox` / `ensureRendered` 等。扩展 id 一律从它（读 `ext-ids.json`）获取，不要自己推算。
- `unlock-wallets.mjs`（mnx|mm|all）：解锁钱包；`mnx-setup.mjs`：全新 profile 的初始化流程；**`mnx-suite.mjs` 是你写测试的范本**——14 步 fail-fast 步进门禁：DOM 断言抛异常、每步截图留证、进程内解锁（页面内原生 value setter + input 事件），开工前先通读它。
- dApp 触发流：MoneyNex 自带 `test/dapp-sim.html`，本地起 HTTP 服务后用它触发 connect/transfer/signtx 等通知弹窗页；做法参照 `test/final-shots.mjs` 的 `dapp` 模式。

### 沙盒使用要点（坑，务必遵守）

- `chrome.sh` 对 MNX 扩展取 `ext/moneynex`（该目录**不存在时**才从 release 拷一次）→ 每次重新构建后必须先删除/刷新沙盒里的 `ext/moneynex`（或用 `WALLET_SANDBOX_EXT_ROOT` 自管一份）再 `--restart`，否则你测的是旧代码。
- manifest 无 `key` 字段，扩展 id 按加载路径派生：路径不变则 id 稳定；变动加载路径会导致 id 变化，依赖 `ext-ids.json` 即可。
- 测试构建命令形如 `node build.js --fullnode-url=http://127.0.0.1:<本地节点端口>`；本地链优先复用 `defi/tests/localnet/` 的脚本；若本地链不可用，只做不依赖链上数据的 UI 断言，**禁止连主网**。
- 必须用沙盒自带的 Chrome for Testing（`bin/chrome-linux64`），系统 Chrome 不吃 `--load-extension`。

## 工作阶段

### Phase 0 — 勘察与盘点（只读，产出《重构盘点报告》）

1. 通读上文"项目档案"列出的文件，建立页面/模块全景：9 个页面 ×（stub + 视图 + less）、background 4 个模块（init/listener/account/main）、content、jslib。
2. 系统性排查冗余，逐条记录（文件、行数、重复证据、建议动作、风险等级）：
   - 跨页面复制粘贴的 Vue 组件/工具函数/样式（横向对比各 `popup/<page>/` 目录）；
   - 每页重复的样板逻辑：消息收发封装、地址/金额格式化、表单校验、确认/提示弹窗；
   - 死代码：未被 `page_defs`/构建配置引用的文件、被注释掉的大段代码、无引用导出、无引用 CSS 类；
   - `jslib/` 内的重复实现；`background/listener.js` 的重复分支；
   - 根 stub 文件与同名目录的职责是否清晰、有无历史遗留。
3. 产出《重构盘点报告》落盘到 `doc/`，按「安全（纯删除/纯搬移）→ 中等（提取共享模块）→ 高危（涉及 crypto/协议，默认不做）」排序成执行计划。**先盘点、后动工。**

### Phase 1 — 先建 UI 仿真测试基线（重构动工之前）

在 MoneyNex 内新建 `test/ui/`，复用沙盒 `lib.mjs`，为 `page_defs` 的每个页面建立仿真测试，纪律照抄 `mnx-suite.mjs`：

- 每个 case：真实打开 `chrome-extension://<MNX_ID>/popup/<page>.html`（视口 400×600），fail-fast DOM 断言 + 每步截图存 `test/ui/artifacts/`；
- 覆盖矩阵：
  a. **未登录态**：各页面打开时的密码框/引导渲染；
  b. **已登录态**（unlock 后）：主页各视图切换、connectedsites 列表、transfer/signtx/signtext/raisefee/connect/actionview/switchchain 的表单渲染与基本校验；
  c. **dApp 触发流**：本地服务挂 `test/dapp-sim.html` → connect 授权 → transfer/signtx/raisefee 通知弹窗的出现、内容、批准/拒绝按钮；
  d. **错误态**：错误密码、非法输入、无 RPC 时的降级提示。
- 提供 `test/ui/run-all.mjs` 一键全量并输出 pass/fail 汇总；写 `test/ui/README.md`：环境变量、chrome.sh 启动、解锁步骤、运行方式、前提条件（本地链/无链模式）。
- 依赖链上数据的 case 在本地链不可用时，允许以"无链模式"最小断言集通过，但必须在 README 标明，**不得静默降级**。
- 全部通过后 commit（如 `test: sandbox UI baseline`）。**此后这套测试就是 Phase 2 每一步的回归门禁。**

### Phase 2 — 分批重构（每批：改 → build → npm test → UI 全量回归 → commit）

按 Phase 0 的风险排序执行，建议批次：

1. 死代码清除（无引用文件、注释块、无引用导出/样式）；
2. 跨页面重复的工具函数/组件提取到共享位置（遵循 `build.cfg.js` 组装方式，保持 Vue 模板预编译兼容）；
3. 重复 less 归并（先弄懂 `tokens` 机制再动手）；
4. background 消息处理样板收敛；
5. 每批完成在《重构盘点报告》中勾销对应条目，commit message 写明：动了什么、删了多少行、如何验证。

### Phase 3 — 终验与交付报告

- `npm test` 全过；`node build.js --release` 干净构建（无 TEST-config 警告）；
- UI 仿真套件全绿；人工抽查关键截图（主页、transfer、signtx、connect、dApp 通知流）；
- git log 清晰（每批一个 commit，无夹带）；
- 输出《重构总结报告》到 `doc/`：优化前后对比（文件数/行数/重复点消除情况）、每批改动与证据截图路径、遗留风险与后续建议。

## 汇报要求

- 开工前先交 Phase 0 盘点报告；每完成一个 Phase 汇报进度与证据路径。
- 全程如实报告：测试失败就说失败，跳过了什么就明说，不确定的就标注"待确认"，禁止粉饰。
