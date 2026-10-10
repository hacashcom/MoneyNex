# MoneyNex UI 仿真测试（自包含回归门禁）

为 `build.cfg.js` `page_defs` 的 9 个页面 + dApp SDK 全部行为建立自动化基线。
**自包含**：Chrome for Testing 下载、本地 hacash 测试链（fullnode+poworker）、扩展装载、
CDP 基座全部由 `test/ui/` 内的脚本管理，不引用任何外部仓库。纪律：fail-fast DOM 断言、
每步真实渲染截图留证（`test/ui/artifacts/`）、进程内原生 value setter + input 事件驱动输入、
绝不 mock 被测页面、绝不编辑图片。

## 前置条件

1. **Node ≥ 18**（内置 fetch；`test/ui/npm install` 装 puppeteer-core）。
2. **Linux x64**（CFT linux64；脚本用了 /proc、dev/tcp 等 Linux 机制）。
3. **cargo / rust 工具链**：仅当需要编译链二进制时（`chain.sh build`）。已有二进制的机器不需要。
4. 本地链源码：`HACASH_TESTNET_DIR` 显式指定，或 `test/ui/.cache/src/`（`chain.sh clone`），
   或默认探测本机已有 checkout（`/media/jji/data/repo/hacashdiamonds/defi/tests/localnet/hacash-testnet`）。
   Rust 源仓库太大不入库；缺失时 `chain.sh clone` 会 sparse clone（需要网络与 git）。

## 一键运行（从零）

```sh
bash test/ui/provision.sh        # 链(若停) + 测试构建 + 刷新沙盒扩展 + (重)启 Chrome + dapp 页服务
node  test/ui/run-all.mjs        # 全量（主套件 + 一次性 profile 的 suite-onboard 阶段）；退出码 0=全绿
node  test/ui/run-all.mjs suite-pages   # 只跑一个套件（每个功能簇独立可执行）
bash  test/ui/provision.sh --down      # 收摊（停链 + 停沙盒 + 停 dapp 服务）
```

单独跑一次性 profile 套件（板载/导入/重置等破坏性流程）：

```sh
bash test/ui/provision-once.sh && TEST_INSTANCE_ID=mnxui-once node test/ui/run-all.mjs suite-onboard
bash test/ui/provision-once.sh --down
```

provision 自动完成：
- `fetch-cft.sh`：Chrome for Testing（pin `152.0.7977.82`，`CFT_VERSION=lkg` 取最新稳定版；
  带 SHA256 校验，缓存 `test/ui/.cache/cft/`，git 忽略）。系统 Chrome 不吃 `--load-extension`，必须 CFT。
- `chain.sh start`：本地 chain_id=1 测试链（模板 `test/ui/chain/`：genesis 给
  `1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9`（口令 `123456`，privkey=SHA256("123456")）发
  1,000,000 HAC + 3870 HACD + HUSD Asset#1 + AST1001-1012；1s 出块；挖矿收益走独立地址
  `1Drrsep4vZVKhKWx2vVmiw8umYN3ETYraB`——主账户余额只受被测行为影响）。
- `node build.js --release --fullnode-url=<本地链> --chain-id=1`（TEST 配置，禁止分发）。
- 扩展目录刷新 + CFT 启动（`--load-extension` 只装 MoneyNex）+ 按加载路径派生扩展 id 写
  `ext-ids.json`（lib.mjs 只读它）。
- dApp 仿真页 `test/dapp-sim.html` serve 在 127.0.0.1:18652。

## 端口与实例隔离

端口块由 `test/ui/env.sh` 自分配（默认基 20150，8 口一块：RPC / P2P / CDP…），冲突自动
整块 +10，选定后写入 `$MNX_INSTANCE_DIR/env.sh`（默认 `/tmp/mnx-ui-tests/mnxui`）跨会话
稳定。多实例：`TEST_INSTANCE_ID=xxx bash test/ui/provision.sh`。dapp-http 固定 18652
（块外）；换机器/清 `/tmp` 后重新 provision 即自动重分配。

链控制：`bash test/ui/chain.sh {start|stop|status|height|balance|wipe|logs|doctor|build|clone}`。
`wipe` 清链数据（下轮 start 从 genesis 重建，faucet 余额恢复确定性初值）。

## 套件矩阵

