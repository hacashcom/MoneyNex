#!/usr/bin/env bash
# test/ui/provision.sh — 一键备齐 UI 仿真测试环境（自包含）：
#   本地链（若未运行）→ 测试配置构建 release → 刷新沙盒扩展 → (重)启动 Chrome 沙盒
#   → dApp 仿真页 HTTP 服务
# 用法:
#   bash test/ui/provision.sh            # 全量
#   bash test/ui/provision.sh --ext-only # 只刷新扩展+重启沙盒（每次重构重建后必跑）
#   bash test/ui/provision.sh --down     # 停链+停沙盒+停 dapp 服务
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source test/ui/env.sh

cmd="${1:---full}"

stop_all() {
  bash "$MNX_UI_ROOT/chain.sh" stop || true
  bash "$MNX_UI_ROOT/chrome.sh" --stop || true
  pkill -f "http.server $MNX_DAPP_PORT" 2>/dev/null || true
  echo "provision: stopped (chain + sandbox + dapp server)"
}

if [ "$cmd" = "--down" ]; then
  stop_all
  exit 0
fi

# 0) node 依赖（test/ui/package.json 的 puppeteer-core；已装则秒过）
if [ ! -d "$MNX_UI_ROOT/node_modules/puppeteer-core" ]; then
  echo "provision: installing test/ui node dependencies..."
  ( cd "$MNX_UI_ROOT" && npm install ) || { echo "FAIL: npm install"; exit 1; }
fi

# 1) 本地链（ZERO-MAINNET：全部断言只打本地节点；缺二进制时给出自包含指引）
if ! curl -sf --max-time 3 "$HACASH_RPC/status" >/dev/null 2>&1; then
  echo "provision: starting local hacash chain ($HACASH_RPC)..."
  bash "$MNX_UI_ROOT/chain.sh" start || { echo "FAIL: chain start（bash test/ui/chain.sh doctor 排查）"; exit 1; }
else
  echo "provision: local chain already up ($HACASH_RPC)"
fi

if [ "$cmd" = "--ext-only" ]; then :; else
  # 2) 测试配置构建（TEST config：非默认 fullnode/chain-id，禁止分发）
  echo "provision: building release (fullnode=$MNX_BUILD_FULLNODE_URL chain_id=$MNX_BUILD_CHAIN_ID)..."
  node build.js --release --fullnode-url="$MNX_BUILD_FULLNODE_URL" --chain-id="$MNX_BUILD_CHAIN_ID" || { echo "FAIL: build"; exit 1; }
fi

# 3) 刷新沙盒扩展（自管扩展目录；不刷新 = 测旧代码，这是默认纪律）
mkdir -p "$MNX_EXT_ROOT"
rm -rf "$MNX_EXT_ROOT/moneynex"
cp -a release "$MNX_EXT_ROOT/moneynex"

# 4) (重)启动沙盒 Chrome（fetch-cft.sh 按需自动安装 CFT）
bash "$MNX_UI_ROOT/chrome.sh" --restart --silent >/dev/null 2>&1 || { echo "FAIL: chrome sandbox"; exit 1; }

# 5) dApp 仿真页 HTTP 服务（setsid 单命令后台：自身会话、fd 全重定向，脚本退出不等它）
if ! curl -sf --max-time 3 "$MNX_DAPP_URL" >/dev/null 2>&1; then
  echo "provision: serving dapp-sim on $MNX_DAPP_URL"
  setsid python3 -m http.server "$MNX_DAPP_PORT" --directory "$MNX_REPO_ROOT/test" \
      >> "$MNX_INSTANCE_DIR/dapp-http.log" 2>&1 < /dev/null &
  disown || true
  sleep 1
  curl -sf --max-time 3 "$MNX_DAPP_URL" >/dev/null || { echo "FAIL: dapp server"; exit 1; }
fi

echo "provision: OK  (RPC=$HACASH_RPC  CDP=$MNX_CDP_PORT  dapp=$MNX_DAPP_URL)"
