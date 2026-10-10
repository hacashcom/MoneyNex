# MoneyNex 测试环境自包含化 + 全功能测试钉死 + 「Connected」浮层 — 总结报告

日期：2026-10-09 · 分支：`refactor/cleanup` → `test/self-contained-ui` → `feature/connected-floatbar`

---

## 0. 总览

四阶段全部完成，最终门禁**全绿**：

| 项 | 结果 |
|---|---|
| `npm test`（importkey / assetamt / msglayout） | ok |
| 生产构建 `node build.js --release` | ok，无 TEST/INSECURE 警告 |
| 完整 UI 套件 `node test/ui/run-all.mjs` | **64 通过 / 0 失败**（主 59 + 一次性 profile 5） |
| 截图抽查 | 真实渲染证据 77+ 张（`test/ui/artifacts/`，gitignored） |

提交链（每步均过 npm test + 构建 + 全量 UI 回归门禁）：

```
91ac8e4 doc: Phase 0 计划（doc/ui-selftest-plan.md）
5705df3 test(ui): A1 自包含环境（CFT/chain.sh/chrome.sh/lib.mjs 自研基座，31/31）
43747cc test(ui): A2 batch 1 — suite-settings + suite-accounts
9cd99f3 test(ui): A2 batch 2 — suite-onboard（一次性 profile）
726162f test(ui): A2 batch 3 — suite-onchain（HAC/HACD/Asset 上链差值）
ded1a5b test(ui): A2 batch 4 — suite-dappchain + suite-sdk（契约锚）
b745de9 feat(ui): B — Connected 浮层 + 断开通知框架 + MoneyNex.on/off + suite-floatbar
```

`test/self-contained-ui` 与 `feature/connected-floatbar` 为两个独立分支（后者基于前者），
符合任务红线的工作分支要求。用户本地未提交的 `popup/comp/comp.less` 改动全程未动、未提交。

---

## 1. 需求 A1：test/ui 自包含（Phase 1）

**外部依赖全部移除**：EVM/Anvil/Base/stub-mainnet-rpc/MetaMask/外部 wallet-sandbox 仓库的引用
不再存在于测试链路；`test/ui` 只依赖自身 + node + Chrome for Testing。

- **CFT 下载**：`fetch-cft.sh`（版本 152.0.7977.82，SHA256 对 known-good-versions 校验，
  缓存于 `test/ui/.cache/`（gitignored），下载后可执行性校验）。系统 Chrome 不吃
  `--load-extension`，必须 CFT。
- **本地 hacash 测试链**：`chain.sh start|stop|stop-poworker|status|height|balance|restart|
  build|clone|wipe|logs|doctor`。模板 `test/ui/chain/*.ini`（chain_id=1，出块 1s，
  poworker `-sleep` 支持停/续出块以制造确定性 pending）。genesis 资助
  `1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9`（1M HAC + HACD + HUSD#1 等），挖矿收益走独立地址
  作测试收款方。源码 clone 到 `.cache/`，`HACASH_TESTNET_DIR` 可显式指定本机 checkout。
- **端口块自分配**：`env.sh` 从 20150 起 5 端口探测、冲突整块 +10，选定后持久化到实例
  `env.sh`；实例目录 `/tmp/mnx-ui-tests/<TEST_INSTANCE_ID>`（profile/扩展目录/ext-ids/
  日志全实例私有）。**B 阶段发现并修复了跨实例泄漏**（见 §6.2）。
- **钱包构建+加载纪律**：`provision.sh` = 链健康 → `node build.js --release
  --fullnode-url=<本地链> --chain-id=1` → `rm -rf ext副本 + cp -a release` → 重启沙盒
  → dapp http 服务。ext id 按加载路径派生写入 `ext-ids.json`，脚本只认该文件。
- **lib.mjs 自研 CDP 基座**：puppeteer-core（devDependency，23.11.1）+ getBrowser 重连、
  sleep/closePage/quietWindow/openSilentWindow（`--start-minimized` 离屏静默模式）、
  钱包 UI 语义助手（isVisible 的 `.hide`=transform/opacity 判定、原生 value setter、
  wpcfm/wpass 确认框、 MutationObserver 抓 3s 自毁 toast、unlockWallet 幂等解锁并清理
  陈旧弹窗）。
