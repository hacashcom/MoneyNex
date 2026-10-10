#!/usr/bin/env bash
# test/ui/chrome.sh — 启动/重启 UI 仿真的 Chrome for Testing 沙盒（只装 MoneyNex）。
# 自包含版：无 MetaMask / stub-mainnet-rpc / EVM 相关内容。
#
# 用法:
#   bash test/ui/chrome.sh                     # 静默启动（不抢用户焦点）
#   bash test/ui/chrome.sh --focus             # 可见启动（便于人工观察）
#   bash test/ui/chrome.sh --restart [--silent|--focus]
#   bash test/ui/chrome.sh --fresh-profile --restart   # 清空钱包 profile 后重启
#   bash test/ui/chrome.sh --stop
# 环境变量见 test/ui/env.sh（MNX_CDP_PORT / MNX_PROFILE / MNX_EXT_ROOT / MNX_IDS_FILE）。
#
# 扩展 id 按加载路径派生（manifest 无 key）：路径不变则 id 稳定；本脚本写 ext-ids.json，
# node 侧（lib.mjs）只读它，绝不自行推算。每次重建扩展后必须刷新扩展目录并重启沙盒
# （provision.sh 已把该纪律做成默认行为）。
set -u
UI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$UI_ROOT/env.sh"

PROFILE="$(realpath -m "$MNX_PROFILE")"
CDP_PORT="$MNX_CDP_PORT"
IDS_JSON="$MNX_IDS_FILE"
CHROME_LOG="$MNX_CHROME_LOG"
PID_FILE="$MNX_INSTANCE_DIR/chrome.pid"
MODE_FILE="$MNX_INSTANCE_DIR/chrome.mode"
MNX="$MNX_EXT_ROOT/moneynex"

# Chrome for Testing（系统 Chrome 不吃 --load-extension）
CFT_BIN="${CFT_BIN:-$CFT_HOME/$CFT_VERSION/chrome-linux64/chrome}"
if [ ! -x "$CFT_BIN" ] || ! "$CFT_BIN" --version >/dev/null 2>&1; then
  echo "note: CFT $CFT_VERSION 未安装，自动执行 fetch-cft.sh ..."
  bash "$UI_ROOT/fetch-cft.sh" >/dev/null || { echo "FAIL: CFT 安装失败（bash test/ui/fetch-cft.sh）"; exit 1; }
fi
CHROME="$CFT_BIN"

if [ ! -d "$MNX" ]; then
  echo "FAIL: 扩展目录 $MNX 不存在（provision.sh 会构建并刷新；或手工 cp -a release）" >&2
  exit 1
fi

# —— 计算扩展 id：优先 manifest 公钥，否则按绝对路径派生 ——
ext_id_of() {
  node - "$1" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const dir = fs.realpathSync(process.argv[2])
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const bytes = manifest.key ? Buffer.from(manifest.key, 'base64') : Buffer.from(dir)
const hex = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
process.stdout.write([...hex].map((n) => String.fromCharCode(97 + parseInt(n, 16))).join(''))
NODE
}
MNX_ID="$(ext_id_of "$MNX")"
printf '{"moneynex":"%s","mnx_path":"%s"}\n' "$MNX_ID" "$MNX" > "$IDS_JSON"
echo "extension id: MoneyNex=$MNX_ID (CDP :$CDP_PORT)"

MODE="${MNX_FOCUS:-0}"
RESTART=0
FRESH_PROFILE=0
STOP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --focus) MODE=1 ;;
    --silent) MODE=0 ;;
    --restart) RESTART=1 ;;
    --fresh-profile) FRESH_PROFILE=1; RESTART=1 ;;
    --stop) STOP_ONLY=1; RESTART=1 ;;
    *) echo "用法: $0 [--silent|--focus] [--restart] [--fresh-profile] [--stop]" >&2; exit 2 ;;
  esac
done

is_owned_chrome_pid() {
  local pid="$1" cmd exe
  [ -r "/proc/$pid/cmdline" ] || return 1
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
  [ "$exe" = "$(readlink -f "$CHROME")" ] || return 1
  case "$cmd" in *"--user-data-dir=$PROFILE "*"--remote-debugging-port=$CDP_PORT"*|*"--remote-debugging-port=$CDP_PORT "*"--user-data-dir=$PROFILE"*) return 0 ;; esac
  return 1
}

OWNER_PID=""
if curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; then
  for proc in /proc/[0-9]*; do
    pid="${proc#/proc/}"
    if is_owned_chrome_pid "$pid"; then OWNER_PID="$pid"; break; fi
  done
  if [ -z "$OWNER_PID" ]; then
    echo "FAIL: CDP :$CDP_PORT 被其他 Chrome 占用；请设独立 MNX_CDP_PORT 与 MNX_PROFILE（或删除实例 env 重分配端口块）" >&2
    exit 1
  fi
  if [ "$RESTART" = 0 ]; then
    running_mode="$(cat "$MODE_FILE" 2>/dev/null || echo 0)"
    target_json="$(curl -sf "http://127.0.0.1:$CDP_PORT/json/list" || true)"
    if [ "$running_mode" = "$MODE" ] && printf '%s' "$target_json" | grep -Fq "chrome-extension://$MNX_ID/"; then
      echo "ok: chrome sandbox already running on :$CDP_PORT (mode=$([ "$MODE" = 1 ] && echo focus || echo silent))"
      exit 0
    fi
    echo "note: profile/模式/扩展状态需恢复 → 重启本沙盒 ($PROFILE)"
    RESTART=1
  fi
