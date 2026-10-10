#!/usr/bin/env bash
# test/ui/provision-once.sh — 一次性 profile（disposable）沙盒：供 suite-onboard 使用。
# 独立实例（默认 TEST_INSTANCE_ID=mnxui-once，独立端口块/profile/扩展目录），
# 不起本地链、不起 dapp 服务（板载/导入/重置流程不依赖链）。
# 用法:
#   bash test/ui/provision-once.sh           # 全新 profile 启动沙盒（--fresh-profile）
#   bash test/ui/provision-once.sh --down    # 停沙盒
set -u
UI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 本脚本只服务一次性实例：无条件覆盖（继承外层 shell source env.sh 得到的
# TEST_INSTANCE_ID=mnxui 会把本脚本的一切解析回主实例 —— 实证清过主 profile）
export TEST_INSTANCE_ID=mnxui-once
source "$UI_ROOT/env.sh"

if [ "${1:-}" = "--down" ]; then
  bash "$UI_ROOT/chrome.sh" --stop || true
  echo "provision-once: stopped (disposable sandbox)"
  exit 0
fi

if [ ! -d "$MNX_REPO_ROOT/release" ] || [ ! -f "$MNX_REPO_ROOT/release/manifest.json" ]; then
  echo "provision-once: release/ 不存在，先跑 bash test/ui/provision.sh" >&2
  exit 1
fi

# 一次性扩展目录副本（路径不同 → ext id 不同，ext-ids.json 按实例各自维护）
mkdir -p "$MNX_EXT_ROOT"
rm -rf "$MNX_EXT_ROOT/moneynex"
cp -a "$MNX_REPO_ROOT/release" "$MNX_EXT_ROOT/moneynex"

# 全新 profile 启动（--fresh-profile 清空旧状态 → 熵屏/导入从零可测）
bash "$UI_ROOT/chrome.sh" --fresh-profile --restart --silent >/dev/null 2>&1 \
  || { echo "FAIL: disposable chrome sandbox"; exit 1; }
echo "provision-once: OK  (CDP=$MNX_CDP_PORT  profile=$MNX_PROFILE  disposable)"
