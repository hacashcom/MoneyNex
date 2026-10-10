#!/usr/bin/env bash
# test/ui/chain.sh — 自包含的 hacash 测试链控制（fullnode + poworker）。
# 模板在 test/ui/chain/（chain_id=1、genesis faucet 1MzNY1oA3…、1s 块、独立挖矿收益地址）。
# 二进制来自 hacash-testnet Rust workspace（太大不入库）：HACASH_TESTNET_DIR 探测顺序
#   显式 env → test/ui/.cache/src/defi/tests/localnet/hacash-testnet（chain.sh clone 的自管副本）
#   → 本机已有 checkout（/media/jji/data/repo/hacashdiamonds/defi/tests/localnet/hacash-testnet）。
# 缺失时先 `chain.sh clone`（sparse clone defi + fullnode 源到 .cache/src/，path 依赖要求
#   两者同级）再 `chain.sh build`（cargo；仅此步需要 rust 工具链）。
# 用法: chain.sh {start|stop|status|height|balance [addr]|restart|build|clone|wipe|logs [n]|doctor}
set -u
UI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$UI_ROOT/env.sh"

CHAIN_DIR="$HACASH_CHAIN_DIR"
TEMPLATE_DIR="$UI_ROOT/chain"
DATA_DIR="$CHAIN_DIR/data"
PID_FULLNODE="$CHAIN_DIR/fullnode.pid"
PID_POWORKER="$CHAIN_DIR/poworker.pid"
LOG_FULLNODE="$CHAIN_DIR/fullnode.log"
LOG_POWORKER="$CHAIN_DIR/poworker.log"
POWORKER_INSTANCE_BIN="$CHAIN_DIR/poworker"
SERVER="$HACASH_RPC"

# ---- 源码目录解析 ----
resolve_testnet_dir() {
  if [ -n "$HACASH_TESTNET_DIR" ]; then
    echo "$HACASH_TESTNET_DIR"
    return 0
  fi
  local d
  for d in "$UI_ROOT/.cache/src/defi/tests/localnet/hacash-testnet" "$MNX_MACHINE_TESTNET"; do
    if [ -f "$d/Cargo.toml" ]; then
      echo "$d"
      return 0
    fi
  done
  return 1
}

TESTNET_DIR="$(resolve_testnet_dir)" || {
  echo "error: 找不到 hacash-testnet 源码。任选其一：" >&2
  echo "  1) HACASH_TESTNET_DIR=<路径> 指向已有 checkout（须与 fullnode 源仓库同级布局）" >&2
  echo "  2) bash $0 clone   # 自动 sparse clone defi + $HACASH_FULLNODE_REPO 到 test/ui/.cache/src/" >&2
  exit 1
}
FULLNODE_BIN="${HACASH_FULLNODE_BIN:-$TESTNET_DIR/target/debug/fullnode}"
POWORKER_BIN="${HACASH_POWORKER_BIN:-$TESTNET_DIR/target/debug/poworker}"

is_running() {
    [ -f "$1" ] || return 1
    local pid cmd proc_cwd
    pid="$(cat "$1")"
    kill -0 "$pid" 2>/dev/null || return 1
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    proc_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    case "$(basename "$1")" in
      fullnode.pid) [[ "$cmd" == *"$CHAIN_DIR/hacash.runtime.ini"* ]] ;;
      poworker.pid) [[ "$cmd" == *"$POWORKER_INSTANCE_BIN"* && "$proc_cwd" == "$(realpath -m "$CHAIN_DIR")" ]] ;;
      *) return 1 ;;
    esac
}

port_busy() { (echo >/dev/tcp/127.0.0.1/"$HACASH_PORT") >/dev/null 2>&1; }
p2p_port_busy() { (echo >/dev/tcp/127.0.0.1/"$HACASH_P2P_PORT") >/dev/null 2>&1; }

wait_http() {
    local i
    for i in $(seq 1 60); do
        if curl -sf "$SERVER/status" >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    return 1
}