elif [ "$RESTART" = 0 ]; then
  for proc in /proc/[0-9]*; do
    pid="${proc#/proc/}"
    if is_owned_chrome_pid "$pid"; then
      echo "FAIL: 本 profile 已由 Chrome PID $pid 使用，但 CDP :$CDP_PORT 不可用；请核查旧沙盒" >&2
      exit 1
    fi
  done
fi

# 防堆积：重启前只杀本沙盒 profile 的实例（校验 exe+参数，绝不误杀他人 Chrome）
if [ "$RESTART" = 1 ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$OWNER_PID" ] && OLD_PID="$OWNER_PID"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    if is_owned_chrome_pid "$OLD_PID"; then
      kill "$OLD_PID" 2>/dev/null || true
      for _ in $(seq 1 30); do
        kill -0 "$OLD_PID" 2>/dev/null || break
        sleep 0.5
      done
      if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "FAIL: 本沙盒 Chrome PID $OLD_PID 未能正常退出；拒绝强制杀进程" >&2
        exit 1
      fi
    else
      echo "FAIL: 记录的 PID $OLD_PID 不属于本沙盒 Chrome；拒绝发信号" >&2
      exit 1
    fi
  fi
  rm -f "$PID_FILE"
  sleep 1
  # 清会话恢复文件：上次会话的扩展弹窗/历史页不再自动还原，每次重启干净
  rm -f "$PROFILE/Default/Current Session" "$PROFILE/Default/Current Tabs" \
        "$PROFILE/Default/Last Session" "$PROFILE/Default/Last Tabs" 2>/dev/null
  rm -rf "$PROFILE/Default/Sessions" "$PROFILE/Default/Sessions_Encrypted" 2>/dev/null
  # 清 Service Worker 脚本存储（B/Phase 3 实证）：扩展 SW 是持久注册，换扩展目录
  # 内容后仅重启浏览器并不保证重取 background.js —— 旧版本 worker 会继续应答
  # runtime 消息（本次浮层调试中被活体证据锁死：磁盘/服务脚本已含新 handler 而
  # 运行 worker 的消息表没有，五个 globalThis 启动标记全零）。每次启动清空注册，
  # 强制按磁盘脚本全新注册。扩展 SW 是该 profile 唯一的 SW，无误伤。
  rm -rf "$PROFILE/Default/Service Worker" 2>/dev/null
  if [ "$FRESH_PROFILE" = 1 ]; then
    rm -rf "$PROFILE"
    mkdir -p "$PROFILE"
    echo "note: 已清除本沙盒钱包 profile（$PROFILE）"
  fi
fi

if [ "$STOP_ONLY" = 1 ]; then
  echo "stopped this wallet sandbox (CDP :$CDP_PORT)"
  exit 0
fi

if [ ! -d "$PROFILE/Default" ]; then
  echo "note: $PROFILE 为空 —— 全新环境需先跑 test/ui/onboard.mjs（run-all 自动执行）"
fi

mkdir -p "$PROFILE"
CHROME_UI_FLAGS=()
if [ "$MODE" = 0 ]; then
  # 窗口最小化且移出工作区：不抢用户焦点；CDP 仍可完整驱动钱包页面
  CHROME_UI_FLAGS+=(--start-minimized --window-position=-32000,-32000)
fi
setsid "$CHROME" \
  --user-data-dir="$PROFILE" \
  --load-extension="$MNX" \
  --remote-debugging-port="$CDP_PORT" \
  --no-first-run --no-default-browser-check \
  --no-sandbox --disable-gpu \
  --disable-session-crashed-bubble --hide-crash-restore-bubble \
  --no-proxy-server \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --window-size=1440,960 \
  "${CHROME_UI_FLAGS[@]}" \
  "about:blank" > "$CHROME_LOG" 2>&1 < /dev/null &
LAUNCH_PID=$!
CHROME_PID=""
for _ in $(seq 1 20); do
  for proc in /proc/[0-9]*; do
    pid="${proc#/proc/}"; [ -r "$proc/cmdline" ] || continue
    cmdline="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)"
    case "$cmdline" in
      "$CHROME --user-data-dir=$PROFILE "*) CHROME_PID="$pid"; break;;
    esac
  done
  [ -n "$CHROME_PID" ] && break
  sleep 0.25
done
printf '%s\n' "${CHROME_PID:-$LAUNCH_PID}" > "$PID_FILE"
printf '%s\n' "$MODE" > "$MODE_FILE"

# 冷启动（全新 profile）时 CDP 可能要十几秒
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  kill -0 "$CHROME_PID" 2>/dev/null || break
  sleep 0.5
done
if curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; then
  echo "ok: chrome sandbox on :$CDP_PORT (profile=$PROFILE, mode=$([ "$MODE" = 1 ] && echo focus || echo silent))"
  echo "    ext-ids.json 已写入，node 脚本按它匹配钱包标签页"
  if grep -qiE "failed to load extension|could not load extension|manifest file is missing" "$CHROME_LOG" 2>/dev/null; then
    echo "WARN: chrome.log 报告扩展加载问题："
    grep -iE "failed to load extension|could not load extension|manifest file is missing" "$CHROME_LOG" | head -3 | sed 's/^/      /'
    exit 1
  fi
  n="$(curl -s "http://127.0.0.1:$CDP_PORT/json/list" | grep -c 'chrome-extension://' || true)"
  echo "    ok: 扩展加载无报错（当前 ${n:-0} 个扩展 target）"
else
  echo "FAIL: chrome 未起来，看 $CHROME_LOG"
  exit 1
fi
