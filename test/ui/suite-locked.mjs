// test/ui/suite-locked.mjs — 未登录/锁定态矩阵：9 个页面打开时的密码框/引导渲染。
// 每个导出的 case 由 run-all.mjs 依次执行（case 内 fail-fast）。
// 前提：钱包已板载且已解锁（run-al1 先经本套件第一个 case 锁定）。
// 可见性纪律：0.4.x 的 .hide 是位移/透明而非 display:none，密码框必须按
// 「祖先链无 hide」判定，否则会误把隐藏的 wpass 输入框当解锁框（假阳性）。
import {
  sleep, bodyText, shot, assert, lockWallet, ensureHome,
} from './lib.mjs'

// 可见密码框数量（祖先链无 hide）
async function visPasswordCount(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('input[type=password]')].filter((x) => {
      for (let n = x; n; n = n.parentElement) { if (String(n.className).includes('hide')) return false }
      return x.getBoundingClientRect().width > 4
    }).length).catch(() => 0)
}

export const cases = {
  async 'lock from home shows unlock screen'(browser) {
    // 幂等：已处锁定态（上一轮残留）则直接断言解锁屏；未锁定才走 Lock wallet
    let home = await ensureHome(browser)
    await sleep(800)
    if (await visPasswordCount(home) === 0) {
      home = await lockWallet(browser)
      await sleep(600)
    }
    const n = await visPasswordCount(home)
    await shot(home, 'locked-01-unlock-screen')
    assert(n >= 1, 'locked home renders the unlock password box', (await bodyText(home)).slice(0, 160))
  },
  async 'moneynex page renders unlock form'(browser) {
    const p = await ensureHome(browser)
    await sleep(800)
    const n = await visPasswordCount(p)
    await shot(p, 'locked-02-moneynex')
    assert(n >= 1, 'moneynex.html shows the unlock box when locked')
    await p.close().catch(() => {})
  },
  async 'request pages route to unlock when locked'(browser) {
    for (const pg of ['connect', 'transfer', 'signtx', 'signtext', 'raisefee', 'switchchain', 'connectedsites', 'actionview']) {
      const p = await browser.newPage()
      await p.setViewport({ width: 400, height: 600 })
      await p.goto(`chrome-extension://${(await import('./lib.mjs')).MNX_ID}/popup/${pg}.html`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await sleep(1100)
      const n = await visPasswordCount(p)
      await shot(p, `locked-03-${pg}`)
      assert(n >= 1, `${pg}.html routes to unlock when locked`, (await bodyText(p)).slice(0, 120))
      await p.close().catch(() => {})
    }
  },
  async 'locked home has content (no crash)'(browser) {
    const home = await ensureHome(browser)
    const t = await bodyText(home)
    assert(t.length > 0, 'home has content in locked state', t.slice(0, 100))
    await sleep(200)
  },
}