| 套件 | 覆盖 |
|------|------|
| `suite-locked` | 锁定态：主页解锁屏；8 个请求页打开时路由到密码框 |
| `suite-pages` | 已登录态：主页余额/活动/收藏标签、账号切换菜单、⋮ 菜单、acinf、dotrs 表单+空校验、chains+chainform（不保存）、connectedsites、RPC 设置入口 |
| `suite-dapp` | dApp 触发流（dapp-sim.html）：connect 授权+回复 address；transfer/signtx/signtext/raisefee/switchchain 窗口渲染+取消回复；有效体 signtx 审查；actionview 渲染；wallet() 直答；connectedsites 列表+断开；transfer 全批（签名+本地链提交，收 txhash） |
| `suite-settings` | RPC node 覆盖（非法 URL 拒绝 / 保存生效 / 重置默认）；网络管理全流程（chainform 四类校验 → 添加 → 编辑 → 切换 → 删除 → 主网不可删） |
| `suite-accounts` | acinf 查看私钥（密码框门禁 + 错/短密码拒绝 + 公开测试值断言）与复制；添加第二账户 → 删除 → 最后一个账户无删除入口 |
| `suite-onchain` | dotrs 发 HAC（余额精确差值 + Activity pending→confirm）、发 HACD、发 Asset（HUSD decimals）、自转拒、余额不足报错 |
| `suite-dappchain` | connect 拒绝路径；signtx autosubmit 上链；raisefee 对真实 pending hash 提费（停 poworker 制造确定性 pending）；signtext 签名 ECDSA 验证（digest==SHA256(text)、公钥验签）；switchchain 批准 + already_current + 切回主网；actionview 完整 review（meta 网格/动作卡/签名者状态/canonical json 折叠）；connectedsites 断开后同 origin 重弹 connect |
| `suite-sdk` | 回归锚：8 API 的 resolve/reject 契约字段逐条对 doc/sdk.md（need_connect/user_canceled/sign_refused/already_current 等） |
| `suite-floatbar` | 钱包内「Connected」指示条（B 修订，浮层已移出网页）：未连接无指示条（含 localhost 变体 origin）；批准后免刷新出现（Connected/host/双按钮/贴底）；**切换标签实时隐藏/复现**（CDP Target.activateTarget 真激活）；导航离开消失、返回重注册复现；同源 iframe 显示顶层域名（iframe 注册被忽略）；齿轮图标开钱包内 cnls 管理视图；退出 → 指示条消失 + MoneyNex.on disconnect 与 MoneyNexDisconnect 双通道 {origin} + connect_sites 清空；断开后同源 API need_connect 且重弹 connect 窗、再批准指示条复现；管理视图逐站断开同样双通道通知页面（通知路径唯一：storage.onChanged 差分）；撤销广播到同 origin 每个 tab（双 tab 双通道各自收到） |
| `suite-reqrecall` | 请求召回（2026-10-10，MetaMask 对齐）：connect/切链类静默（无角标无系统通知）；sign 类（signtext）开窗 → 角标 '1' + 恰一条 mnxreq- 通知，取消双清；钱包面打开即整页替换到待签页（checkStatusAndNavigate 对齐），在路由页取消 → 旧弹窗被后台关闭（mnx_req_done）+ 双清。注：工具栏图标点击本体 CDP 不可模拟，用打开 moneynex.html 等价 |
| `suite-errors` | 错密码；signtext 拒签 32B hash / 过短文本；raisefee 池外 hash 可见错误；actionview 缺 key；未授权 wallet() 的 need_connect 拒绝与恢复 |
| `suite-onboard` | **一次性 profile**（provision-once.sh，全量运行时自动编排）：熵收集、创建钱包（备份+密码规则）、doexit 三重确认重置、导入 64-hex、导入 BIP39 助记词（合法/校验和错）、口令导入校验、锁定/解锁 |

已知不覆盖（说明，不是静默降级）：

- transfer/signtx **缺参**路径（无 txobj/txbody）走原生 `alert()`，会阻塞渲染进程，
  自动化不覆盖（人工验证路径）。
- **无链模式**：若本地链不可用，`run-all` 在 preflight 直接失败退出（不静默降级）。
  需要链的 case：`suite-dapp` 的 transfer 全批、有效体 signtx、`suite-pages` 的主页余额。
  若临时无链，可先跑 `suite-locked` 与 `suite-errors` 中不依赖链的子集并在结果里注明。

## 每次重构重建后的刷新纪律（关键）

`chrome.sh` 的 MNX 扩展取 `MNX_EXT_ROOT/moneynex`（自管副本）。**改完代码必须**：

```sh
bash test/ui/provision.sh --ext-only   # 重新构建(若需)+刷新扩展+重启沙盒
node  test/ui/run-all.mjs
```

不刷新就测的是旧代码。扩展 id 按加载路径派生，路径不变则 id 稳定
（`ext-ids.json` 自动维护，脚本从 `lib.mjs` 读取，绝不自行推算）。

## 常见坑（写用例前必读）

- **扩展 id 按加载路径派生**：manifest 无 `key` 时 id = f(绝对路径)。移动目录/换机器后 id 变，
  一切以 `ext-ids.json` 为准。
- **`.hide` 是位移/透明，不是 display:none**：可见性必须按「祖先链无 hide 类」+
  `getBoundingClientRect().width > 4` 判定（lib.mjs `isVisible` / `fillVisiblePasswords`）。
- **输入用原生 value setter + input/change 事件**（`setInputValue`）：不用键盘、不依赖焦点。
- Chrome 不为后台标签计算布局：必要时 `bringToFront`（lib.mjs 已把静默模式补丁成视口仿真）。
- **后台 SW 脚本有持久版本**：改了 `background/*.js` 后仅重启浏览器不保证重取 background.js，
  旧版本 worker 会继续应答（B 阶段实证）。`chrome.sh` 每次重启自动清
  `wallet-profile/Default/Service Worker` 强制全新注册 —— 不要删掉这段。
- **标签切换必须走 CDP**：静默模式把 `bringToFront` 补丁成视口仿真（不真激活）。
  钱包内指示条跟随活跃标签的场景用 `lib.mjs activateTab`（`Target.activateTarget`，
  与用户点击标签栏等价、会触发钱包页 `tabs.onActivated`）。
- 链上断言的确定性：faucet 余额只受测试行为影响（挖矿收益独立地址）；要完全恢复初值用
  `chain.sh wipe`。

## 证据

- 截图：`test/ui/artifacts/*.png`（每次运行覆写；git 忽略）。
- 测试钱包：密码 `MoneyNexTest88`，账户口令 `123456`（privkey = SHA256("123456")，
  本地链 genesis 资助 1,000,000 HAC —— 均为沙盒约定的公开测试值）。
- dApp 页：`test/dapp-sim.html`（随仓库提交），serve 在 127.0.0.1:18652。
