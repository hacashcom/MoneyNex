// test/ui/suite-errors.mjs — 错误态：错密码、signtext 拒签 32B hash / 过短、
// raisefee 池外 hash、actionview 缺 key、未授权 wallet 的 need_connect。
// 注意：transfer/signtx 缺参路径走原生 alert()（阻塞），不在自动化覆盖内（README 已注明）。
import {
  sleep, bodyText, shot, assert, clickBtn, clickByText, fillVisiblePasswords,
  waitReqWin, waitNoWin, waitOut, openDapp, ensureHome, lockWallet, unlockWallet,
  confirmWpcfm, openExtPage, ensureDappConnected, PW, EXT,
} from './lib.mjs'

export const cases = {
  async 'wrong password shows error and stays locked'(browser) {
    await lockWallet(browser)
    const home = await ensureHome(browser)
    await sleep(800)
    await fillVisiblePasswords(home, 'WrongPassword99')
    await clickByText(home, '^Unlock$', '#init')
    await sleep(1200)
    const t = await bodyText(home)
    await shot(home, 'errors-01-wrongpw')
    assert(/error/i.test(t), 'wrong password shows an error', t.slice(0, 200))
    // 正确密码解锁恢复
    await fillVisiblePasswords(home, PW)
    await clickByText(home, '^Unlock$', '#init')
    await sleep(1800)
    const t2 = await bodyText(home)
    assert(/1MzNY1oA3/.test(t2), 'correct password unlocks to home', t2.slice(0, 200))
  },
  async 'signtext refuses a raw 32-byte hash'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    await dapp.evaluate(() => document.getElementById('b-signtext-hash').click())
    const out = await waitOut(dapp, 'out-signtext', 20000)
    const result = JSON.parse(out.replace(/^reject:\n?/, ''))
    assert(/reject/.test(out) && result.ret === 1 && result.code === 'sign_refused' && /raw 32-byte hash/i.test(result.err),
      'dapp got the refusal reply', out.slice(0, 200))
    await shot(dapp, 'errors-02-signtexthash')
    await waitNoWin(browser, 'signtext')
  },
  async 'signtext refuses too-short text'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    await dapp.evaluate(() => document.getElementById('b-signtext-short').click())
    const out = await waitOut(dapp, 'out-signtext', 20000)
    const result = JSON.parse(out.replace(/^reject:\n?/, ''))
    assert(/reject/.test(out) && result.ret === 1 && result.code === 'sign_refused' && /between 8 and 4096/i.test(result.err),
      'short text refused with the exact length rule', out.slice(0, 300))
    await shot(dapp, 'errors-03-signtextshort')
    await waitNoWin(browser, 'signtext')
  },
  async 'raisefee with a pool-unknown hash fails visibly'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    await dapp.evaluate(() => {
      const el = document.getElementById('i-rf-hash')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, 'e2700db4558ef1e1b540fd53f5e7a0fa7b9d096947f9dc20d07bd507969987b9')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await dapp.evaluate(() => document.getElementById('b-raisefee').click())
    const rw = await waitReqWin(browser, 'raisefee')
    await sleep(1000)
    await clickBtn(rw, 'blue')      // cfim 确认
    await confirmWpcfm(rw)          // 不可逆确认
    await sleep(2500)
    const out = await waitOut(dapp, 'out-raisefee', 25000)
    const result = JSON.parse(out.replace(/^reject:\n?/, ''))
    assert(/reject/.test(out) && result.ret === 1 && result.code === 'sign_refused' && /not find.*tx pool/i.test(result.err),
      'dapp displays the exact unknown-pool error', out.slice(0, 300))
    await shot(dapp, 'errors-04-raisefee-unknown')
    await waitNoWin(browser, 'raisefee', 10000)
  },
  async 'actionview without key shows the error state'(browser) {
    const av = await openExtPage(browser, 'actionview.html')
    await sleep(1500)
    const t = await bodyText(av)
    await shot(av, 'errors-05-actionview-nokey')
    assert(/no review key|error|not found/i.test(t), 'missing key rendered the error', t.slice(0, 200))
    await av.close().catch(() => {})
  },
  async 'wallet() before connect replies need_connect'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
    await sleep(300)
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-wallet').click())
    // 未授权：先收到 need_connect 拒绝，同时 background 弹出 connect 窗（P3-2）
    const out = await waitOut(dapp, 'out-wallet', 20000)
    assert(/reject/.test(out) && /need connect|need_connect/i.test(out),
      'unauthorized wallet() rejected with need_connect', out.slice(0, 240))
    const cw = (await browser.pages()).find((x) => x.url().startsWith(`${EXT}/popup/connect.html`))
    if (cw) {
      await sleep(500)
      await shot(cw, 'errors-06-needconnect-window')
      await clickBtn(cw, 'blue').catch(() => {})
      await waitNoWin(browser, 'connect', 8000).catch(() => cw.close().catch(() => {}))
    }
    const d2 = await openDapp(browser)
    await d2.evaluate(() => document.getElementById('b-wallet').click())
    const out2 = await waitOut(d2, 'out-wallet', 15000)
    assert(/resolve/.test(out2), 'wallet() works again after connect approval', out2.slice(0, 160))
  },
}
