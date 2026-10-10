// test/ui/run-all.mjs — UI 仿真套件一键全量入口，输出 pass/fail 汇总。
//
//   node test/ui/run-all.mjs            # 全量（前提：bash test/ui/provision.sh 已跑）
//   node test/ui/run-all.mjs suite-pages # 只跑一个套件
//
// 顺序：锁定态 → 解锁 → 页面矩阵 → dApp 流 → 错误态。
// case 级隔离：单个 case 失败记录并继续后续 case（套件内顺序仍按定义序）；
// 任何失败 → 退出码 1。套件间失败也继续（尽量给出全景），但退出码汇总如实反映。
import './envboot.mjs'
import { getBrowser, sleep } from './lib.mjs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const only = process.argv[2] || null

// 环境就绪检查（不自动 provision —— 依赖必须显式准备，避免静默跑错配置）。
// suite-onboard 跑在一次性沙盒上（provision-once.sh）：无链、无 dapp，跳过 preflight。
async function preflight() {
  if (only === 'suite-onboard') return []
  const problems = []
  const rpc = process.env.HACASH_RPC || 'http://127.0.0.1:20150'
  const chainUp = await fetch(rpc + '/status', { signal: AbortSignal.timeout(3000) }).then(() => true).catch(() => false)
  if (!chainUp) problems.push(`local chain unreachable: ${rpc}（bash test/ui/provision.sh）`)
  const dapp = process.env.MNX_DAPP_URL || 'http://127.0.0.1:18652/dapp-sim.html'
  const dappUp = await fetch(dapp, { signal: AbortSignal.timeout(3000) }).then(() => true).catch(() => false)
  if (!dappUp) problems.push(`dapp-sim unreachable: ${dapp}（bash test/ui/provision.sh）`)
  return problems
}

const suites = {
  'suite-locked': (await import('./suite-locked.mjs')).cases,
  'suite-pages': (await import('./suite-pages.mjs')).cases,
  'suite-settings': (await import('./suite-settings.mjs')).cases,
  'suite-accounts': (await import('./suite-accounts.mjs')).cases,
  'suite-onchain': (await import('./suite-onchain.mjs')).cases,
  'suite-dapp': (await import('./suite-dapp.mjs')).cases,
  'suite-dappchain': (await import('./suite-dappchain.mjs')).cases,
  'suite-sdk': (await import('./suite-sdk.mjs')).cases,
  'suite-floatbar': (await import('./suite-floatbar.mjs')).cases,
  'suite-reqrecall': (await import('./suite-reqrecall.mjs')).cases,
  'suite-errors': (await import('./suite-errors.mjs')).cases,
  // 一次性 profile 套件：只在显式 `run-all.mjs suite-onboard` 或全量的 disposable
  // 阶段运行（主循环跳过 —— 它跑在另一个沙盒/另一套 MNX_* 环境变量上）
  'suite-onboard': (await import('./suite-onboard.mjs')).cases,
}

const problems = await preflight()
if (problems.length) {
  console.error('PREFLIGHT FAIL:')
  for (const p of problems) console.error('  -', p)
  process.exit(2)
}

// 板载检查/初始化走独立进程（mnx-setup 纪律：独立 browser client 各自持有）；
// suite-onboard 本身就是板载流程，且跑在一次性 profile 上，不做主 profile 初始化
if (!only && only !== 'suite-onboard') {
  const r = spawnSync('node', [path.join(__dir, 'onboard.mjs')], { stdio: 'inherit', env: process.env })
  if (r.status !== 0) { console.error('onboard failed'); process.exit(2) }
}

const browser = await getBrowser({ quiet: false })
const results = []
let n = 0
try {
  for (const [sname, cases] of Object.entries(suites)) {
    if (only && sname !== only) continue
    if (sname === 'suite-onboard' && only !== 'suite-onboard') continue // 仅显式/一次性阶段
    console.log(`\n== ${sname} ==`)
    // 套件前置状态：
    //  - suite-locked 前置（锁定）在 suite-locked 自身第一个 case 里完成
    //  - suite-onboard 自管状态（fresh profile，无前置）
    //  - 其余套件要求已解锁；每个套件入口都幂等 ensureHome/unlock
    for (const [cname, fn] of Object.entries(cases)) {
      n++
      const t0 = Date.now()
      try {
        if (sname !== 'suite-locked' && sname !== 'suite-onboard') {
          const { unlockWallet } = await import('./lib.mjs')
          await unlockWallet(browser)
        }
        await fn(browser)
        results.push({ suite: sname, name: cname, ok: true, ms: Date.now() - t0 })
        console.log(`  [PASS] ${cname} (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
      } catch (e) {
        results.push({ suite: sname, name: cname, ok: false, err: String(e && e.message || e).slice(0, 500) })
        console.log(`  [FAIL] ${cname}: ${String(e && e.message || e).slice(0, 400)}`)
      }
      await sleep(300)
    }
  }
} finally {
  await browser.disconnect().catch(() => {})
}

// 全量运行收尾：一次性 profile 阶段（suite-onboard：熵/创建/导入/重置等破坏性流程）
if (!only) {
  console.log('\n== disposable profile phase (suite-onboard) ==')
  // 子进程环境必须剥离全部 MNX_* 实例变量：它们来自父 shell 的 `source env.sh`，
  // 指向主实例（profile/CDP 端口/扩展目录）。env.sh 见到已设置就沿用 —— 不剥离的
  // 话 provision-once 的 --fresh-profile 会清掉主沙盒 profile、一次性板载跑进主
  // 实例、--down 停掉主沙盒（实证于 B 阶段全量回归：主钱包存储被 wipe，板载态丢失）。
  const onceEnv = (env) => {
    const e = {}
    for (const k in process.env) {
      if (k.startsWith('MNX_') || k === 'TEST_INSTANCE_ID' || k.startsWith('HACASH_')) continue
      e[k] = process.env[k]
    }
    return { ...e, ...env }
  }
  const run = (cmd, args, env) => spawnSync(cmd, args, { stdio: 'inherit', env: onceEnv(env) })
  const t0 = Date.now()
  let ok = false, err = ''
  try {
    if (run('bash', [path.join(__dir, 'provision-once.sh')], { TEST_INSTANCE_ID: 'mnxui-once' }).status !== 0) {
      throw new Error('provision-once failed')
    }
    const r = run('node', [path.join(__dir, 'run-all.mjs'), 'suite-onboard'], { TEST_INSTANCE_ID: 'mnxui-once', MNX_ENV_BOOTED: '' })
    if (r.status !== 0) throw new Error(`suite-onboard exited ${r.status}`)
    ok = true
  } catch (e) {
    err = String(e && e.message || e)
    console.log(`  [FAIL] disposable phase: ${err}`)
  } finally {
    run('bash', [path.join(__dir, 'provision-once.sh'), '--down'], { TEST_INSTANCE_ID: 'mnxui-once' })
  }
  results.push({ suite: 'disposable', name: 'suite-onboard (fresh profile phase)', ok, err, ms: Date.now() - t0 })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] suite-onboard disposable phase (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
}

const pass = results.filter((r) => r.ok).length
const fail = results.length - pass
console.log(`\n===== UI suite summary: ${pass} passed, ${fail} failed, ${results.length} total =====`)
for (const r of results.filter((x) => !x.ok)) {
  console.log(`  FAIL [${r.suite}] ${r.name}\n    ${r.err}`)
}
process.exit(fail ? 1 : 0)