- **README**（test/ui/README.md）：前置条件、一键运行、套件矩阵、端口/实例隔离、
  常见坑（ext id 路径派生、`.hide` 语义、原生 setter、SW 陈旧、hover 需上屏、
  transfer/signtx 缺参走原生 alert 不自动化）。
- **无链模式语义**：preflight 直连本地链失败即退出（不静默降级）；`suite-locked` 与
  `suite-errors` 部分用例不依赖链。

## 2. 需求 A2：全功能测试矩阵（Phase 2，10 个套件）

每个功能簇 = 独立可执行脚本（`node run-all.mjs <suite>`），`run-all.mjs` 聚合 + 一次性
profile 阶段编排（provision-once → suite-onboard → --down）。

| 套件 | 覆盖 |
|---|---|
| `suite-locked` | 锁定态主页、8 请求页路由到密码框 |
| `suite-pages` | 余额/活动/收藏/账号切换/⋮ 菜单/acinf/dotrs/chains/connectedsites/RPC 入口 |
| `suite-settings` | RPC 覆盖（非法拒/保存生效/重置）；网络全流程（chainform 四类校验、增改切删、主网不可删） |
| `suite-accounts` | 私钥查看门禁（短/错密码拒、公开测试值断言）+ 复制；第二账户增删、最后账户无删除 |
| `suite-onboard` | 熵收集、创建（备份 64-hex + 密码规则）、doexit 三重确认重置、导入 64-hex、BIP39 合法/坏校验和、口令长短/字符集校验 |
| `suite-onchain` | dotrs 发 HAC（余额精确差值含手续费 + Activity pending→confirm + trslogs 断言）、HACD（钻石数递减）、Asset HUSD#1（1.5=1.5e6 atoms、上链差值）、自转拒、余额不足（3s 自毁 toast 用 MutationObserver 历史抓取） |
| `suite-dapp` | connect 授权/取消/二连去重；transfer/signtx/signtext/raisefee/switchchain 窗口渲染与取消回复；actionview；wallet() 直答；connectedsites 列表+断开+重连 |
| `suite-dappchain` | connect 拒绝路径；signtx autosubmit 上链确认；raisefee 对真实 pending（停 poworker）双确认提费；signtext digest==SHA-256(text) + ECDSA 验签；switchchain 批准/already_current/切回主网；actionview 完整 review；断开后重连 |
| `suite-sdk` | 8 API 契约锚逐字段对 doc/sdk.md（need_connect/user_canceled/sign_refused/already_current/submit_failed/chain 字段集/info.version） |
| `suite-floatbar` | （Phase 3 新增，见 §3） |

上链类用例全部做**节点侧真值核对**（`/query/balance`、`/query/transaction`），交易哈希按
plain body hash 索引。A2 完成时基线 57/57（+onboard 5/5）。

## 3. 需求 B：「Connected」浮层 + 断开通知框架（Phase 3，commit b745de9）

### 3.1 架构（background 单一事实源）

```
connect_sites 写入（connect 批准页 / connectedsites 管理页 / 浮层退出）
        │ chrome.storage.onChanged（local）
        ▼
background/sites.js：新旧表成员 diff ──► mnx_site_revoked / mnx_site_granted
        │ chrome.tabs.sendMessage（按 storage.session 里 origin→[tabId] 注册表；
        │  tabs.query({url}) 需要 tabs/host 权限，红线禁止扩权，故用注册表）
        ▼
content/floatbar.js（isolated world，每 frame）
  ├─ 顶层 frame：挂载/卸载浮层
  └─ 属性+click 桥（独立事件 div，绝不复用请求 did 通道）
        ▼
page world（hacash_api.min.js）：MoneyNex.on('disconnect', cb) + window
MoneyNexDisconnect CustomEvent，detail {origin}
```

