// test/ui/lib.mjs — UI 仿真套件共享库（自包含）。
// 纪律照抄沙盒 mnx-suite.mjs：fail-fast DOM 断言（assert 抛异常）、每步真实渲染截图
// 存 test/ui/artifacts/、绝不 mock 被测页面、绝不编辑图片。
// CDP 基座（getBrowser/sleep/closePage/quietWindow）已从 wallet-sandbox/lib.mjs 移植进来
// （puppeteer-core 依赖装在 test/ui/package.json），外部仓库不再被引用。
// 扩展 id 一律从 chrome.sh 写入的 ext-ids.json（MNX_IDS_FILE）读取，绝不自行推算。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dir = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(__dir, '../..')

// ---- CDP 基座（移植自 wallet-sandbox/lib.mjs，去除全部 MetaMask 专用逻辑）----
const CDP_PORT = process.env.MNX_CDP_PORT || '20152'
const CDP = `http://127.0.0.1:${CDP_PORT}`
export const FOCUS_MODE = process.env.MNX_FOCUS === '1'

export async function quietWindow(page) {
  if (FOCUS_MODE || !page) return
  // 整体限时：目标页渲染进程 wedge 时 CDP send 能挂满 protocolTimeout，
  // 而这只是为了把窗口最小化 —— 不值得等。
  const work = async () => {
    const cdp = await page.target().createCDPSession().catch(() => null)
    if (!cdp) return
    try {
      const { windowId } = await cdp.send('Browser.getWindowForTarget')
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
    } catch { /* the target may close while a wallet popup is changing */ }
    await cdp.detach().catch(() => {})
  }
  await Promise.race([work(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {})
}

// 后台窗口里个别控件要求可信输入（如需要 wheel/焦点的滚动门），把窗口临时移出屏幕
// 渲染再最小化（全程不出现在用户视野内）。
export async function openSilentWindow(page) {
  if (FOCUS_MODE || !page) return null
  const cdp = await page.target().createCDPSession().catch(() => null)
  if (!cdp) return null
  let windowId
  try {
    ({ windowId } = await cdp.send('Browser.getWindowForTarget'))
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: -32000, top: -32000, width: 1440, height: 960, windowState: 'normal' },
    })
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    return {
      close: async () => {
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {})
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }).catch(() => {})
        await cdp.detach().catch(() => {})
      },
    }
  } catch {
    await cdp.detach().catch(() => {})
    return null
  }
}
export async function withSilentWindowInput(page, fn) {
  const handle = await openSilentWindow(page)
  try { return await fn() } finally { await handle?.close() }
}

// 静默模式下 bringToFront() 会激活用户当前窗口：换成视口仿真（CDP 仍可驱动后台扩展页）。
function patchPageFocus(page) {
  const proto = page && Object.getPrototypeOf(page)
  if (!proto || proto.__mnxUiFocusPatched || typeof proto.bringToFront !== 'function') return
  const original = proto.bringToFront
  Object.defineProperty(proto, '__mnxUiFocusPatched', { value: true })
  proto.bringToFront = async function (...args) {
    if (FOCUS_MODE) return original.apply(this, args)
    await this.setViewport({ width: 1440, height: 960 }).catch(() => {})
    await quietWindow(this)
    return this
  }
}

/** 读 chrome.sh 写入的 ext-ids.json。 */
function extIds() {
  const f = process.env.MNX_IDS_FILE || path.join(__dir, 'ext-ids.json')
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}
export const MNX_ID = extIds().moneynex

