#!/usr/bin/env bash
# test/ui/env.sh — UI 仿真测试环境变量（自包含实例，MoneyNex 专用）。
#
# 用法:  source test/ui/env.sh   （首次先跑 bash test/ui/provision.sh 一键备齐链+沙盒）
#
# 端口：固定块自分配（不再依赖外部 instance-env 租约分配器）。
#   首次 source 时从 MNX_UI_PORT_BASE（默认 20150）起检查 8 个连续端口是否空闲，
#   冲突则整块 +10 递增，选定后写入 $MNX_INSTANCE_DIR/env.sh —— 跨会话稳定。
#     HACASH_PORT       本地 hacash fullnode RPC（chain_id=1 测试链，ZERO-MAINNET）
#     HACASH_P2P_PORT   fullnode P2P 监听
#     MNX_CDP_PORT      Chrome for Testing CDP
#     （dapp-http 固定 18652，在块外，见下）
# 隔离：专用 profile + 专用扩展目录（刷新扩展 = rm -rf $EXT_ROOT/moneynex 后重跑
#   provision.sh，会重拷 release 并 chrome.sh --restart —— 不刷新就测的是旧代码）。
# 多实例：TEST_INSTANCE_ID=xxx（或 MNX_INSTANCE_DIR/MNX_UI_PORT_BASE）后重新 provision。
export TEST_INSTANCE_ID="${TEST_INSTANCE_ID:-mnxui}"
# 实例目录一律由 TEST_INSTANCE_ID 推导，绝不继承已导出的 MNX_INSTANCE_DIR：
# 它是实例状态（随 source env.sh 泄漏到子 shell）。继承它会让「主实例 shell 里
# 跑 provision-once/run-all 一次性阶段」把一切解析回主实例 —— 实证后果是
# provision-once --fresh-profile 清掉主 profile、--down 停掉主沙盒。
# 多实例隔离入口只有一个：TEST_INSTANCE_ID（MNX_UI_PORT_BASE 仍可作为选块提示）。
export MNX_INSTANCE_DIR="/tmp/mnx-ui-tests/$TEST_INSTANCE_ID"
UI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$UI_ROOT/../.." && pwd)"
export MNX_UI_ROOT="$UI_ROOT"
export MNX_REPO_ROOT="$REPO_ROOT"

# 实例 env 文件（provision/env 首次选定端口块后写入）优先：跨会话稳定
if [ -f "$MNX_INSTANCE_DIR/env.sh" ]; then
  source "$MNX_INSTANCE_DIR/env.sh"
fi

# ---- 固定端口块自分配（仅在尚未选定端口时执行）----
if [ -z "${MNX_UI_PORTS_SELECTED:-}" ]; then
  _port_base="${MNX_UI_PORT_BASE:-20150}"
  _port_base="${_port_base%+*}" # 防御：基值本身不带偏移
  port_busy() { (echo >/dev/tcp/127.0.0.1/"$1") >/dev/null 2>&1; }
  _try=0
  while [ "$_try" -lt 200 ]; do
    _base=$((_port_base + _try * 10))
    _free=1
    for _p in $_base $((_base+1)) $((_base+2)) $((_base+3)) $((_base+4)); do
      if port_busy "$_p"; then _free=0; break; fi
    done
    if [ "$_free" = 1 ]; then break; fi
    _try=$((_try+1))
  done
  if [ "$_free" != 1 ]; then
    echo "env.sh: 从 ${_port_base} 起 200 个端口块均被占用" >&2
    return 1 2>/dev/null || exit 1
  fi
  export HACASH_PORT="$_base"
  export HACASH_P2P_PORT=$((_base+1))
  export MNX_CDP_PORT=$((_base+2))
  export MNX_UI_PORT_BLOCK="$_base"
  mkdir -p "$MNX_INSTANCE_DIR"
  cat > "$MNX_INSTANCE_DIR/env.sh" <<EOF
# 由 test/ui/env.sh 自动生成（实例 $TEST_INSTANCE_ID 的固定端口块；删除本文件可重新分配）
export MNX_UI_PORTS_SELECTED=1
export HACASH_PORT='$_base'
export HACASH_P2P_PORT='$((_base+1))'
export MNX_CDP_PORT='$((_base+2))'
export MNX_UI_PORT_BLOCK='$_base'
EOF
fi

export HACASH_RPC="http://127.0.0.1:$HACASH_PORT"
export HACASH_CHAIN_DIR="$MNX_INSTANCE_DIR/chains/hacash"
export HACASH_BLOCK_SEC="${HACASH_BLOCK_SEC:-1}"

# 沙盒（自管 chrome.sh + 自管扩展目录；CFT 见 fetch-cft.sh）
# 实例状态变量同样严格推导（理由同 MNX_INSTANCE_DIR）
export MNX_PROFILE="$MNX_INSTANCE_DIR/wallet-profile"
export MNX_EXT_ROOT="$MNX_INSTANCE_DIR/extensions"
export MNX_IDS_FILE="$MNX_INSTANCE_DIR/ext-ids.json"
export MNX_CHROME_LOG="$MNX_INSTANCE_DIR/chrome.log"

# dApp 仿真页 HTTP 服务（test/dapp-sim.html）；18652 在端口块之外（块区 20000+）
export MNX_DAPP_PORT="${MNX_DAPP_PORT:-18652}"
export MNX_DAPP_URL="${MNX_DAPP_URL:-http://127.0.0.1:$MNX_DAPP_PORT/dapp-sim.html}"

# 测试钱包约定（公开测试值；与 genesis 资助账户对齐，见 test/ui/chain/ 模板说明）
export MNX_TEST_PW="${MNX_TEST_PW:-MoneyNexTest88}"

# hacash 测试链 Rust 源码（编译 fullnode/poworker 用）：
#   HACASH_TESTNET_DIR 探测顺序：显式 env → .cache 自管 clone → 本机已有 checkout
export HACASH_TESTNET_DIR="${HACASH_TESTNET_DIR:-}"
export HACASH_FULLNODE_REPO="${HACASH_FULLNODE_REPO:-https://github.com/hacash/rust-fullnode.git}"
export DEFI_REPO="${DEFI_REPO:-https://github.com/hacashdiamonds/defi.git}"
export MNX_MACHINE_TESTNET="${MNX_MACHINE_TESTNET:-/media/jji/data/repo/hacashdiamonds/defi/tests/localnet/hacash-testnet}"

# Chrome for Testing（版本与缓存位置；系统 Chrome 不吃 --load-extension，必须 CFT）
export CFT_VERSION="${CFT_VERSION:-152.0.7977.82}"
export CFT_HOME="${CFT_HOME:-$UI_ROOT/.cache/cft}"

# 构建参数（测试配置，禁止分发）：本地链 chain_id=1
export MNX_BUILD_FULLNODE_URL="$HACASH_RPC"
export MNX_BUILD_CHAIN_ID=1