- **浮层 UI**：34px 全宽、贴视口底、1px 顶边框=卡色 `rgba(255,255,255,0.05)`（tokens.less
  @bg-card）、黑底、0 圆角、z-index 最大；左=绿描边灯泡（@sem-ok #3ba272）+ 绿 "Connected"
  + 白 host；右=白齿轮 + 红退出（@sem-error #e5544b）；图标非按钮（无边框/无底色），hover
  出 10px 圆角卡色底（shadow 内样式表实现——内联样式会压住 :hover，实测后修正）。
- **齿轮** → background `chrome.tabs.create('popup/connectedsites.html')`（content script
  无 tabs API）；**退出** → background 按 sender 派生 origin 撤销（仅能撤自己的站点；
  精确 origin 或 0.3.x 迁移的 bare-host key），由 revoked 推送统一收尾（含页面通知）。
- **仅顶层 frame**：同源 iframe（test/frame-host.html）不渲染浮层（有专项用例）。
- **页面加载**：`mnx_site_state` 异步查询，失败/未授权一律不显示（宁可无浮层，不可显示
  陈旧 "Connected"）。批准后**免刷新**挂载（granted 推送），撤销后立即消失。
- **SDK 增量**：`MoneyNex.on/off(event, cb)`（未知事件名静默忽略；off/on 对称去重）+
  `MoneyNexDisconnect` CustomEvent；8 个请求 API 与回复契约零改动。doc/sdk.md 与
  sdk.cn.md 新增 Events 章节；dapp-sim 自动订阅并把双通道证据落 `#out-events`。

### 3.2 suite-floatbar（7 用例，全绿）

未连接无浮层（127.0.0.1 与永未授权的 localhost 变体）→ 批准后免刷新挂载 + 全套 DOM 断言
（34px/1px 卡色边框/黑底/0 圆角/Connected/host/双图标无边框/贴底）→ 同源 iframe 仅顶层
→ 真实鼠标 hover 计算样式（含移开消退）→ 齿轮开管理页 → 退出（浮层消失 + 双事件通道
{origin} + connect_sites 清空）→ 断开后 wallet() 拒 need_connect 且重弹授权窗（批准收尾 =
重连后浮层免刷新回归）。

### 3.3 红线符合

- 8 API 契约零改动（hacash_api.js 仅增量 on/off；回复字段未动）✓
- 存量 storage 键名未动（新增 session 键 `mnx_connect_tabs`，与 `pending_req_replies` 同性质）✓
- manifest 权限/CSP 零扩（未加 tabs/storage.request 等任何权限；content_scripts 资源不变）✓
- 加密/签名逻辑零改动（未触碰任何 signing 路径）✓
- 既有页面用户可见行为零变化（除浮层本身）✓
- `content/*.min.*` 为构建产物：改动后由 provision 重建（.gitignore 管理，不入库）✓
- 零主网：测试构建指向本地链；只用公开测试值（密码 MoneyNexTest88 / 口令 123456）✓
- 截图全部真实渲染 ✓；无新框架（仅既定 puppeteer-core）✓
- `MoneyNex.pem` / `.crx` / `.zip` 全程未读未改未提交 ✓

### 3.4 与计划的两处偏差（均记录在案）

1. **shadow root 用 open 而非计划中的 closed**：closed root 的内部 DOM 对一切测试上下文
   不可达（isolated world 的 JS 属性跨不了 world，CDP 穿透 closed root 不是 puppeteer 的
   契约保证），而 B3 明确要求断言浮层内文本/图标/hover 计算样式。open root 样式隔离等价，
   且浮层不含秘密、不授特权（页面本就知道自己的连接态），安全上无差异。代码内有注释论证。
2. **MetaMask 无底部浮层先例**（Phase 0 调研结论，证据在 doc/ui-selftest-plan.md）：本实现
   为 OKX/TronLink/Phantom 风格的简化等价，按任务规格执行（34px/图标语义/退出撤销）。

## 4. Phase 4 终验

1. `npm test` — ok。
2. `node build.js --release`（不带测试参数 = 生产配置）— ok，输出无 TEST/INSECURE 警告。
3. `node test/ui/run-all.mjs` 全量 — **64/64**（主 59 + 一次性 suite-onboard 5），退出码 0。
4. 截图抽查（真实渲染）：浮层挂载态（068-floatbar-02-mounted.png：黑底绿字 + 双图标）、
   退出后（070：浮层消失）、齿轮打开的 Connected sites 管理页（069）、断开后重弹的
   connect 授权窗（071）等，均与断言一致。