clone() {
  local parent="$UI_ROOT/.cache/src"
  if [ -f "$parent/defi/tests/localnet/hacash-testnet/Cargo.toml" ]; then
    echo "clone: 已存在 $parent/defi/tests/localnet/hacash-testnet（跳过）"
    return 0
  fi
  echo "clone: sparse clone defi（hacash-testnet workspace）+ $HACASH_FULLNODE_REPO ..."
  echo "  （两者同级放置以满足 Cargo 相对 path 依赖 ../../../../../<fullnode>/rust/fullnode）"
  mkdir -p "$parent"
  ( cd "$parent" \
    && git clone --depth 1 --filter=blob:none --sparse "$DEFI_REPO" defi \
    && ( cd defi && git sparse-checkout set tests/localnet/hacash-testnet ) \
    && git clone --depth 1 --filter=blob:none --sparse "$HACASH_FULLNODE_REPO" "$(basename "${HACASH_FULLNODE_REPO%.git}")" \
    && ( cd "$(basename "${HACASH_FULLNODE_REPO%.git}")" && git sparse-checkout set rust/fullnode ) ) \
    || { echo "FAIL: clone 失败（检查网络 / HACASH_FULLNODE_REPO=$HACASH_FULLNODE_REPO / DEFI_REPO=$DEFI_REPO）"; exit 1; }
  echo "clone: ok → $parent"
}

build() {
    echo "building hacash-testnet fullnode + poworker（cargo，仅需 rust 工具链）..."
    (cd "$TESTNET_DIR" && cargo build -p hacash-testnet-node --bin fullnode) || return 1
    if [[ "${HACASH_POWORKER_FAST:-0}" =~ ^(1|true|yes|on)$ ]]; then
        echo "building poworker without testsleep (CPU intensive)"
        (cd "$TESTNET_DIR" && cargo build -p hacash-testnet-poworker --no-default-features)
    else
        echo "building poworker with testsleep throttling（默认：1s 测试块，CPU 常驻极低）"
        (cd "$TESTNET_DIR" && cargo build -p hacash-testnet-poworker)
    fi
}

start() {
    if [ ! -x "$FULLNODE_BIN" ]; then
        echo "error: fullnode 不存在: $FULLNODE_BIN（先 $0 build）" >&2
        return 1
    fi
    if [ ! -x "$POWORKER_BIN" ]; then
        echo "error: poworker 不存在: $POWORKER_BIN（先 $0 build）" >&2
        return 1
    fi

    if is_running "$PID_FULLNODE"; then
        echo "fullnode already running (pid $(cat "$PID_FULLNODE"))"
    else
        if port_busy || p2p_port_busy; then
            echo "error: HACASH RPC/P2P 端口 $HACASH_PORT/$HACASH_P2P_PORT 已被其他进程占用；拒绝附着或误杀（换块: 删除 $MNX_INSTANCE_DIR/env.sh 后重跑）" >&2
            return 1
        fi
        mkdir -p "$DATA_DIR" "$CHAIN_DIR"
        # 模板 → 运行时配置（端口/数据目录实例化）
        sed -e "s|data_dir = ./data|data_dir = $DATA_DIR|" \
            -e "s|listen_port = 13318|listen_port = $HACASH_P2P_PORT|" \
            -e "s|listen_port = 8088|listen_port = $HACASH_PORT|" \
            "$TEMPLATE_DIR/hacash.config.ini" > "$CHAIN_DIR/hacash.runtime.ini"
        setsid "$FULLNODE_BIN" "$CHAIN_DIR/hacash.runtime.ini" >> "$LOG_FULLNODE" 2>&1 < /dev/null &
        echo $! > "$PID_FULLNODE"
        if ! wait_http; then
            echo "error: fullnode HTTP 未就绪，见 $LOG_FULLNODE" >&2
            return 1
        fi
        echo "fullnode started: pid $(cat "$PID_FULLNODE") $FULLNODE_BIN"
    fi

    if is_running "$PID_POWORKER"; then
        echo "poworker already running (pid $(cat "$PID_POWORKER"))"
    else
        sed "s|127.0.0.1:8088|127.0.0.1:$HACASH_PORT|" "$TEMPLATE_DIR/poworker.config.ini" > "$CHAIN_DIR/poworker.config.ini"
        cp --reflink=auto "$POWORKER_BIN" "$POWORKER_INSTANCE_BIN"
        chmod +x "$POWORKER_INSTANCE_BIN"
        # -sleep <秒>：目标块间隔（testsleep 的每处 pause = 间隔/2）
        (cd "$CHAIN_DIR" && setsid "$POWORKER_INSTANCE_BIN" -sleep "${HACASH_BLOCK_SEC:-1}") >> "$LOG_POWORKER" 2>&1 < /dev/null &
        echo $! > "$PID_POWORKER"
        sleep 1
        if ! is_running "$PID_POWORKER"; then
            echo "error: poworker 启动失败，见 $LOG_POWORKER" >&2
            return 1
        fi
        echo "poworker started: pid $(cat "$PID_POWORKER") ($POWORKER_BIN, testsleep)"
    fi
}

