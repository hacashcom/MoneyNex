// test/ui/suite-floatbar.mjs — 需求 B（修订）：钱包内「Connected」指示条。
// 页面注入浮层已移除（content/sitesync.js 只保留注册 + SDK 事件投递）；指示条
// 由钱包页面渲染，跟随当前活跃标签（MetaMask 模式）：
//   1 未连接 → 无指示条（dapp origin 与 localhost 变体）
//   2 连接批准 → 指示条免刷新出现（绿点/Connected/host/两图标/视口底部）
//   3 切换标签 → 指示条实时隐藏/复现（未连接 localhost ↔ 已连接 dapp 往返）
//   4 导航离开（about:blank）→ 指示条消失；导航回来 → 重注册后复现
//   5 iframe 嵌入 → 指示条显示顶层 frame 域名（iframe 注册被后台忽略）
//   6 链接图标 → 钱包内已连接网站管理视图（hpgw cnls）
//   7 退出 → 指示条消失 + 页面收到 MoneyNex.on disconnect 与 MoneyNexDisconnect
//     （{origin}）+ connect_sites 清空
//   8 断开后同源 API → need_connect；再批准 → 指示条免刷新复现
//   9 管理视图逐站断开（stoRemoveConnectSite 直写 storage）→ 同一差分通知页面
//     （双通道 {origin}）——与 connbar 退出殊途同归
//   10 撤销广播到同 origin 的每个 tab：两个 tab 都收到双通道事件
// 前提：已解锁；dapp http 服务在线（provision）。
// 标签切换用 lib.mjs activateTab（CDP Target.activateTarget 真激活）。
import {
  sleep, shot, assert, ensureHome, openDapp, waitReqWin, waitNoWin, waitOut,
  clickBtn, closeReqTargets, DAPP_URL, activateTab, openHomeWindow, EXT,
  clickByText, confirmWpcfm,
} from './lib.mjs'

const ORIGIN = new URL(DAPP_URL).origin
const HOST = new URL(DAPP_URL).host
const FRAME_HOST_URL = DAPP_URL.replace(/dapp-sim\.html$/, 'frame-host.html')

// —— 钱包侧指示条状态（home 页常规 DOM，无 shadow root）——
async function barState(home) {
  return await home.evaluate(() => {
    const b = document.querySelector('.connbar')
    if (!b) return null
    const tt = b.querySelector('.tt')
    , host = b.querySelector('.host')
    , btns = b.querySelectorAll('button.icbtn')
    const r = b.getBoundingClientRect()
    return {
      conn: tt ? tt.textContent : null,
      host: host ? host.textContent : null,
      btns: btns.length,
      h: r.height,
      // 底部判定用 clientHeight（排除横向滚动条占位；fixed 元素的包含块是布局视口）
      atBottom: Math.abs(document.documentElement.clientHeight - (r.y + r.height)) < 2,
    }
  })
}

// 轮询至期望的「有/无指示条」稳定成立；want=true 返回状态对象，false 返回 null
async function pollBar(home, want, ms = 12000) {
  const t0 = Date.now()
  let st = null
  while (Date.now() - t0 < ms) {
    st = await barState(home)
    if (want ? !!st : !st) return st
    await sleep(400)
  }
  return want ? null : null
}

// 清空授权（storage 直写；顺带触发 revoked 推送）
async function revokeAll(browser) {
  const home = await getHome(browser)
  await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
  await sleep(400)
}

// 授权流：dapp connect → 批准窗口 Confirm
async function connectDapp(browser, dapp) {
  await closeReqTargets(browser)
  await dapp.evaluate(() => document.getElementById('b-connect').click())
  const cw = await waitReqWin(browser, 'connect')
  await sleep(800)
  await clickBtn(cw, 'blue')
  await waitOut(dapp, 'out-connect', 20000).catch(() => {})
  await waitNoWin(browser, 'connect', 15000)
}

// 事件输出区（dapp-sim 自动订阅 disconnect，双通道记录）
const eventsText = (dapp) => dapp.evaluate(() => document.getElementById('out-events').textContent)

// 每例都用全新 127.0.0.1 dapp 页：openDapp 按 url 含 '/dapp-sim.html' 找**任意**现成页，
// 上一次运行遗留的 localhost 变体页会被误认领，connect 授权就会落到错误 origin
// （实测踩过：bar 显示 localhost 且 connected）。先清场再开新页。
async function freshDapp(browser) {
  for (const p of await browser.pages()) {
    if ((p.url() || '').includes('/dapp-sim.html')) await p.close().catch(() => {})
  }
  return await openDapp(browser)
}