export async function getBrowser({ quiet = true } = {}) {
  const connect = () => puppeteer.connect({
    browserURL: CDP,
    defaultViewport: null,
    // 弹窗渲染慢或 UI 线程繁忙时默认 protocolTimeout 会误报；放宽让慢页面有机会完成
    protocolTimeout: 240000,
  })
  // browser.pages() 要等所有 target 附就绪：某目标页恰在销毁/导航失败时可能永远挂起。
  // 加超时；HTTP /json/list 不依赖 CDP 会话，交叉校验「连接注册表为空」的坏状态并重连。
  const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))])
  const httpPageCount = async () => {
    try {
      const list = await fetch(`${CDP}/json/list`).then((r) => r.json())
      return list.filter((t) => t.type === 'page').length
    } catch { return -1 }
  }
  const finish = async (browser) => {
    let existing = await race(browser.pages().catch(() => []), 15000)
    if (existing === null) return null
    if (existing.length === 0 && (await httpPageCount()) > 0) {
      console.log(`[${new Date().toISOString()}] [lib] getBrowser: CDP 连接枚举到 0 页但 HTTP /json/list 有页面 → 连接损坏,重连`)
      return null
    }
    for (const page of existing) patchPageFocus(page)
    if (quiet && !FOCUS_MODE && existing[0]) await quietWindow(existing[0])
    return browser
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const browser = await connect()
    const done = await finish(browser)
    if (done) return done
    await browser.disconnect().catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
  }
  // 兜底：多轮重连仍拿不到健康连接时，用最后一根连接进 targets() 慢路径
  {
    const browser2 = await connect()
    let existing = null
    // 两轮枚举：某 target 首轮 attach 超时时第二轮补上，避免残缺页面列表
    for (let round = 0; round < 2 && existing === null; round++) {
      existing = await race((async () => {
        const out = []
        for (const t of browser2.targets()) {
          if (t.type() !== 'page') continue
          const p = await race(t.page().catch(() => null), 5000)
          if (p) out.push(p)
        }
        return out
      })(), 40000)
    }
    for (const page of existing || []) patchPageFocus(page)
    if (quiet && !FOCUS_MODE && existing?.[0]) await quietWindow(existing[0])
    return browser2
  }
}

// 真实激活一个标签（等价用户点击标签栏，会触发钱包页的 chrome.tabs.onActivated）。
// 静默模式把 bringToFront 补丁成了视口仿真（不再真激活），所以「钱包内 Connected
// 指示条跟随活跃标签」的场景必须走 CDP Target.activateTarget。
export async function activateTab(browser, page, settle = 700) {
  const t = page.target()
  const targetId = t._targetId || t.targetId
  const cdp = await browser.target().createCDPSession()
  try {
    await cdp.send('Target.activateTarget', { targetId })
  } finally {
    await cdp.detach().catch(() => {})
  }
  await sleep(settle)
}

// 钱包主页开在**独立窗口**（新 CDP window）。指示条场景里「钱包可见 + dapp 标签活跃」
// 必须同时成立：单窗口下钱包标签一旦退为后台标签，截图/布局就不可靠（Chrome 不为
// 后台标签计算布局，实测 shot() 会挂起 60s+）。侧边栏的真实形态正是「独立常驻面板」，
// 独立窗口是测试台上的等价物：窗口内它永远是活跃标签，正常渲染、正常截图。
export async function openHomeWindow(browser, { settle = 1200 } = {}) {
  const cdp = await browser.target().createCDPSession()
  let targetId = null
  try {
    ;({ targetId } = await cdp.send('Target.createTarget', { url: `${EXT}/popup/moneynex.html`, newWindow: true }))
  } finally {
    await cdp.detach().catch(() => {})
  }
  const t0 = Date.now()
  while (Date.now() - t0 < 20000) {
    const p = (await browser.pages()).find((x) => {
      const t = x.target()
      return (t._targetId || t.targetId) === targetId
    })
    if (p) {
      await p.setViewport(VP).catch(() => {})
      await sleep(settle) // 初次挂载（解锁态判断/主页渲染）
      return p
    }
    await sleep(300)
  }
  throw new Error('openHomeWindow: wallet home window never appeared')
}

export async function closePage(p) {
  if (!p) return false
  try { await p.close(); return true } catch { return false }
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

export const EXT = `chrome-extension://${MNX_ID}`
export const DAPP_URL = process.env.MNX_DAPP_URL || 'http://127.0.0.1:18652/dapp-sim.html'
export const HACASH_RPC = process.env.HACASH_RPC || 'http://127.0.0.1:20150'
export const PW = process.env.MNX_TEST_PW || 'MoneyNexTest88'
export const ACCOUNT_PASSPHRASE = '123456' // 公开测试值（沙盒 lib.mjs 约定）
export const EXPECTED_ADDRESS = '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9' // 本地链 genesis 资助
export const ART = path.join(__dir, 'artifacts')

export const VP = { width: 400, height: 600 }
export const VP_WIDE = { width: 1440, height: 960 }

fs.mkdirSync(ART, { recursive: true })

// ---- 证据：每步一张真实渲染截图 ----
let shotSeq = 0
export async function shot(page, name, vp = VP) {
  shotSeq++
  const f = path.join(ART, `${String(shotSeq).padStart(3, '0')}-${name}.png`)
  await page.setViewport(vp).catch(() => {})
  await sleep(220)
  await page.screenshot({ path: f }).catch(() => {})
  return f
}

// ---- fail-fast 断言 ----
export function assert(cond, label, detail) {
  if (cond) { console.log('    PASS:', label); return true }
  throw new Error(`ASSERT FAIL: ${label} :: ${String(detail).slice(0, 400)}`)
}
export const race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))])