# 只停 poworker（fullnode 继续服务 RPC）：UI 测试用来制造确定性 pending 交易
stop_poworker() {
    if is_running "$PID_POWORKER"; then
        pid="$(cat "$PID_POWORKER")"
        cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
        proc_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
        if [[ "$cmd" == *"$POWORKER_INSTANCE_BIN"* && "$proc_cwd" == "$(realpath -m "$CHAIN_DIR")" ]]; then
            kill "$pid" 2>/dev/null || true
            echo "stopped poworker only (pid $pid; fullnode keeps serving RPC)"
        else
            echo "refusing to signal PID $pid: command/cwd does not match this instance" >&2
            return 1
        fi
    else
        echo "poworker not running"
    fi
    rm -f "$PID_POWORKER"
}

stop() {
    for pf in "$PID_POWORKER" "$PID_FULLNODE"; do
        if is_running "$pf"; then
            pid="$(cat "$pf")"
            cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
            proc_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
            case "$(basename "$pf")" in
              fullnode.pid) owned=0; [[ "$cmd" == *"$CHAIN_DIR/hacash.runtime.ini"* ]] && owned=1 ;;
              poworker.pid) owned=0; [[ "$cmd" == *"$POWORKER_INSTANCE_BIN"* && "$proc_cwd" == "$(realpath -m "$CHAIN_DIR")" ]] && owned=1 ;;
            esac
            if [ "${owned:-0}" = 1 ]; then
                kill "$pid" 2>/dev/null || true
                echo "stopped $(basename "$pf" .pid) (pid $pid)"
            else
                echo "refusing to signal PID $pid: command/cwd does not match this instance" >&2
            fi
        fi
        rm -f "$pf"
    done
}

status() {
    if is_running "$PID_FULLNODE"; then echo "fullnode: running (pid $(cat "$PID_FULLNODE"))"; else echo "fullnode: stopped"; fi
    if is_running "$PID_POWORKER"; then echo "poworker: running (pid $(cat "$PID_POWORKER"))"; else echo "poworker: stopped"; fi
    if curl -sf "$SERVER/status" >/dev/null 2>&1; then
        echo "http: ok ($SERVER)"
        curl -sf "$SERVER/status" | head -c 500
        echo
    else
        echo "http: unreachable ($SERVER)"
    fi
}

height() {
    curl -sf "$SERVER/query/latest" 2>/dev/null | head -c 400
    echo
}

balance() {
    local addr="${1:-1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9}"
    curl -sf "$SERVER/query/balance?address=$addr" 2>/dev/null | head -c 500
    echo
}

wipe() {
    stop
    sleep 1
    mkdir -p "$CHAIN_DIR"
    rm -rf "$DATA_DIR"
    : > "$LOG_FULLNODE" 2>/dev/null || true
    : > "$LOG_POWORKER" 2>/dev/null || true
    echo "wiped $DATA_DIR（下轮 start 从 genesis 重建：faucet 恢复 1,000,000 HAC 等）"
}

logs() {
    local n="${1:-80}"
    echo "----- fullnode.log (tail -$n) -----"
    tail -n "$n" "$LOG_FULLNODE" 2>/dev/null || echo "(no log)"
    echo "----- poworker.log (tail -$n) -----"
    tail -n "$n" "$LOG_POWORKER" 2>/dev/null || echo "(no log)"
}

doctor() {
    echo "== mnx chain doctor =="
    echo "testnet src: $TESTNET_DIR"
    [ -x "$FULLNODE_BIN" ] && echo "fullnode: $FULLNODE_BIN" || echo "fullnode: MISSING（$0 build）"
    [ -x "$POWORKER_BIN" ] && echo "poworker: $POWORKER_BIN" || echo "poworker: MISSING（$0 build）"
    [ -f "$TEMPLATE_DIR/hacash.config.ini" ] && echo "config template: ok" || echo "config: MISSING"
    echo "data_dir: $DATA_DIR$([ -d "$DATA_DIR" ] && echo " (exists)" || echo " (empty/absent)")"
    echo "ports: rpc=$HACASH_PORT p2p=$HACASH_P2P_PORT"
    status
    echo -n "faucet balance: "
    balance
}

cmd="${1:-}"
shift || true
case "$cmd" in
    start)   start ;;
    stop)    stop ;;
    stop-poworker) stop_poworker ;;
    restart) stop; sleep 2; start ;;
    build)   build ;;
    clone)   clone ;;
    status)  status ;;
    height)  height ;;
    balance) balance "${1:-}" ;;
    wipe)    wipe ;;
    logs)    logs "${1:-80}" ;;
    doctor)  doctor ;;
    *)
        echo "Usage: $0 {start|stop|stop-poworker|status|height|balance [address]|restart|build|clone|wipe|logs [n]|doctor}"
        exit 2
        ;;
esac