// 钱包主页 = 本套件专属的独立窗口（真实侧边栏的等价物：钱包常驻可见，标签在
// 主窗口里切换；单窗口下钱包标签一旦退为后台标签，布局/截图就不可靠——实测
// shot() 会挂起）。缓存复用；其它 moneynex 页先清场（多份 connbar 监听者会让
// 断言对象失真）。所有用例必须用 getHome 而非 ensureHome。
let HOMEWIN = null
async function getHome(browser) {
  if (HOMEWIN) {
    const alive = await HOMEWIN.evaluate(() => 1).then(() => true).catch(() => false)
    if (alive) return HOMEWIN
    HOMEWIN = null
  }
  for (const p of await browser.pages()) {
    if ((p.url() || '').startsWith(`${EXT}/popup/moneynex.html`)) await p.close().catch(() => {})
  }
  HOMEWIN = await openHomeWindow(browser)
  return HOMEWIN
}

export const cases = {

  async 'not connected → no indicator bar for either origin'(browser) {
    await revokeAll(browser)
    await closeReqTargets(browser)
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    const loc = await browser.newPage()
    await loc.goto(DAPP_URL.replace('127.0.0.1', 'localhost'), { waitUntil: 'domcontentloaded', timeout: 20000 })
    await sleep(1500)
    await activateTab(browser, dapp)
    await pollBar(home, false)
    assert((await barState(home)) === null, 'no indicator bar while the dapp origin is revoked')
    await activateTab(browser, loc)
    await pollBar(home, false)
    assert((await barState(home)) === null, 'no indicator bar on the never-connected localhost origin')
    await shot(home, 'connbar-01-not-connected')
    await loc.close()
  },

  async 'connect approve → indicator bar shows the active tab host'(browser) {
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    await activateTab(browser, dapp)
    assert((await barState(home)) === null, 'still no bar before connecting')
    await connectDapp(browser, dapp)
    // 批准写入 connect_sites → 钱包页 storage.onChanged → 重查 → 免刷新出现
    const st = await pollBar(home, true)
    assert(st, 'indicator bar appears without a reload after approval')
    assert(st.conn === 'Connected', '"Connected" label rendered', String(st.conn))
    assert(st.host === HOST, 'bar host follows the active tab', String(st.host) + ' vs ' + HOST)
    assert(st.btns === 2, 'two buttons (link + disconnect)', String(st.btns))
    // 底部钉住：钱包页此刻是后台标签（dapp 标签才活跃），背景页不做布局，rect 不可信；
    // 用计算样式钉住 fixed+bottom:0（视觉证据见截图）
    const pin = await home.evaluate(() => {
      const b = document.querySelector('.connbar')
      if (!b) return null
      const cs = getComputedStyle(b)
      return { position: cs.position, bottom: cs.bottom }
    })
    assert(pin && pin.position === 'fixed' && pin.bottom === '0px',
      'bar is fixed to the viewport bottom', JSON.stringify(pin))
    await shot(home, 'connbar-02-mounted')
  },

  async 'tab switching updates the bar in real time'(browser) {
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    const loc = await browser.newPage()
    await loc.goto(DAPP_URL.replace('127.0.0.1', 'localhost'), { waitUntil: 'domcontentloaded', timeout: 20000 })
    await sleep(1200)
    await activateTab(browser, loc)
    await pollBar(home, false)
    assert((await barState(home)) === null, 'bar hides when switching to an unconnected tab')
    await activateTab(browser, dapp)
    let st = await pollBar(home, true)
    assert(st && st.host === HOST, 'bar re-shows with the dapp host when switching back', st && String(st.host))
    await activateTab(browser, loc)
    await pollBar(home, false)
    assert((await barState(home)) === null, 'bar hides again on the second switch to localhost')
    await activateTab(browser, dapp)
    st = await pollBar(home, true)
    assert(st && st.host === HOST, 'bar re-shows on the final switch back', st && String(st.host))
  },

  async 'navigation away drops the bar; navigating back restores it'(browser) {
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    await activateTab(browser, dapp)
    assert(await pollBar(home, true), 'bar present before navigation')
    // 导航开始时钱包页 invalidate 该 tab 的旧注册 → 指示条立即消失；
    // about:blank 无内容脚本 → 不注册 → 保持无指示条
    await dapp.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await pollBar(home, false)
    assert((await barState(home)) === null, 'bar drops while on a non-registering page')
    await dapp.goto(DAPP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    for (let i = 0; i < 40; i++) {
      const r = await dapp.evaluate(() => (document.getElementById('wallet-state') || {}).textContent || '').catch(() => '')
      if (r.includes('MoneyNex detected')) break
      await sleep(300)
    }
    const st = await pollBar(home, true)
    assert(st && st.host === HOST, 'bar restored after navigating back (re-registration)', st && String(st.host))
  },

  async 'iframe embed: bar names the top-frame host'(browser) {
    const home = await getHome(browser)
    const fh = await browser.newPage()
    await fh.setViewport({ width: 900, height: 700 })
    await fh.goto(FRAME_HOST_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await sleep(1500)
    await activateTab(browser, fh)
    const st = await pollBar(home, true)
    assert(st && st.host === HOST,
      'bar shows the top frame origin (iframe registrations are ignored by the background)', st && String(st.host))
    await shot(fh, 'connbar-05-frame-host-page')
    await fh.close()
  },

  async 'link icon opens the in-wallet connected-sites view'(browser) {
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    await activateTab(browser, dapp)
    assert(await pollBar(home, true), 'bar present before opening management')
    await home.evaluate(() => document.querySelector('.connbar .icbtn').click())
    // hpgw 推入 cnls 视图（home 仅被 .hide 隐藏，app 保持挂载）
    let ok = false
    for (let i = 0; i < 20 && !ok; i++) {
      await sleep(400)
      ok = await home.evaluate((origin) => {
        const v = document.getElementById('cnls')
        return !!(v && v.classList.contains('active') && v.textContent.includes(origin))
      }, ORIGIN).catch(() => false)
    }
    assert(ok, 'in-page connected-sites view lists the origin')
    await shot(home, 'connbar-06-connected-sites-view')
    // 返回主页（pophpgw），恢复基线视图
    await home.evaluate(() => {
      const back = document.querySelector('#cnls .pchead .icbtn')
      back && back.click()
    })
    await sleep(900)
    const st = await pollBar(home, true)
    assert(st && st.host === HOST, 'bar still follows the active tab after returning home', st && String(st.host))
  },

  async 'exit revokes: bar gone, page notified, grant cleared'(browser) {
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    await activateTab(browser, dapp)
    let st = await pollBar(home, true)
    if (!st) { await connectDapp(browser, dapp); st = await pollBar(home, true) }
    assert(st, 'bar present before exit')
    // 订阅线：dapp-sim 载入即自动订阅，双通道证据落在 #out-events
    await dapp.evaluate(() => { document.getElementById('b-events-sub').click() })
    await sleep(300)
    await home.evaluate(() => document.querySelector('.connbar .icbtn.dis').click())
    await pollBar(home, false)
    assert((await barState(home)) === null, 'indicator bar removed after exit')
    const ev = await eventsText(dapp)
    assert(ev.includes('MoneyNex.on disconnect: {"origin":"' + ORIGIN + '"}'),
      'MoneyNex.on(disconnect) fired with {origin}', ev.slice(0, 300))
    assert(ev.includes('MoneyNexDisconnect: {"origin":"' + ORIGIN + '"}'),
      'window MoneyNexDisconnect CustomEvent fired with {origin}', ev.slice(0, 300))
    const sites = await home.evaluate(async () => (await chrome.storage.local.get('connect_sites'))['connect_sites'] || {})
    assert(!sites[ORIGIN], 'connect_sites no longer holds the origin', JSON.stringify(sites))
    await shot(home, 'connbar-07-after-exit')
  },

  async 'after disconnect, need_connect; re-approval restores the bar'(browser) {
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    await activateTab(browser, dapp)
    assert((await barState(home)) === null, 'no bar while disconnected')
    await closeReqTargets(browser)
    await dapp.evaluate(() => document.getElementById('b-wallet').click())
    const out = await waitOut(dapp, 'out-wallet', 20000)
    // 后台在 need_connect 的同时重开 connect 授权窗：批准它收尾——连接态恢复
    // （下游套件依赖基线连接态），顺带钉住「断开 → 重连 → 指示条免刷新回归」
    const cw = await waitReqWin(browser, 'connect').catch(() => null)
    assert(cw, 'wallet() reopened the connect approval window')
    if (cw) {
      await shot(cw, 'connbar-08-reconnect-window')
      await sleep(500)
      await clickBtn(cw, 'blue')
      // need_connect 重开的授权窗回复的是已 reject 的原 did——dapp 侧不一定再有
      // out-connect 输出（suite-dappchain 同样容忍）；重连的硬证据是 grant 落库 + 指示条复现
      const cout = await waitOut(dapp, 'out-connect', 20000).catch(() => '')
      await waitNoWin(browser, 'connect', 15000)
      assert(!cout || /resolve/.test(cout), 're-connect reply (when routable) resolves', cout.slice(0, 240))
    }
    assert(/reject/.test(out) && /need connect first/.test(out) && /need_connect/.test(out),
      'wallet() rejected with need_connect after disconnect', out.slice(0, 240))
    const st = await pollBar(home, true)
    assert(st && st.host === HOST, 'bar returns after re-approval (storage watcher)', st && String(st.host))
    const sites = await home.evaluate(async () => (await chrome.storage.local.get('connect_sites'))['connect_sites'] || {})
    assert(!!sites[ORIGIN], 'grant restored after re-approval', JSON.stringify(sites))
  },

  async 'management-view disconnect notifies the page like the connbar exit'(browser) {
    const home = await getHome(browser)
    const dapp = await freshDapp(browser)
    await activateTab(browser, dapp)
    let st = await pollBar(home, true)
    if (!st) { await connectDapp(browser, dapp); st = await pollBar(home, true) }
    assert(st, 'bar present before management disconnect')
    await dapp.evaluate(() => { document.getElementById('b-events-sub').click() })
    await sleep(300)
    // 钱包内 cnls 管理视图（connlists 组件）逐站断开：走 stoRemoveConnectSite
    // 直写 connect_sites —— 页面通知靠同一份 storage.onChanged 差分，而非任何
    // 断开入口自行推送；这条用例钉住「入口再多，通知路径唯一」
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(450)
    await clickByText(home, 'Connected sites')
    await sleep(1500)
    await home.evaluate(() => {
      const b = [...document.querySelectorAll('#cnls button')].find((x) => /disconnect/i.test(x.innerText || ''))
      b && b.click()
    })
    await sleep(500)
    await confirmWpcfm(home)
    await sleep(1200)
    const ev = await eventsText(dapp)
    assert(ev.includes('MoneyNex.on disconnect: {"origin":"' + ORIGIN + '"}'),
      'management disconnect fires MoneyNex.on(disconnect) with {origin}', ev.slice(0, 300))
    assert(ev.includes('MoneyNexDisconnect: {"origin":"' + ORIGIN + '"}'),
      'management disconnect fires the MoneyNexDisconnect CustomEvent', ev.slice(0, 300))
    const sites = await home.evaluate(async () => (await chrome.storage.local.get('connect_sites'))['connect_sites'] || {})
    assert(!sites[ORIGIN], 'grant cleared by the management view', JSON.stringify(sites))
    await shot(home, 'connbar-09-management-disconnect')
    // 回到主页视图（下个用例从干净基线开始）
    await home.evaluate(() => document.querySelector('#cnls .pchead button.icbtn[title="Back"]')?.click())
    await sleep(900)
  },

  async 'revoke notifies every tab of the same origin'(browser) {
    const home = await getHome(browser)
    const dappA = await freshDapp(browser)
    await activateTab(browser, dappA)
    let st = await pollBar(home, true)
    if (!st) { await connectDapp(browser, dappA); st = await pollBar(home, true) }
    assert(st, 'bar present before the multi-tab revoke')
    // 同 origin 第二个 tab：授权是 per-origin 的，两个 tab 都在撤销射程内
    const dappB = await browser.newPage()
    await dappB.setViewport({ width: 900, height: 700 })
    await dappB.goto(DAPP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await sleep(1500) // 等内容脚本注册进 tab 表
    await dappA.evaluate(() => { document.getElementById('b-events-sub').click() })
    await dappB.evaluate(() => { document.getElementById('b-events-sub').click() })
    await sleep(300)
    await home.evaluate(() => document.querySelector('.connbar .icbtn.dis').click())
    await pollBar(home, false)
    for (const [tag, p] of [['A', dappA], ['B', dappB]]) {
      const ev = await eventsText(p)
      assert(ev.includes('MoneyNexDisconnect: {"origin":"' + ORIGIN + '"}'),
        `tab ${tag} received the MoneyNexDisconnect CustomEvent`, ev.slice(0, 200))
      assert(ev.includes('MoneyNex.on disconnect: {"origin":"' + ORIGIN + '"}'),
        `tab ${tag} received MoneyNex.on(disconnect)`, ev.slice(0, 200))
    }
    await dappB.close().catch(() => {})
    // 收尾恢复基线连接态（下游套件依赖）
    await connectDapp(browser, dappA)
    const st2 = await pollBar(home, true)
    assert(st2, 'baseline re-connected after the multi-tab case')
  },
}
