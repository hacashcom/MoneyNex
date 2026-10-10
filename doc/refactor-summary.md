# MoneyNex 冗余清理重构 · 总结报告（Phase 3）

分支 `refactor/cleanup`，基线 `4ee834a`（v0.4.1）。任务书：`doc/ai-refactor-sandbox-prompt.md`；
盘点与勾销：`doc/refactor-inventory.md`。

## 1. 终验结果（全部真实执行）

| 门禁 | 结果 |
|------|------|
| `npm test`（jslib 3 套单元测试） | ✅ 全过 |
| `node build.js --release`（生产配置） | ✅ 干净构建：无 TEST-config 警告、无 INSECURE http 警告 |
| `node test/ui/run-all.mjs`（Chrome 沙盒 UI 仿真） | ✅ **31/31 全绿** |
| 零主网 | ✅ 测试构建 `--fullnode-url=http://127.0.0.1:20090 --chain-id=1`（本地 hacash 测试链，`hacash-chain.sh` 起停） |
| 截图证据 | ✅ `test/ui/artifacts/*.png` 128 张，全部真实渲染页面（脚本不编辑图片） |
| git log | ✅ 每批一个 commit，无夹带（工作区仅剩用户自己的 `popup/comp/comp.less` 本地改动，未混入任何 commit） |

## 2. 前后对比

- 应用源码（跟踪的 js/html/less，排除 vendor 与 test/）：**13,020 → 12,479 行（净 -541）**；
  其中批次 A 纯删除 388 行，批次 C 模板净 -333/+187（含新增 131 行组件），批次 D less 净 -129。
- 文件：删除 `jslib/moneynx_pghead.js`（mixin，89 行）、`test/index.html`（旧手工测试页，165 行）；
  新增 `popup/comp/pghead/`（组件）、`test/ui/`（31 用例仿真套件 + provision/env/README）。
- 重复点消除：
  - 6 份手抄请求页头部模板（~40 行 × 6）→ 1 个 `<pghead>` 组件；
  - 5 份 `nop()` 取消样板 → `mnx_dapp_reply` 内置；
  - 6 份链上下文加载 try/catch → `mnx_load_chaintip()`；
  - 2 份 `openactv`（10 行/份）→ `mnx_open_actionview_for()`；
  - 4 份钻石名归一化 → `mnx_split_diamond_names()`；
  - 2 份 action-kind 映射链 → `mnx_action_numeric_kind()`；
  - 7 份 copy+toast → `copyShowTip()`；
  - 4 页 `.txerr/.success/.wtip/.txd/.card/.lbl` less 副本 → comp.less 单一定义（mixin 保持各页
    `#mount-id` 作用域，编译输出 **signtx/transfer/raisefee 字节级一致**，signtext 仅去掉与全局
    重复的 `.ldw`）。
- 死代码：17 个零引用 SDK facade 包装（MNX_OP 协议表完整保留）、`sendMessage`、`hexToString`
  （本身还是坏代码）、`showWPcopyok`、`chainRpcText`、`sendMessageToCurrentTabContent`、
  `btlglogok`、`mnx_esc_pre`（并入 `mnx_esc_html`）、各处注释掉的调试/测试代码块。

## 3. 基线抓到并修复的真实缺陷（重构前 main 上即存在）

| 缺陷 | 影响 | 修复 commit |
|------|------|-------------|
| signtext 页模板读 `{{sadr \|\| pgh_sadr}}` 但 data 未声明 `sadr` | 生产 Vue 渲染 ReferenceError → **签名文本页整页空白**（取决于 mixin 异步赋值竞态，多数时候必现） | `ba5e564` |
| switchchain 页模板读 `{{adr \|\| pgh_adr}}` 但 data 未声明 `adr` | 同上：切换网络审批页空白 | `ba5e564` |
| connect 页模板用 `.txerr` 但样式从未带过来 | 非法连接请求的错误块无样式渲染 | 批次 D（`0dd042d`，已在 commit message 注明为漂移修复） |

这三例正是"多轮 AI 修改积累的手写漂移"的实证；UI 基线（Phase 1）是抓到它们的直接原因。

## 4. 每批改动与验证（批次 → commit → 验证）

| 批次 | commit | 内容 | 验证 |
|------|--------|------|------|
| 基线 | `f4da88c` | test/ui 30 用例 + dapp-sim 入库 | 30/30 |
| A | `137caa7` | S1-S11 死代码（-388 行） | npm test + release 构建 + UI 30/30 |
| B | `b4b52f5` | M2/M3/M4/M6/M7/M9 共享提取 | 同上 + UI 30/30 |
| C | `97f8e4c` | M1/M5 pghead 组件（含新交互用例） | 同上 + UI 31/31 |
| D | `0dd042d` | M8 less mixin 归并（CSS diff 证明等价） | 同上 + UI 31/31 |
| 终验 | — | — | 生产 release 无警告 + UI 31/31 |

关键截图（`test/ui/artifacts/`，终验轮）：home（`011-pages-01-home`）、connect（`023-dapp-01-connect`）、
transfer（`024-dapp-02-transfer`）、signtx（`027-dapp-03-signtx`）、actionview（`028-dapp-04-actionview`）、
pghead 菜单（`025-dapp-pghead-acctmenu`/`026-dapp-pghead-netsmenu`）。
**视觉抽查（visual-judge，7 张关键截图）：7/7 pass** —— 无空白页、无错位、无溢出截断，
pghead 头部跨页一致，深色主题/青色强调统一。

## 5. 红线遵守

- 对外行为：`window.MoneyNex` 8 API、hidden-div `did/dmu` 桥、storage key、manifest/CSP —— 未触碰
  （content/ 与 manifest 零改动；UI 套件含 8 API 全路径断言）。
- crypto/密钥：jslib crypto 域、签名与交易构造流程零语义改动（facade 只删零引用包装；
  `mnx_esc_pre→mnx_esc_html` 为 `<pre>` 内视觉等价的显示函数归并）。
- 无新框架/新依赖/无大规模重命名；沙盒与 localnet 只读复用，未修改。
- `MoneyNex.pem`/`.crx`/`.zip` 未读未动。

## 6. 遗留风险与后续建议

1. **`hac_mei_unit`/`hac_show_mei_unit`（popup/html/html.js）潜在 bug**：依赖已永久为 nil 的
   `hacash_api`；输入含 `:`（fin 格式）时抛 TypeError（被上层 catch 成原始错误文案）。修复属行为
   变更（改为 `mnx_fin_to_decimal` 可恢复设计意图），本次按红线未动。建议单独修复 + 用例。
2. **background/popup 链配置双实现**（盘点 H1）：语义有意的差异（popup 读回写、background 只读），
   合并需引入开关，收益/风险不划算，维持现状。
3. **transfer/signtx 缺参路径走原生 `alert()`**：阻塞式，自动化不覆盖（README 已注明）；建议后续
   改为页内错误态（行为变更，需产品确认）。
4. **UI 基线维护**：每次改 UI 后 `bash test/ui/provision.sh`（重建+刷新沙盒）→
   `node test/ui/run-all.mjs`。新增页面/视图请同步加 case；无链模式下依赖链的 5 个 case 会红，
   先起链（见 test/ui/README.md）。
5. 工作区遗留的用户本地改动 `popup/comp/comp.less`（`.bg.dark` 0.88→0.2）未提交，请自行定夺。