// ---- 页面探针 ----
export const bodyText = (page) =>
  page.evaluate(() => document.body.innerText || '').catch(() => '')
export const visibleEls = (page, sel) =>
  page.evaluate((sel) =>
    [...document.querySelectorAll(sel)]
      .filter((x) => x.getBoundingClientRect().width > 4 && x.getBoundingClientRect().height > 4)
      .map((x) => ({ cls: String(x.className), text: (x.innerText || x.title || '').trim().slice(0, 40) })), sel)
    .catch(() => [])
// 0.4.x 的 .hide 是位移/透明而非 display:none：可见性必须按「祖先链无 hide」判断
export const isVisible = (el) => {
  for (let n = el; n; n = n.parentElement) { if (String(n.className).includes('hide')) return false }
  return el.getBoundingClientRect().width > 4
}
export async function clickByText(page, re, scope = '#wpage') {
  for (let i = 0; i < 14; i++) {
    const ok = await page.evaluate((re, scope) => {
      const rx = new RegExp(re)
      const els = [...document.querySelectorAll(`${scope} button, ${scope} .item, ${scope} li, ${scope} h4, ${scope} a, ${scope} .icbtn`)]
        .filter((x) => x.getBoundingClientRect().width > 4 && rx.test((x.innerText || x.title || '').trim()))
      if (!els.length) return false
      els[0].click()
      return true
    }, re, scope).catch(() => false)
    if (ok) return true
    await sleep(450)
  }
  throw new Error(`clickByText: nothing visible matching /${re}/ in ${scope}`)
}
// 进程内原生 value setter + input 事件（mnx-suite 纪律：不用键盘，不依赖焦点）
export async function setInputValue(page, sel, value) {
  await page.evaluate((sel, value) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error('no element ' + sel)
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, sel, value)
}
export async function fillVisiblePasswords(page, pw) {
  return page.evaluate((pw) => {
    let n = 0
    for (const el of [...document.querySelectorAll('input[type=password]')]
      .filter((x) => { for (let n = x; n; n = n.parentElement) { if (String(n.className).includes('hide')) return false } return x.getBoundingClientRect().width > 4 })) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, pw)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      n++
    }
    return n
  }, pw).catch(() => 0)
}

