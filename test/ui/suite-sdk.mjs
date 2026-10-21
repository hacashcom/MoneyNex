// test/ui/suite-sdk.mjs — SDK 回归锚：window.MoneyNex 8 个 API（wallet/connect/transfer/
// signtx/raisefee/chain/switchchain/signtext）的 resolve/reject 契约，逐条对 doc/sdk.md
// 断言字段。链上成功路径的字段断言在 suite-dapp/suite-dappchain（transfer 全批、signtx
// autosubmit、raisefee 真实 pending），本锚覆盖轻路径 + 错误码表。
import {
  sleep, bodyText, shot, assert, clickBtn, clickByText, waitReqWin, waitNoWin, waitOut,
  openDapp, ensureHome, closeReqTargets, stoLocalGet, confirmWpcfm,
  EXPECTED_ADDRESS, HACASH_RPC, DAPP_URL,
} from './lib.mjs'

const parseOut = (out) => JSON.parse(out.replace(/^resolve:\n?/, '').replace(/^reject:\n?/, ''))

async function ensureDappConnected(browser, dapp) {
  // 授权态必须在扩展页上下文里读：dapp 页运行在 page world，没有 chrome.storage
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

export const cases = {
  async 'sdk anchor: wallet resolve/reject contract'(browser) {
    const home = await ensureHome(browser)
    // 未授权：reject {err:'need connect first', code:'need_connect'}（sdk.md 表）
    await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
    await sleep(300)
    await closeReqTargets(browser)
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-wallet').click())
    const rej = await waitOut(dapp, 'out-wallet', 20000)
    await closeReqTargets(browser)
    assert(/reject/.test(rej), 'unauthorized wallet() rejected')
    const r = parseOut(rej)
    assert(r.err === 'need connect first' && r.code === 'need_connect',
      'need_connect rejection shape per sdk.md', rej.slice(0, 240))
    // 授权后：resolve {address}
    await ensureDappConnected(browser, dapp)
    await dapp.evaluate(() => document.getElementById('b-wallet').click())
    const ok = await waitOut(dapp, 'out-wallet', 15000)
    const w = parseOut(ok)
    assert(/resolve/.test(ok) && w.address === EXPECTED_ADDRESS
      && Object.keys(w).every((k) => k === 'address' || k === 'did'),
      'wallet resolves {address} (did is bridge plumbing)', ok.slice(0, 240))
  },

  async 'sdk anchor: connect approve/cancel contract'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
    await sleep(300)
    await closeReqTargets(browser)
    const dapp = await openDapp(browser)
    // 取消：reject {ret:1, code:'user_canceled'}
    await dapp.evaluate(() => document.getElementById('b-connect').click())
    let cw = await waitReqWin(browser, 'connect')
    await clickBtn(cw, 'cancel')
    let out = await waitOut(dapp, 'out-connect', 20000)
    await waitNoWin(browser, 'connect')
    let r = parseOut(out)
    assert(/reject/.test(out) && parseInt(r.ret) === 1 && r.code === 'user_canceled',
      'connect cancel → {ret:1, code:"user_canceled"}', out.slice(0, 240))
    // 批准：resolve {address}
    await dapp.evaluate(() => document.getElementById('b-connect').click())
    cw = await waitReqWin(browser, 'connect')
    await clickBtn(cw, 'blue')
    out = await waitOut(dapp, 'out-connect', 20000)
    await waitNoWin(browser, 'connect')
    r = parseOut(out)
    assert(/resolve/.test(out) && r.address === EXPECTED_ADDRESS,
      'connect approve resolves {address}', out.slice(0, 240))
    // 已授权的重复 connect：立即 {address}，不开窗（§7.2）
    const before = (await browser.pages()).length
    await dapp.evaluate(() => document.getElementById('b-connect').click())
    out = await waitOut(dapp, 'out-connect', 15000)
    r = parseOut(out)
    assert(/resolve/.test(out) && r.address === EXPECTED_ADDRESS, 'repeat connect resolves immediately')
    await sleep(600)
    assert((await browser.pages()).length <= before, 'repeat connect opened no window')
  },

  async 'sdk anchor: chain read-only contract'(browser) {
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => {
      const el = document.getElementById('i-chain-id')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, '1')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('b-chain').click()
    })
    const out = await waitOut(dapp, 'out-chain', 15000)
    const r = parseOut(out)
    // sdk.md 示例字段集
    for (const k of ['current_chain_id', 'current_chain', 'target_chain_id', 'target_chain', 'configured', 'matched', 'need_add', 'need_switch', 'diff']) {
      assert(k in r, `chain reply has "${k}"`, out.slice(0, 300))
    }
    assert(parseInt(r.target_chain_id) === 1, 'target_chain_id echoes the request')
    assert((await browser.pages()).every((p) => !p.url().includes('popup/chain.html')),
      'chain opened no wallet page (read-only)')
  },

  async 'sdk anchor: switchchain already-current + reject contract'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    const home = await ensureHome(browser)
    if (String(await stoLocalGet(home, 'current_chain_id') ?? '0') !== '1') {
      // 切到 1（安静路径：直接请求与当前一致的链不会有窗；这里直接写存储再回读 = 环境准备）
      await home.evaluate(async () => { await chrome.storage.local.set({ current_chain_id: 1 }) })
      await home.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await sleep(1200)
    }
    // silentIfCurrent 默认 true：已是当前链 → {already_current:true, switched:false}，不开窗
    const before = (await browser.pages()).length
    await dapp.evaluate(() => {
      const set = (id, v) => {
        const el = document.getElementById(id)
        const setr = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setr.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      // 清掉表单残留（上一轮 case 填过的 name/rpc 会构成配置 diff → 开窗而非 silent）
      set('i-sw-id', '1'); set('i-sw-name', ''); set('i-sw-rpc', ''); set('i-sw-explorer', '')
      document.getElementById('b-switchchain').click()
    })
    let out = await waitOut(dapp, 'out-switchchain', 15000)
    let r = parseOut(out)
    assert(r.already_current === true && r.switched === false,
      'already_current resolves without a window', out.slice(0, 240))
    await sleep(500)
    assert((await browser.pages()).length <= before, 'already_current opened no window')

    // 用户拒绝：reject（sdk.md：{err:'User rejected network switch'}）
    await dapp.evaluate((rpc) => {
      const setv = (id, v) => {
        const el = document.getElementById(id)
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setv('i-sw-id', '9')
      setv('i-sw-name', 'SDK Anchor Net')
      setv('i-sw-rpc', rpc)
      document.getElementById('b-switchchain').click()
    }, HACASH_RPC)
    const scw = await waitReqWin(browser, 'switchchain')
    await sleep(900)
    await clickBtn(scw, 'cancel')
    out = await waitOut(dapp, 'out-switchchain', 20000)
    await waitNoWin(browser, 'switchchain')
    r = parseOut(out)
    assert(/reject/.test(out) && /rejected network switch/i.test(r.err || ''),
      'switchchain cancel → "User rejected network switch"', out.slice(0, 240))
    // 清理：不保留 anchor 网络，并把当前网络恢复为主网（本 case 开头的基线）
    await home.evaluate(async () => {
      const o = await chrome.storage.local.get('chain_configs')
      const cfgs = o['chain_configs'] || {}
      delete cfgs['9']
      await chrome.storage.local.set({ chain_configs: cfgs, current_chain_id: 0 })
    })
    await home.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(1000)
  },

  async 'sdk anchor: transfer cancel + sign_refused semantics presence'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    // 取消路径：reject {ret:1, code:'user_canceled'}（成功路径字段锚在 suite-dapp transfer 全批）
    await dapp.evaluate(() => document.getElementById('b-transfer').click())
    const tw = await waitReqWin(browser, 'transfer')
    await sleep(1000)
    await clickBtn(tw, 'cancel')
    const out = await waitOut(dapp, 'out-transfer', 20000)
    await waitNoWin(browser, 'transfer')
    const r = parseOut(out)
    assert(/reject/.test(out) && parseInt(r.ret) === 1 && r.code === 'user_canceled',
      'transfer cancel → user_canceled', out.slice(0, 240))
  },

  async 'sdk anchor: signtext refusal codes'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    // 32B hash 拒签：{ret:1, err, code:'sign_refused'}
    await dapp.evaluate(() => document.getElementById('b-signtext-hash').click())
    const out = await waitOut(dapp, 'out-signtext', 20000)
    const r = parseOut(out)
    assert(/reject/.test(out) && parseInt(r.ret) === 1 && r.code === 'sign_refused' && /raw 32-byte hash/i.test(r.err),
      'hash refusal → {ret:1, code:"sign_refused"}', out.slice(0, 240))
    await shot(dapp, 'sdk-01-signtext-refused')
    await waitNoWin(browser, 'signtext', 8000)
    await closeReqTargets(browser)
  },

  async 'sdk anchor: raisefee unknown-hash + need_connect gating'(browser) {
    const home = await ensureHome(browser)
    // 未授权的受限 API（raisefee 属 gated）：need_connect
    await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
    await sleep(300)
    await closeReqTargets(browser)
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-raisefee').click())
    const out = await waitOut(dapp, 'out-raisefee', 20000)
    assert(/reject/.test(out) && /need_connect/.test(out), 'gated raisefee → need_connect', out.slice(0, 240))
    await closeReqTargets(browser)
    // 池外 hash：可见错误回复（成功路径锚在 suite-dappchain 真实 pending）
    await ensureDappConnected(browser, dapp)
    await dapp.evaluate(() => {
      const el = document.getElementById('i-rf-hash')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, 'e2700db4558ef1e1b540fd53f5e7a0fa7b9d096947f9dc20d07bd507969987b9')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('b-raisefee').click()
    })
    const rw = await waitReqWin(browser, 'raisefee')
    await sleep(900)
    await clickBtn(rw, 'blue')
    await confirmWpcfm(rw)
    const out2 = await waitOut(dapp, 'out-raisefee', 25000)
    const r2 = parseOut(out2)
    assert(/reject/.test(out2) && parseInt(r2.ret) === 1 && r2.code === 'sign_refused' && /not find.*tx pool/i.test(r2.err),
      'unknown hash raisefee → visible {ret:1, code:"sign_refused", err}', out2.slice(0, 300))
    await waitNoWin(browser, 'raisefee', 10000)
    await closeReqTargets(browser)
  },

  async 'sdk anchor: MoneyNex.info carries the manifest version'(browser) {
    const dapp = await openDapp(browser)
    const info = await dapp.evaluate(() => window.MoneyNex && window.MoneyNex.info)
    assert(info && info.name === 'MoneyNex' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.version || '') && /^chrome-extension:\/\//.test(info.icon || ''),
      'MoneyNex.info = {icon, name, version} (version from manifest)', JSON.stringify(info))
    const manifestVersion = await (await openExtManifest(browser, dapp))
    assert(info.version === manifestVersion, `info.version == manifest version (${manifestVersion})`, info.version)
  },
}

async function openExtManifest(browser, dapp) {
  // 扩展页上下文读 manifest 版本（与 info.version 对照；sdk.md 明确运行时读取）
  const home = await ensureHome(browser)
  return await home.evaluate(() => chrome.runtime.getManifest().version)
}