## 5. 过程中发现并修复的问题（对后续维护有价值）

1. **后台 SW 脚本陈旧（本阶段最大坑）**：改 `background/*.js` 后仅重启浏览器**不保证**重取
   background.js —— 旧版本 worker 持续应答 runtime 消息。浮层调试中用五点 globalThis 启动
   标记 + SW 内需注册表探针活体锁死：磁盘/HTTP 服务的是新脚本而运行 worker 的消息表没有
   新 handler。修复：`chrome.sh` 每次启动前清 `wallet-profile/Default/Service Worker`，
   强制按磁盘脚本全新注册（README 已列为常见坑）。
2. **一次性实例环境泄漏**：`run-all` 一次性阶段原本只覆写 `TEST_INSTANCE_ID`，而父 shell
   source 过的 `MNX_INSTANCE_DIR/MNX_PROFILE/MNX_CDP_PORT` 等被原样继承，env.sh 又优先沿用
   已设置值 —— `provision-once --fresh-profile` 因此**清掉过主 profile**（板载钱包丢失才暴露），
   `--down` 停的也是主沙盒。修复三层：env.sh 一律由 `TEST_INSTANCE_ID` 严格推导实例状态、
   provision-once 无条件锁定 `TEST_INSTANCE_ID=mnxui-once`、run-all 子进程环境剥离
   `MNX_*`/`HACASH_*`/`TEST_INSTANCE_ID`。修复后实证：一次性阶段用自己的 ext id + 20162
   端口块，主实例无损。
3. **suite 间连接态假设**：suite-floatbar 以断开态收尾会让下游假定"已连接"的 suite 假失败。
   `ensureDappConnected` 上移 lib.mjs，suite-errors 三个窗口用例补连接前置；suite-floatbar
   末例以批准重连收尾（顺带钉住重连回归路径）。
4. 其他已修复（A1/A2 期间）：provision 挂起（后台 http 服务进程组）、wpcfm 陈旧弹窗串台
   （两层防护）、瞬态 toast 抓取、交易哈希索引口径等——均已固化在 lib.mjs/套件内，README
   有对应坑位说明。

## 6. 诚实披露：不覆盖项与待确认

- **transfer/signtx 缺参路径**走原生 `alert()`（阻塞渲染进程），自动化不覆盖；属人工验证
  路径，README 已注明（非本次引入，历史行为）。
- **同 origin 多标签页**的撤销广播：实现已覆盖（注册表按 tab 数组推送），但无专项多 tab
  用例（单 tab 断言已覆盖主路径）——如需可补一条双页用例。
- **hover 断言需窗口上屏**：最小化/离屏窗口 Chrome 不维护 `:hover` 绘制，suite-floatbar
  临时把沙盒窗口移到屏上再复位（测试专用沙盒，无用户焦点影响）。
- **版本号未动**：manifest 仍为 0.4.1（任务未要求 bump；文档以"与浮层同版本提供"表述）。
- **金钱成本**：上链用例消耗本地测试链 faucet 余额（挖矿收益独立地址持续回流；完全复位用
  `chain.sh wipe`）——零主网红线不受影响。
- **待确认（人工）**：浮层在真实用户屏幕上的视觉观感（间距/字号在 400–800px 视口的表现）
  建议人工过目一眼；自动化已钉住全部规格数字（34px/1px/颜色/圆角/贴底）。

## 7. 证据索引

- 计划：`doc/ui-selftest-plan.md`（Phase 0）
- 测试资产：`test/ui/`（11 个入口脚本 + lib.mjs + chain.sh/chrome.sh/env.sh/provision*）
- dApp 契约模拟页：`test/dapp-sim.html`（含 Events 区）、`test/frame-host.html`
- SDK 事件文档：`doc/sdk.md` / `doc/sdk.cn.md` Events 章节
- 截图：`test/ui/artifacts/`（本地，gitignored；本轮最终运行 77 张）
- 运行方式：`bash test/ui/provision.sh && node test/ui/run-all.mjs`
