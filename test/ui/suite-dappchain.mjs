// test/ui/suite-dappchain.mjs — dApp 批准链上功能簇 + actionview 完整内容 + 断开重连：
//   connect 拒绝路径（user_canceled）、signtx autosubmit 上链、raisefee 对真实 pending
//   hash 提费成功（停 poworker 制造确定性 pending）、signtext 签名 ECDSA 验证、
//   switchchain 批准 + 切回主网、actionview 完整 review（meta 网格/动作卡/签名者状态/
//   canonical json 折叠）、connectedsites 断开后同 origin 再请求重弹 connect。
// 前提：已解锁 + 本地链在线。
import {
  sleep, bodyText, shot, assert, clickBtn, clickByText, waitReqWin, waitNoWin, waitOut,
  openDapp, ensureHome, closeReqTargets, confirmWpcfm, tryWpcfm, stoLocalGet,
  ensureDappConnected,
  EXPECTED_ADDRESS, HACASH_RPC, DAPP_URL, EXT, VP, VP_WIDE,
} from './lib.mjs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const RECIPIENT = '1Drrsep4vZVKhKWx2vVmiw8umYN3ETYraB'

const fetchJson = async (p) => {
  const r = await fetch(HACASH_RPC + p, { signal: AbortSignal.timeout(8000) })
  return r.json()
}
const txStatus = async (hash) => fetchJson(`/query/transaction?hash=${hash}`)