// ---- 扩展页打开 ----
export async function openExtPage(browser, rel, vp = VP) {
  const p = await browser.newPage()
  await p.setViewport(vp)
  await p.goto(`${EXT}/popup/${rel}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
  await sleep(700)
  return p
}
export async function ensureHome(browser) {
  // 去重：可能残留多个 moneynex 页（历史脚本/陈旧标签），只保留最新的一个，
  // 否则会挑中冻结在板载前引导屏的旧页，状态判断全部失真
  const homes = (await browser.pages()).filter((x) => x.url().startsWith(`${EXT}/popup/moneynex.html`))
  let home = homes[homes.length - 1] || null
  for (const stale of homes.slice(0, -1)) await stale.close().catch(() => {})
  if (home) {
    const alive = await race(home.evaluate(() => 1), 5000).catch(() => null)
    if (alive !== 1) {
      await race(home.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }), 18000).catch(() => {})
      await sleep(1000)
    }
  }
  if (!home) {
    home = await browser.newPage()
    await home.setViewport(VP)
    await home.goto(`${EXT}/popup/moneynex.html`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(1200)
  }
  await home.setViewport(VP).catch(() => {})
  return home
}
export async function waitBalances(home) {
  for (let i = 0; i < 25; i++) {
    const t = await bodyText(home)
    if (/HAC/.test(t) && !/Loading/i.test(t)) return t
    await sleep(600)
  }
  throw new Error('home balances never rendered')
}

// ---- dApp 请求弹窗 ----
export async function waitReqWin(browser, kind, ms = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const w = (await browser.pages()).find((x) => x.url().startsWith(`${EXT}/popup/${kind}.html`))
    if (w) {
      const has = await w.evaluate(() =>
        !![...document.querySelectorAll('#wpage button, #conn .btns button')]
          .find((x) => x.getBoundingClientRect().width > 4)).catch(() => false)
      if (has) { await w.setViewport(VP).catch(() => {}); return w }
    }
    await sleep(300)
  }
  throw new Error(`waitReqWin: no ${kind} window rendered`)
}
export async function waitNoWin(browser, kind, ms = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (!(await browser.pages()).some((x) => x.url().startsWith(`${EXT}/popup/${kind}.html`))) return
    await sleep(300)
  }
  throw new Error(`waitNoWin: ${kind} window still open after ${ms}ms`)
}
// 确保 dapp origin 已授权（connect_sites 有记录）：已连接直接返回，否则走一遍
// connect 批准窗。suite-dappchain / suite-errors / suite-floatbar 共用——套件
// 不得假定前序套件留下的连接态（全量顺序变化时会假失败）。
export async function ensureDappConnected(browser, dapp) {
  const home = await ensureHome(browser)
  const origin = new URL(DAPP_URL).origin
  const sites = await home.evaluate(async () => (await chrome.storage.local.get('connect_sites'))['connect_sites'] || {}).catch(() => ({}))
  if (sites[origin]) return
  await closeReqTargets(browser)
  await dapp.evaluate(() => document.getElementById('b-connect').click())
  const cw = await waitReqWin(browser, 'connect')
  await clickBtn(cw, 'blue')
  await waitOut(dapp, 'out-connect', 20000).catch(() => {})
  await waitNoWin(browser, 'connect')
}
export async function clickBtn(page, which) {
  for (let i = 0; i < 14; i++) {
    const ok = await page.evaluate((which) => {
      const b = [...document.querySelectorAll('#wpage button, #conn .btns button')]
        .find((x) => x.className.includes(which) && !x.className.includes('mid') && x.getBoundingClientRect().width > 4)
      if (!b) return false
      b.click()
      return true
    }, which).catch(() => false)
    if (ok) return
    await sleep(450)
  }
  throw new Error(`clickBtn: no visible ${which} button`)
}
// wpcfm 确认框的 OK（class 含 ok）
export async function confirmWpcfm(page) {
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(() => {
      const w = document.getElementById('wpcfm')
      const b = w && [...w.querySelectorAll('button')].find((x) => /(^|\s)ok(\s|$)/.test(x.className))
      if (!w || !b || String(w.className).includes('hide')) return false
      b.click()
      return true
    }).catch(() => false)
    if (ok) return true
    await sleep(500)
  }
  throw new Error('confirmWpcfm: no visible wpcfm ok button')
}
// 可选的 wpcfm（复杂动作确认等，可能出现也可能不出现）：等 ms 内出现则确认，返回是否出现
export async function tryWpcfm(page, ms = 4000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const ok = await page.evaluate(() => {
      const w = document.getElementById('wpcfm')
      const b = w && [...w.querySelectorAll('button')].find((x) => /(^|\s)ok(\s|$)/.test(x.className))
      if (!w || !b || String(w.className).includes('hide')) return false
      b.click()
      return true
    }).catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}
// wpass 密码确认框（.popbox.pass）：填密码并点 OK
export async function confirmWpass(page, pw) {
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate((pw) => {
      const boxes = [...document.querySelectorAll('.popbox.pass')]
        .filter((x) => !String(x.className).includes('hide'))
      const box = boxes[0]
      if (!box) return false
      const ipt = box.querySelector('input[type=password]')
      const btn = box.querySelector('.btns button.ok')
      if (!ipt || !btn) return false
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(ipt, pw)
      ipt.dispatchEvent(new Event('input', { bubbles: true }))
      btn.click()
      return true
    }, pw).catch(() => false)
    if (ok) return true
    await sleep(500)
  }
  throw new Error('confirmWpass: no visible wpass dialog')
}
// 扩展页上下文读 chrome.storage.local / sync（键名与源码一致；账户表在 sync）
export const stoLocalGet = (page, key) =>
  page.evaluate(async (key) => {
    const o = await chrome.storage.local.get(key)
    return o[key]
  }, key).catch(() => undefined)
export const stoSyncGet = (page, key) =>
  page.evaluate(async (key) => {
    const o = await chrome.storage.sync.get(key)
    return o[key]
  }, key).catch(() => undefined)
// 主页 ⋮ 菜单点某项（等菜单展开）
export async function menuClick(home, label) {
  await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
  await sleep(450)
  await clickByText(home, label)
  await sleep(300)
}
export async function waitOut(dapp, outId, ms = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const txt = await dapp.evaluate((o) => document.getElementById(o)?.textContent || '', outId)
    if (txt.startsWith('resolve') || txt.startsWith('reject')) return txt
    await sleep(300)
  }
  throw new Error(`waitOut: ${outId} never settled`)
}
export async function openDapp(browser) {
  let dapp = (await browser.pages()).find((p) => p.url().includes('/dapp-sim.html'))
  if (!dapp) {
    dapp = await browser.newPage()
    await dapp.goto(DAPP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
  }
  for (let i = 0; i < 40; i++) {
    const r = await dapp.evaluate(() => (document.getElementById('wallet-state') || {}).textContent || '').catch(() => '')
    if (r.includes('MoneyNex detected')) return dapp
    if (i === 15) await dapp.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(300)
  }
  throw new Error('dapp-sim never detected MoneyNex')
}
export async function closeReqTargets(browser) {
  for (const kind of ['connect', 'transfer', 'signtx', 'signtext', 'raisefee', 'switchchain', 'actionview']) {
    for (const p of (await browser.pages())) {
      if (p.url().startsWith(`${EXT}/popup/${kind}.html`)) await p.close().catch(() => {})
    }
  }
}

// ---- 钱包状态 ----
export async function isOnboarded(browser) {
  const p = await openExtPage(browser, 'moneynex.html')
  await sleep(1200)
  const t = await bodyText(p)
  await p.close().catch(() => {})
  // 已板载：直接见到主页（或解锁框）；未板载：熵收集/创建-导入引导
  return !/move your mouse|create\s+import/i.test(t)
}
// 进程内解锁（mnx-suite unlock 纪律）：可见密码框 → 原生 setter 填入 → Unlock。
// 连续数轮既无密码框也未到主页 → 页面状态陈旧（如板载前冻结的引导屏），强制刷新一次再判。
export async function unlockWallet(browser) {
  let home = await ensureHome(browser)
  for (let i = 0; i < 22; i++) {
    // 残留的 wpass 密码确认框 / wpcfm 确认框（上一 case 失败时可能开着）会伪装成
    // 解锁框或被后续流程误确认：先取消它们
    await home.evaluate(() => {
      const box = [...document.querySelectorAll('.popbox.pass')]
        .find((x) => !String(x.className).includes('hide'))
      box && box.querySelector('.btns button.cancel')?.click()
      const w = document.getElementById('wpcfm')
      if (w && !String(w.className).includes('hide')) {
        const c = [...w.querySelectorAll('button')].find((x) => /(^|\s)cancel(\s|$)/i.test(x.className) || /cancel/i.test(x.innerText || ''))
        c && c.click()
      }
    }).catch(() => {})
    const st = await home.evaluate(() => {
      const vis = (el) => {
        for (let n = el; n; n = n.parentElement) { if (String(n.className).includes('hide')) return false }
        return el.getBoundingClientRect().width > 4
      }
      const pw = [...document.querySelectorAll('input[type=password]')].find(vis)
      if (pw) return { pw: true }
      return { home: !!document.querySelector('h1.btn.adrs-btn')?.getBoundingClientRect().width }
    }).catch(() => ({}))
    if (st.home) return home
    if (st.pw) {
      await fillVisiblePasswords(home, PW)
      await clickByText(home, '^Unlock$', '#init')
      await sleep(1500)
    } else if (i === 5 || i === 12) {
      // 陈旧态兜底：重载（重新读 storage，锁定→解锁框；已解锁→主页）
      await race(home.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }), 18000).catch(() => {})
      await sleep(1500)
      home = await ensureHome(browser)
    } else {
      await sleep(700)
    }
  }
  throw new Error('unlockWallet: never reached home')
}
// 锁定（主页 ⋮ → Lock）
export async function lockWallet(browser) {
  const home = await ensureHome(browser)
  await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
  await sleep(400)
  await clickByText(home, "^Lock wallet$")
  await sleep(1500)
  return home
}
