// test/ui/suite-dapp.mjs — dApp 触发流：本地 dapp-sim.html 经 content script 触发
// 请求弹窗（background 的 A2 通知窗）。覆盖 connect 授权、各请求窗渲染与取消、
// transfer 全批（本地链提交）、actionview 内容渲染。
// 前提：已解锁；本地链在线（transfer-approve 与 signtx 有效体依赖链；无链模式见 README）。
import {
  sleep, bodyText, shot, assert, clickBtn, waitReqWin, waitNoWin, waitOut,
  openDapp, ensureHome, closeReqTargets, confirmWpcfm, EXPECTED_ADDRESS,
  HACASH_RPC, EXT, VP, VP_WIDE,
} from './lib.mjs'

export const cases = {
  async 'connect approval window: approve grants origin'(browser) {
    const home = await ensureHome(browser)
    // 确定性：清掉既有授权（必须在扩展页上下文里清）
    await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
    await sleep(300)
    await closeReqTargets(browser)
    const dapp = await openDapp(browser)
    await dapp.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(1000)
    const d = await openDapp(browser)

    await d.evaluate(() => document.getElementById('b-connect').click())
    const cw = await waitReqWin(browser, 'connect')
    await sleep(600)
    const t = await bodyText(cw)
    await shot(cw, 'dapp-01-connect')
    assert(/Connect/i.test(t), 'connect window rendered', t.slice(0, 160))
    assert(t.includes(EXPECTED_ADDRESS), 'connect window shows the account', t.slice(0, 300))
    await clickBtn(cw, 'blue')
    const out = await waitOut(d, 'out-connect', 20000)
    await waitNoWin(browser, 'connect')
    assert(/resolve/.test(out) && new RegExp(`address[":\\s]+${EXPECTED_ADDRESS}`).test(out),
      'connect resolved with the account address', out.slice(0, 200))
  },
  async 'transfer window: review + cancel replies user_canceled'(browser) {
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-transfer').click())
    const tw = await waitReqWin(browser, 'transfer')
    await sleep(1200)
    const t = await bodyText(tw)
    await shot(tw, 'dapp-02-transfer')
    assert(/Transfer/i.test(t), 'transfer window rendered', t.slice(0, 160))
    assert(/0\.001/.test(t), 'transfer review shows the amount', t.slice(0, 400))
    await clickBtn(tw, 'cancel')
    const out = await waitOut(dapp, 'out-transfer', 20000)
    await waitNoWin(browser, 'transfer')
    assert(/reject/.test(out) && /user_canceled|canceled/i.test(out),
      'transfer cancel replied user_canceled', out.slice(0, 200))
  },
  async 'pghead menus: account switcher + network burger open on request pages'(browser) {
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-transfer').click())
    const tw = await waitReqWin(browser, 'transfer')
    await sleep(1000)
    // account chip → menu with existing accounts only
    await tw.evaluate(() => document.querySelector('h1.btn.adrs-btn')?.click())
    await sleep(700)
    let t = await bodyText(tw)
    await shot(tw, 'dapp-pghead-acctmenu')
    assert(/Switch account:/i.test(t), 'pghead account menu opens', t.slice(0, 200))
    assert(t.includes(EXPECTED_ADDRESS), 'pghead menu lists the existing account', t.slice(0, 300))
    await tw.evaluate(() => document.querySelector('.popmenu.acctmenu')?.click())
    await sleep(400)
    // network burger → menu with existing networks only
    await tw.evaluate(() => document.querySelector('button.icbtn.mnburger')?.click())
    await sleep(900)
    t = await bodyText(tw)
    await shot(tw, 'dapp-pghead-netsmenu')
    assert(/Switch network/i.test(t), 'pghead network menu opens', t.slice(0, 200))
    assert(/Mainnet/i.test(t), 'pghead network menu lists Mainnet', t.slice(0, 300))
    await tw.evaluate(() => document.querySelector('.popmenu.netsmenu')?.click())
    await sleep(300)
    await clickBtn(tw, 'cancel')
    await waitNoWin(browser, 'transfer')
  },
  async 'signtx window with a valid body: review + cancel'(browser) {
    const dapp = await openDapp(browser)
    // 经 transfer 页管线构造真实可签名体（dapp-sim 默认样例是非法校验向量）
    await dapp.evaluate(() => document.getElementById('b-transfer').click())
    const twp = await waitReqWin(browser, 'transfer')
    const built = await twp.evaluate(async (main) => {
      const actions = mnx_map_txobj_actions([{ kind: 1, to: main, amount: '0.001' }])
      const b = await sdk_tx_build({
        tx_type: 2, main, fee: '0.001', timestamp: Math.floor(Date.now() / 1000), gas_max: 0, actions,
      })
      const ctx = await mnx_chain_context()
      const review = await sdk_tx_inspect(b.body, main, {
        current_height: ctx.current_height, expected_chain_id: ctx.expected_chain_id,
      })
      await chrome_storage_session.set({ actv_ui: {
        body: b.body,
        review: mnx_sdk_review_clean(review),
        msgparse: (mnx_msglayout_state && mnx_msglayout_state.extra) || null,
      } })
      return b.body
    }, EXPECTED_ADDRESS).catch((e) => 'ERR:' + e.message)
    assert(/^([0-9a-f]{2})+$/.test(built), 'real tx body built+inspected via the page pipeline', built)
    await clickBtn(twp, 'cancel')
    await waitNoWin(browser, 'transfer')

    await dapp.evaluate((body) => {
      const el = document.getElementById('i-stx-body')
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(el, body)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('b-signtx').click()
    }, built)
    const sw = await waitReqWin(browser, 'signtx')
    await sleep(1400)
    const t = await bodyText(sw)
    await shot(sw, 'dapp-03-signtx')
    assert(/Sign Transaction/i.test(t), 'signtx window rendered', t.slice(0, 160))
    assert(/Transfer/i.test(t) && /0\.001/.test(t), 'signtx review lists the transfer action', t.slice(0, 400))
    await clickBtn(sw, 'cancel')
    const out = await waitOut(dapp, 'out-signtx', 20000)
    await waitNoWin(browser, 'signtx')
    assert(/reject/.test(out) && /canceled/i.test(out), 'signtx cancel replied', out.slice(0, 200))
  },
  async 'actionview renders the stored review'(browser) {
    const av = await browser.newPage()
    await av.setViewport(VP_WIDE)
    await av.goto(`${EXT}/popup/actionview.html?key=actv_ui`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(2000)
    const t = await bodyText(av)
    await shot(av, 'dapp-04-actionview', VP_WIDE)
    assert(/Action/i.test(t) && t.length > 120, 'actionview rendered real review content', t.slice(0, 160))
    await av.close().catch(() => {})
  },
  async 'signtext window: review + cancel'(browser) {
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-signtext').click())
    const sw = await waitReqWin(browser, 'signtext')
    await sleep(1000)
    const t = await bodyText(sw)
    await shot(sw, 'dapp-05-signtext')
    assert(/Sign Text/i.test(t), 'signtext window rendered', t.slice(0, 160))
    assert(/Login to dapp-sim/.test(t), 'signtext shows the message text', t.slice(0, 300))
    await clickBtn(sw, 'cancel')
    const out = await waitOut(dapp, 'out-signtext', 20000)
    await waitNoWin(browser, 'signtext')
    assert(/reject/.test(out) && /canceled/i.test(out), 'signtext cancel replied', out.slice(0, 200))
  },
  async 'raisefee window: form + cancel'(browser) {
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-raisefee').click())
    const rw = await waitReqWin(browser, 'raisefee')
    await sleep(1000)
    const t = await bodyText(rw)
    await shot(rw, 'dapp-06-raisefee')
    assert(/Increase Tx Fee|fee/i.test(t), 'raisefee window rendered', t.slice(0, 160))
    await clickBtn(rw, 'cancel')
    const out = await waitOut(dapp, 'out-raisefee', 20000)
    await waitNoWin(browser, 'raisefee')
    assert(/reject/.test(out) && /canceled/i.test(out), 'raisefee cancel replied', out.slice(0, 200))
  },
  async 'switchchain window: review + cancel'(browser) {
    const dapp = await openDapp(browser)
    await dapp.evaluate((rpc) => {
      const setv = (id, v) => {
        const el = document.getElementById(id)
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setv('i-sw-id', '1')
      setv('i-sw-name', 'Hacash Local Test')
      setv('i-sw-rpc', rpc)
      setv('i-sw-explorer', rpc)
    }, HACASH_RPC)
    await dapp.evaluate(() => document.getElementById('b-switchchain').click())
    const scw = await waitReqWin(browser, 'switchchain')
    await sleep(1000)
    const t = await bodyText(scw)
    await shot(scw, 'dapp-07-switchchain')
    assert(/Hacash Local Test/.test(t), 'switchchain shows the requested network', t.slice(0, 300))
    assert(/Cancel/i.test(t), 'switchchain has a cancel button')
    await clickBtn(scw, 'cancel')
    const out = await waitOut(dapp, 'out-switchchain', 20000)
    await waitNoWin(browser, 'switchchain')
    assert(/reject/.test(out) && /rejected/i.test(out), 'switchchain cancel replied', out.slice(0, 200))
  },
  async 'wallet() replies address without a window'(browser) {
    const dapp = await openDapp(browser)
    const before = (await browser.pages()).length
    await dapp.evaluate(() => document.getElementById('b-wallet').click())
    const out = await waitOut(dapp, 'out-wallet', 15000)
    await sleep(600)
    assert(/resolve/.test(out) && out.includes(EXPECTED_ADDRESS), 'wallet() resolved with the address', out.slice(0, 200))
    assert((await browser.pages()).length <= before + 1, 'wallet() opened no request window')
  },
  async 'connectedsites lists the dapp origin and disconnect works'(browser) {
    const cs = await browser.newPage()
    await cs.setViewport(VP)
    await cs.goto(`${EXT}/popup/connectedsites.html`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(1500)
    let t = await bodyText(cs)
    await shot(cs, 'dapp-08-connectedsites')
    assert(/127\.0\.0\.1|dapp-sim/i.test(t), 'connectedsites lists the dapp origin', t.slice(0, 300))
    // 断开（wpcfm red 确认）
    await cs.evaluate(() => {
      const b = [...document.querySelectorAll('#cnls button')].find((x) => /disconnect/i.test(x.innerText || ''))
      b && b.click()
    })
    await sleep(700)
    await cs.evaluate(() => {
      const w = document.getElementById('wpcfm')
      const b = w && [...w.querySelectorAll('button')].find((x) => /(^|\s)ok(\s|$)/.test(x.className))
      b && b.click()
    })
    await sleep(1000)
    t = await bodyText(cs)
    await shot(cs, 'dapp-09-disconnected')
    // toast 文案本身含 origin（"Disconnected 127.0.0.1:18652"），断言看列表空态
    assert(/No connected sites yet/i.test(t), 'site list empty after disconnect', t.slice(0, 300))
    await cs.close().catch(() => {})
  },
  async 'transfer full approve: sign + submit on the local chain'(browser) {
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-connect').click())
    const cw = await waitReqWin(browser, 'connect')
    await clickBtn(cw, 'blue')
    await waitNoWin(browser, 'connect')

    await dapp.evaluate(() => document.getElementById('b-transfer').click())
    const tw = await waitReqWin(browser, 'transfer')
    await sleep(1200)
    await shot(tw, 'dapp-10-transfer-review')
    await clickBtn(tw, 'blue') // cfim → wpcfm 确认
    await confirmWpcfm(tw)     // 复杂度确认（如有）
    await confirmWpcfm(tw)     // 签名确认
    const out = await waitOut(dapp, 'out-transfer', 50000)
    await waitNoWin(browser, 'transfer', 20000)
    const txhash = (out.match(/"txhash"\s*:\s*"([0-9a-f]{64})"/) || [])[1]
    assert(/^resolve/.test(out) && !!txhash && /"success"\s*:\s*true/.test(out),
      'transfer approved: resolved with txhash', out.slice(0, 240))
    console.log('    (txhash', txhash + ')')
  },
}
