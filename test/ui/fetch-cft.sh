#!/usr/bin/env bash
# test/ui/fetch-cft.sh — 下载安装 Chrome for Testing（linux64）。
# 系统 Chrome 不吃 --load-extension（MV3 策略），UI 仿真必须用 CFT。
#
# 用法:
#   bash test/ui/fetch-cft.sh              # 安装 pin 版本（默认 152.0.7977.82）到 test/ui/.cache/cft/
#   CFT_VERSION=lkg bash test/ui/fetch-cft.sh   # 按 last-known-good 解析最新稳定版
#   CFT_VERSION=141.0.7390.65 bash ...          # 指定任意版本
# 已存在且可执行时直接复用（幂等）。
set -u
UI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$UI_ROOT/env.sh"

VER="$CFT_VERSION"
if [ "$VER" = "lkg" ]; then
  VER="$(curl -sf --max-time 20 https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.channels.Stable.version)})")" \
    || { echo "FAIL: 解析 LKG 版本失败"; exit 1; }
  echo "fetch-cft: LKG Stable = $VER"
fi

CHROME="$CFT_HOME/$VER/chrome-linux64/chrome"
if [ -x "$CHROME" ] && "$CHROME" --version >/dev/null 2>&1; then
  echo "fetch-cft: ok (cached) $("$CHROME" --version 2>/dev/null) @ $CHROME"
  echo "$CHROME"
  exit 0
fi

# 本机旧沙盒缓存（/tmp/cft 布局）可直接复用，避免重复下载
LEGACY="/tmp/cft/chrome/linux-$VER/chrome-linux64/chrome"
if [ -x "$LEGACY" ] && "$LEGACY" --version >/dev/null 2>&1; then
  mkdir -p "$CFT_HOME/$VER"
  cp -a "/tmp/cft/chrome/linux-$VER/chrome-linux64" "$CFT_HOME/$VER/" \
    && { echo "fetch-cft: ok (copied from legacy /tmp cache) @ $CHROME"; echo "$CHROME"; exit 0; }
fi

BASE="https://storage.googleapis.com/chrome-for-testing-public"
ZIP="/tmp/mnx-cft-$VER.zip"
echo "fetch-cft: downloading $VER (linux64)..."
curl -fL --retry 3 --max-time 600 -o "$ZIP" "$BASE/$VER/linux64/chrome-linux64.zip" \
  || { echo "FAIL: 下载失败（版本不存在或网络不可达）: $BASE/$VER/linux64/chrome-linux64.zip"; exit 1; }

# 校验：官方 known-good-versions.json 带 SHA256；校验失败即中止（绝不拿损坏的二进制测）
HASH="$(curl -sf --max-time 20 "$BASE/known-good-versions.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const j=JSON.parse(s);const v=j.versions.find(x=>x.version==='$VER');
    if(!v){process.exit(2)}console.log(v.downloads.chrome.find(d=>d.platform==='linux64')?.hash||'')}")" || true
if [ -n "${HASH:-}" ]; then
  ACT="$(sha256sum "$ZIP" | cut -d' ' -f1)"
  if [ "$ACT" != "$HASH" ]; then
    echo "FAIL: SHA256 不匹配（expect $HASH got $ACT）"; rm -f "$ZIP"; exit 1
  fi
  echo "fetch-cft: sha256 verified"
else
  echo "fetch-cft: WARN known-good-versions.json 无该版本哈希，跳过强校验（继续解压后 --version 验证）"
fi

TMPD="$(mktemp -d /tmp/mnx-cft-extract.XXXXXX)"
unzip -q "$ZIP" -d "$TMPD" || { echo "FAIL: 解压失败"; rm -rf "$TMPD" "$ZIP"; exit 1; }
rm -f "$ZIP"
mkdir -p "$CFT_HOME/$VER"
rm -rf "$CFT_HOME/$VER/chrome-linux64"
mv "$TMPD/chrome-linux64" "$CFT_HOME/$VER/" && rmdir "$TMPD" 2>/dev/null || true

"$CHROME" --version >/dev/null 2>&1 || { echo "FAIL: chrome 不可执行: $CHROME"; exit 1; }
echo "fetch-cft: ok $("$CHROME" --version 2>/dev/null) @ $CHROME"
echo "$CHROME"