export const cases = {
  async 'connect reject path replies user_canceled'(browser) {
    const home = await ensureHome(browser)
    await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
    await sleep(300)
    await closeReqTargets(browser)
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-connect').click())
    const cw = await waitReqWin(browser, 'connect')
    await sleep(600)
    await shot(cw, 'dappchain-01-connect')
    await clickBtn(cw, 'cancel')
    const out = await waitOut(dapp, 'out-connect', 20000)
    await waitNoWin(browser, 'connect')
    assert(/reject/.test(out) && /user_canceled/.test(out),
      'connect cancel rejected with user_canceled', out.slice(0, 240))
    // 未授权状态未变：wallet() 仍是 need_connect
    await dapp.evaluate(() => document.getElementById('b-wallet').click())
    const out2 = await waitOut(dapp, 'out-wallet', 15000)
    assert(/need_connect/.test(out2), 'wallet still need_connect after refused connect', out2.slice(0, 200))
    await closeReqTargets(browser)
  },

  async 'signtx autosubmit signs and submits on-chain'(browser) {
    // 出块活性自愈：若 poworker 曾 wedge（表现为高度不动），重启后再继续
    const h1 = (await fetchJson('/query/latest')).height
    await sleep(2500)
    const h2 = (await fetchJson('/query/latest')).height
    if (h2 <= h1) {
      spawnSync('bash', [path.join(__dir, 'chain.sh'), 'stop-poworker'], { env: process.env })
      const r = spawnSync('bash', [path.join(__dir, 'chain.sh'), 'start'], { env: process.env })
      assert(r.status === 0, 'poworker healed (restarted)', String(r.stderr))
      await sleep(1500)
    }
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    // 经 transfer 页管线构造真实可签名体（dapp-sim 默认样例是非法校验向量）
    await dapp.evaluate(() => document.getElementById('b-transfer').click())
    const twp = await waitReqWin(browser, 'transfer')
    const built = await twp.evaluate(async (main) => {
      const actions = mnx_map_txobj_actions([{ kind: 1, to: main, amount: '0.02' }])
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
    assert(/^([0-9a-f]{2})+$/.test(built), 'real tx body built via the page pipeline', built)
    await clickBtn(twp, 'cancel')
    await waitNoWin(browser, 'transfer')

    await dapp.evaluate((body) => {
      const el = document.getElementById('i-stx-body')
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(el, body)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('i-stx-auto').checked = true
      document.getElementById('b-signtx').click()
    }, built)
    const sw = await waitReqWin(browser, 'signtx')
    await sleep(1400)
    await shot(sw, 'dappchain-02-signtx')
    await clickBtn(sw, 'blue')          // Sign Tx
    await tryWpcfm(sw, 3500)            // 复杂动作确认（如有）
    await confirmWpcfm(sw)              // 不可逆确认
    const out = await waitOut(dapp, 'out-signtx', 50000)
    await waitNoWin(browser, 'signtx', 15000)
    const res = JSON.parse(out.replace(/^resolve:\n?/, ''))
    assert(res.ret === 0 && res.body && res.address === EXPECTED_ADDRESS,
      'signtx resolved with the signed body', out.slice(0, 300))
    // 上链确认：节点按 plain body hash（txhash）索引交易
    let st = null
    for (let i = 0; i < 30; i++) {
      st = await txStatus(res.txhash).catch(() => null)
      if (st && st.ret === 0 && (parseInt(st.confirm) >= 0 || st.pending === true)) break
      await sleep(1000)
    }
    assert(st && st.ret === 0 && (parseInt(st.confirm) >= 0 || st.pending === true),
      'autosubmitted tx is on-chain (confirm >= 0 or pending)', JSON.stringify(st).slice(0, 200))
  },

  async 'raisefee bumps a real pending transaction'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)

    // 1) 停 poworker：不再出块 → 提交的交易稳定停在 mempool（确定性 pending）
    const stop = spawnSync('bash', [path.join(__dir, 'chain.sh'), 'stop-poworker'], { env: process.env })
    assert(stop.status === 0, 'poworker stopped', String(stop.stderr))
    await sleep(500)
    try {
      // 2) dapp transfer 提交一笔（0.02），拿到 txhash 并确认 pending
      await dapp.evaluate((to) => {
        const setv = (id, v) => {
          const el = document.getElementById(id)
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          set.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        setv('i-tr-to', to)
        setv('i-tr-amt', '0.02')
        document.getElementById('b-transfer').click()
      }, RECIPIENT)
      const tw = await waitReqWin(browser, 'transfer')
      await sleep(1200)
      await clickBtn(tw, 'blue')
      await confirmWpcfm(tw)
      await confirmWpcfm(tw)
      const out = await waitOut(dapp, 'out-transfer', 50000)
      await waitNoWin(browser, 'transfer', 15000)
      const txhash = (out.match(/"txhash"\s*:\s*"([0-9a-f]{64})"/) || [])[1]
      assert(txhash && /"success"\s*:\s*true/.test(out), 'pending-transfer submitted', out.slice(0, 240))
      let st = null
      for (let i = 0; i < 10; i++) {
        st = await txStatus(txhash).catch(() => null)
        if (st && (st.pending || parseInt(st.confirm) >= 0)) break
        await sleep(700)
      }
      assert(st && st.pending === true, 'tx sits pending with the miner stopped', JSON.stringify(st).slice(0, 200))

      // 3) raisefee 对该 pending hash 提费
      await dapp.evaluate((hash) => {
        const setv = (id, v) => {
          const el = document.getElementById(id)
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          set.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
        setv('i-rf-hash', hash)
        setv('i-rf-fee', '0.01')
        document.getElementById('b-raisefee').click()
      }, txhash)
      const rw = await waitReqWin(browser, 'raisefee')
      await sleep(1200)
      await shot(rw, 'dappchain-03-raisefee')
      await clickBtn(rw, 'blue')
      // 两道确认按文案驱动（不可逆警告 → 动作复查红色），比盲序双击稳
      let confirmed = 0
      for (let i = 0; i < 25 && confirmed < 2; i++) {
        const hit = await rw.evaluate(() => {
          const w = document.getElementById('wpcfm')
          if (!w || String(w.className).includes('hide')) return null
          const txt = w.innerText || ''
          if (/attention: once the tx fee|check the actions of tx/i.test(txt)) {
            const b = [...w.querySelectorAll('button')].find((x) => /(^|\s)ok(\s|$)/.test(x.className))
            if (b) { b.click(); return txt.slice(0, 40) }
          }
          return null
        }).catch(() => null)
        if (hit) confirmed++
        await sleep(700)
      }
      assert(confirmed === 2, 'both raisefee confirms clicked', String(confirmed))
      const rfout = await waitOut(dapp, 'out-raisefee', 50000)
      await waitNoWin(browser, 'raisefee', 15000)
      assert(/resolve/.test(rfout) && /"ret"\s*:\s*0/.test(rfout),
        'raisefee resolved {ret:0}', rfout.slice(0, 240))
    } finally {
      // 4) 恢复 poworker：pending 交易被打包
      const start = spawnSync('bash', [path.join(__dir, 'chain.sh'), 'start'], { env: process.env })
      assert(start.status === 0, 'poworker restarted', String(start.stderr))
    }
    await sleep(2500)
  },

  async 'signtext signature verifies via ECDSA'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    await dapp.evaluate(() => {
      const el = document.getElementById('i-stext')
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(el, 'Login to dappchain-suite at local test time')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('b-signtext').click()
    })
    const sw = await waitReqWin(browser, 'signtext')
    await sleep(1000)
    await clickBtn(sw, 'blue')
    await tryWpcfm(sw, 3500)
    const out = await waitOut(dapp, 'out-signtext', 30000)
    await waitNoWin(browser, 'signtext', 15000)
    const res = JSON.parse(out.replace(/^resolve:\n?/, ''))
    assert(res.ret === 0 && /^[0-9a-f]{64}$/.test(res.digest) && /^[0-9a-f]{128}$/.test(res.signature)
      && /^[0-9a-f]{66}$|^[0-9a-f]{130}$/.test(res.public_key) && res.address === EXPECTED_ADDRESS,
      'signtext resolved with the documented fields', out.slice(0, 300))
    // 摘要正确性：SHA-256(text) 与 digest 一致
    const digestOk = await dapp.evaluate(async (text, digest) => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('') === digest
    }, 'Login to dappchain-suite at local test time', res.digest)
    assert(digestOk, 'digest == SHA-256(text)')
    // ECDSA(secp256k1) 验签：在扩展页上下文（打包了 elliptic）验证 public_key 对 digest 的签名
    const home = await ensureHome(browser)
    const verified = await home.evaluate(({ publicKey, signature, digest }) => {
      const ec = new elliptic.ec('secp256k1')
      const key = ec.keyFromPublic(publicKey, 'hex')
      return key.verify(digest, { r: signature.slice(0, 64), s: signature.slice(64) })
    }, { publicKey: res.public_key, signature: res.signature, digest: res.digest }).catch((e) => 'ERR:' + e.message)
    assert(verified === true, 'ECDSA signature verifies against digest+public_key', String(verified))
  },

  async 'switchchain approve switches, then back to mainnet'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    const home = await ensureHome(browser)
    // 基线：主网（若不在主网，先 UI 切回）
    if (String(await stoLocalGet(home, 'current_chain_id') ?? '0') !== '0') {
      await home.evaluate(async () => { await chrome.storage.local.set({ current_chain_id: 0 }) })
      await home.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await sleep(1200)
    }

    // dapp 请求切到 chain 1（本地链）
    await dapp.evaluate((rpc) => {
      const setv = (id, v) => {
        const el = document.getElementById(id)
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setv('i-sw-id', '1')
      setv('i-sw-name', 'Hacash Local Test')
      setv('i-sw-rpc', rpc)
      document.getElementById('b-switchchain').click()
    }, HACASH_RPC)
    const scw = await waitReqWin(browser, 'switchchain')
    await sleep(1000)
    await shot(scw, 'dappchain-04-switchchain')
    await clickBtn(scw, 'blue')
    const out = await waitOut(dapp, 'out-switchchain', 30000)
    await waitNoWin(browser, 'switchchain', 15000)
    const res = JSON.parse(out.replace(/^resolve:\n?/, ''))
    assert(res.switched === true && res.chain && String(res.chain.id) === '1',
      'switchchain approved and switched', out.slice(0, 300))
    assert(String(await stoLocalGet(home, 'current_chain_id')) === '1', 'current_chain_id == 1 after approval')

    // silentIfCurrent：再切同链 → 立即 already_current，不开窗
    const before = (await browser.pages()).length
    await dapp.evaluate(() => document.getElementById('b-switchchain').click())
    const out2 = await waitOut(dapp, 'out-switchchain', 15000)
    assert(/already_current/.test(out2), 'second switchchain resolves already_current', out2.slice(0, 240))
    await sleep(600)
    assert((await browser.pages()).length <= before + 1, 'already_current opened no window')

    // 切回主网（钱包 Networks UI），保持后续用例环境干净
    await home.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(1500)
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(450)
    await clickByText(home, 'Networks')
    await sleep(1100)
    const switched = await home.evaluate(() => {
      const li = [...document.querySelectorAll('#chains .chlist li')].find((x) => /Mainnet/.test(x.innerText || ''))
      if (!li) return false
      const a = [...li.querySelectorAll('.btns a')].find((x) => /^switch$/i.test((x.innerText || '').trim()))
      if (!a) return 'no-switch-btn'
      a.click(); return true
    })
    assert(switched === true, 'mainnet switch clicked', String(switched))
    await sleep(700)
    await confirmWpcfm(home)
    await sleep(1100)
    assert(String(await stoLocalGet(home, 'current_chain_id')) === '0',
      'switched back to mainnet (baseline restored)', String(await stoLocalGet(home, 'current_chain_id')))
    await home.evaluate(() => document.querySelector('#chains .pchead button.icbtn[title="Back"]')?.click())
    await sleep(800)
  },

  async 'actionview shows the full review content'(browser) {
    // 自建 review（transfer 页管线构建 + 存储 actv_ui），不依赖其它 case 的会话存储
    const dapp0 = await openDapp(browser)
    await ensureDappConnected(browser, dapp0)
    await dapp0.evaluate(() => document.getElementById('b-transfer').click())
    const twp0 = await waitReqWin(browser, 'transfer')
    const built0 = await twp0.evaluate(async (main) => {
      const actions = mnx_map_txobj_actions([{ kind: 1, to: main, amount: '0.03' }])
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
      return !!b.body
    }, EXPECTED_ADDRESS).catch((e) => 'ERR:' + e.message)
    assert(built0 === true, 'review stored for actionview', String(built0).slice(0, 120))
    await clickBtn(twp0, 'cancel')
    await waitNoWin(browser, 'transfer')

    const av = await browser.newPage()
    await av.setViewport(VP_WIDE)
    await av.goto(`${EXT}/popup/actionview.html?key=actv_ui`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await sleep(2000)
    const t = await bodyText(av)
    await shot(av, 'dappchain-05-actionview', VP_WIDE)
    // meta 网格
    for (const k of ['Main account', 'Transaction', 'Fee and gas', 'Review status', 'Transaction hash', 'Hash with fee', 'Unsigned body hash']) {
      assert(t.includes(k), `meta grid has "${k}"`, t.slice(0, 200))
    }
    const txMeta = await av.evaluate(() => [...document.querySelectorAll('.avmeta .avmrow')]
      .find(row => row.querySelector('.avk')?.innerText.trim() === 'Transaction')?.querySelector('.avv')?.innerText || '')
    assert(/Type-2/.test(txMeta), 'Transaction section identifies Type-2', txMeta)
    const feeDetail = await av.evaluate(() => {
      const details = document.querySelector('.av-fee')
      const summary = details?.querySelector('summary')
      summary?.click()
      return { text: details?.innerText || '', open: details?.open === true }
    })
    const expectedFeeFacts = await av.evaluate(async () => {
      const values = await chrome_storage_session.get('actv_ui')
      const r = values.actv_ui.review
      return { fee: mnx_fin_to_decimal(r.fee), billingSize: r.billing_size, purity: r.fee_purity, purityUnit: r.fee_purity_unit }
    })
    assert(feeDetail.open && /Transaction fee/.test(feeDetail.text) && feeDetail.text.includes(`${expectedFeeFacts.fee} HAC`),
      'Fee and gas section expands and preserves the SDK fee value', JSON.stringify({ feeDetail: feeDetail.text, expectedFeeFacts }))
    const billingText = expectedFeeFacts.billingSize == null ? /Billing size\s*Unavailable/ : new RegExp(`Billing size\\s*${expectedFeeFacts.billingSize} bytes`)
    assert(billingText.test(feeDetail.text), 'Fee and gas billing size matches the SDK review fact', JSON.stringify({ feeDetail: feeDetail.text, expectedFeeFacts }))
    const purityText = expectedFeeFacts.purity == null ? /Fee purity\s*Unavailable/ : new RegExp(`Fee purity\\s*${expectedFeeFacts.purity} u${expectedFeeFacts.purityUnit} / byte`)
    assert(purityText.test(feeDetail.text), 'Fee and gas purity matches the SDK review fact', JSON.stringify({ feeDetail: feeDetail.text, expectedFeeFacts }))
    assert(t.includes(EXPECTED_ADDRESS), 'meta shows the main account address')
    // 动作卡 + 签名者状态
    // 动作卡（avname 为 SDK registry 名，如 transfer_hac_to —— 小写）+ 签名者状态
    const nActs = await av.evaluate(() => document.querySelectorAll('.avacts .avact').length).catch(() => 0)
    assert(nActs >= 1 && /transfer/i.test(t), 'action card rendered', `${nActs} acts :: ${t.slice(0, 200)}`)
    assert(/Signature Status/i.test(t), 'signature status section rendered', t.slice(0, 300))
    // canonical json / raw bytes 折叠（默认收起）
    const det = await av.evaluate(() => [...document.querySelectorAll('details.avdet')].map((d) => ({
      summary: (d.querySelector('summary') || {}).textContent || '',
      open: d.open,
    })))
    assert(det.length >= 3 && det.some((d) => /SDK description/i.test(d.summary)) && det.some((d) => /canonical json/i.test(d.summary)),
      'SDK description, canonical json, and raw bytes details present', JSON.stringify(det))
    assert(det.every((d) => !d.open), 'details collapsed by default')
    // 展开后有 JSON 内容
    await av.evaluate(() => [...document.querySelectorAll('details.avdet')]
      .find(d => /canonical json/i.test(d.querySelector('summary')?.innerText || ''))?.setAttribute('open', ''))
    await sleep(300)
    const pre = await av.evaluate(() => [...document.querySelectorAll('details.avdet')]
      .find(d => /canonical json/i.test(d.querySelector('summary')?.innerText || ''))?.querySelector('pre.avpre')?.textContent || '')
    await shot(av, 'dappchain-06-actionview-json', VP_WIDE)
    assert(/[{\[]/.test(pre), 'expanded canonical json shows content', pre.slice(0, 120))
    await av.close().catch(() => {})
  },

  async 'connectedsites disconnect forces re-connect for the same origin'(browser) {
    const dapp = await openDapp(browser)
    await ensureDappConnected(browser, dapp)
    // 管理页断开
    const home = await ensureHome(browser)
    await home.evaluate(() => document.querySelector('button.icbtn[title="Menu"]')?.click())
    await sleep(450)
    await clickByText(home, 'Connected sites')
    await sleep(1500)
    await home.evaluate(() => {
      const b = [...document.querySelectorAll('#cnls button')].find((x) => /disconnect/i.test(x.innerText || ''))
      b && b.click()
    })
    await sleep(700)
    await confirmWpcfm(home)
    await sleep(1200)
    let t = await bodyText(home)
    await shot(home, 'dappchain-07-disconnected')
    assert(/No connected sites yet/i.test(t), 'site list empty after disconnect', t.slice(0, 300))
    await home.evaluate(() => document.querySelector('#cnls .pchead button.icbtn[title="Back"]')?.click())
    await sleep(1000)

    // 同 origin 再调 API：need_connect + 重新弹 connect 窗
    await closeReqTargets(browser)
    await dapp.evaluate(() => document.getElementById('b-wallet').click())
    const out = await waitOut(dapp, 'out-wallet', 20000)
    assert(/reject/.test(out) && /need_connect/.test(out), 'wallet() need_connect after disconnect', out.slice(0, 240))
    const cw = await waitReqWin(browser, 'connect')
    await sleep(500)
    await shot(cw, 'dappchain-08-reconnect-window')
    await clickBtn(cw, 'blue')
    const out2 = await waitOut(dapp, 'out-connect', 20000).catch(() => '')
    await waitNoWin(browser, 'connect')
    assert(!out2 || /resolve/.test(out2), 're-connect approval path works')
  },
}
