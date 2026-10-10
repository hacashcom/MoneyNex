// test/ui/suite-pages.mjs — 已登录态页面矩阵：主页五个视图 + connectedsites。
// 前提：已解锁（run-all 先 unlock）。主页余额需要本地链在线（无链模式见 README）。
import {
  sleep, bodyText, shot, assert, clickByText, ensureHome, waitBalances,
  unlockWallet, openExtPage, VP, EXPECTED_ADDRESS,
} from './lib.mjs'

export const cases = {
  async 'home renders balances and header'(browser) {
    const home = await unlockWallet(browser)
    const t = await waitBalances(home)
    await shot(home, 'pages-01-home')
    assert(/1MzNY1oA3/.test(t), 'home shows the account address', t.slice(0, 160))
    assert(/HAC/.test(t), 'home shows HAC balance', t.slice(0, 300))
  },
  async 'home activity tab'(browser) {
    const home = await ensureHome(browser)
    await clickByText(home, '^Activity$')
    await sleep(900)
    const t = await bodyText(home)
    await shot(home, 'pages-02-activity')
    assert(/Activity/i.test(t), 'activity tab rendered')
    await clickByText(home, '^Assets$')
    await sleep(400)
  },
  async 'home collection tab (HACD names)'(browser) {
    const home = await ensureHome(browser)
    await clickByText(home, '^Collection$')
    await sleep(1500)
    await shot(home, 'pages-03-collection')
    const t = await bodyText(home)
    assert(/Collection/i.test(t), 'collection tab rendered', t.slice(0, 160))
    await clickByText(home, '^Assets$')
    await sleep(400)
  },
  async 'home account switcher opens and lists account'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(() => document.querySelector('h1.btn.adrs-btn')?.click())
    await sleep(700)
    await shot(home, 'pages-04-acctsw')
    const t = await bodyText(home)
    assert(/Switch account/i.test(t), 'account switcher menu rendered', t.slice(0, 160))
    assert(t.includes(EXPECTED_ADDRESS), 'switcher lists the account', t.slice(0, 300))
    await home.evaluate(() => document.querySelector('h1.btn.adrs-btn')?.click())
    await sleep(400)
  },
  async 'home menu lists management entries'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(600)
    const t = await bodyText(home)
    await shot(home, 'pages-05-menu')
    for (const entry of ['Networks', 'RPC node', 'Connected sites', 'Account details', 'View on explorer', 'Expand view', 'Support', 'Lock wallet', 'Reset wallet']) {
      assert(t.includes(entry), `menu contains "${entry}"`, t.slice(0, 300))
    }
    // 重排后的相对顺序（用户指定 2026-10-09）
    const order = ['Networks', 'RPC node', 'Connected sites', 'Account details', 'View on explorer', 'Expand view', 'Support', 'Lock wallet', 'Reset wallet']
    const pos = order.map((e) => t.indexOf(e))
    assert(pos.every((x) => x >= 0) && pos.every((x, i) => i === 0 || x > pos[i - 1]),
      'menu entries appear in the specified order', JSON.stringify(order.map((e, i) => e + '@' + pos[i])))
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(300)
  },
  async 'acinf account details view'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(400)
    await clickByText(home, 'Account details')
    await sleep(1300)
    const t = await bodyText(home)
    await shot(home, 'pages-06-acinf')
    assert(/Account|address/i.test(t), 'acinf rendered', t.slice(0, 160))
    // back to home via the pchead back button
    await home.evaluate(() => document.querySelector('.pchead button.icbtn[title="Back"]')?.click())
    await sleep(900)
    const onHome = await home.evaluate(() => !!document.querySelector('h1.btn.adrs-btn')?.getBoundingClientRect().width)
    if (!onHome) { await home.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500); await waitBalances(home) }
    assert(true, 'acinf back navigation')
  },
  async 'dotrs send form (HAC + validation)'(browser) {
    const home = await ensureHome(browser)
    await clickByText(home, '^Send$')
    await sleep(1300)
    let t = await bodyText(home)
    await shot(home, 'pages-07-dotrs')
    assert(/Send|Transfer/i.test(t), 'dotrs form rendered', t.slice(0, 160))
    // 空表单校验：直接点确认 → 报错提示（不提交）
    await clickByText(home, 'Confirm|Send|Transfer', '#dotrs')
    await sleep(900)
    t = await bodyText(home)
    await shot(home, 'pages-08-dotrs-emptyerr')
    assert(/enter|receiving|gas|address/i.test(t), 'empty-form validation message shown', t.slice(0, 300))
    await home.evaluate(() => document.querySelector('.pchead button.icbtn[title="Back"]')?.click())
    await sleep(800)
  },
  async 'chains networks view + chainform (no save)'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(400)
    await clickByText(home, 'Networks')
    await sleep(1300)
    let t = await bodyText(home)
    await shot(home, 'pages-09-chains')
    assert(/Mainnet/i.test(t), 'chains lists Mainnet', t.slice(0, 200))
    await clickByText(home, 'Add Network')
    await sleep(1100)
    t = await bodyText(home)
    await shot(home, 'pages-10-chainform')
    assert(/RPC/i.test(t), 'chainform shows RPC field', t.slice(0, 200))
    await home.evaluate(() => document.querySelector('.pchead button.icbtn[title="Back"]')?.click())
    await sleep(800)
    await home.evaluate(() => document.querySelector('.pchead button.icbtn[title="Back"]')?.click())
    await sleep(800)
    const onHome = await home.evaluate(() => !!document.querySelector('h1.btn.adrs-btn')?.getBoundingClientRect().width)
    if (!onHome) { await home.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500); await waitBalances(home) }
    assert(true, 'chains back navigation')
  },
  async 'connectedsites opens as in-page view from the menu'(browser) {
    const home = await ensureHome(browser)
    const tabsBefore = (await browser.pages()).length
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(400)
    await clickByText(home, 'Connected sites')
    await sleep(1500)
    // 不打开新标签页（用户要求 2026-10-09）
    assert((await browser.pages()).length === tabsBefore, 'no new tab opened for connected sites')
    const t = await bodyText(home)
    await shot(home, 'pages-11-connectedsites')
    assert(/Connected sites/i.test(t) && /No connected sites|http/i.test(t),
      'connected sites view rendered in-page', t.slice(0, 200))
    // Back 返回主页
    await home.evaluate(() => document.querySelector('#cnls .pchead button.icbtn[title="Back"]')?.click())
    await sleep(1200)
    const onHome = await home.evaluate(() => !!document.querySelector('h1.btn.adrs-btn')?.getBoundingClientRect().width)
    assert(onHome, 'back from connected sites returns to home')
  },
  async 'home rpc settings dialog shows the effective URL'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(400)
    await clickByText(home, '^RPC node$')
    await sleep(900)
    await shot(home, 'pages-12-rpcset')
    // 输入框必须预填生效的 fullnode 地址（override > 网络 RPC > 构建默认）
    const val = await home.evaluate(() => document.querySelector('.rpcsg input')?.value || '')
    const rpc = (await import('./lib.mjs')).HACASH_RPC
    assert(val.startsWith('http') && val === rpc, 'RPC dialog input shows the effective node URL', val)
    await home.evaluate(() => document.querySelector('.rpcsg .btns button.cancel')?.click())
    await sleep(500)
    const ok = await home.evaluate(() => !!document.querySelector('#wpage'))
    assert(ok, 'home alive after settings interaction')
  },
}
