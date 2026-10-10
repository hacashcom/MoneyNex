// test/ui/suite-onchain.mjs — 真实链上操作功能簇（本地 chain_id=1 测试链，全部上链确认）：
//   dotrs 发 HAC（余额前后差值 + Activity pending→confirm 状态刷新）、
//   发 HACD（genesis 钻石）、发 Asset（HUSD#1 走 decimals 显示）、
//   给自己转账拒绝、余额不足报错。
// 前提：已解锁 + 本地链在线；账户为 genesis 资助的公开测试账户。
import {
  sleep, bodyText, shot, assert, clickByText, ensureHome, waitBalances,
  unlockWallet, setInputValue, stoLocalGet, confirmWpcfm, EXPECTED_ADDRESS,
} from './lib.mjs'

const { HACASH_RPC } = await import('./lib.mjs')
const RECIPIENT = '1Drrsep4vZVKhKWx2vVmiw8umYN3ETYraB' // 独立挖矿收益地址（测试recipient，资金视同销毁）

const fetchJson = async (p) => {
  const r = await fetch(HACASH_RPC + p, { signal: AbortSignal.timeout(8000) })
  return r.json()
}
const rpcBalance = async (addr = EXPECTED_ADDRESS) => {
  const j = await fetchJson(`/query/balance?unit=mei&assets=true&asset_meta=true&address=${addr}`)
  return (j.list && j.list[0]) || {}
}
const rpcDiamonds = async (addr = EXPECTED_ADDRESS) => {
  const j = await fetchJson(`/query/balance?diamonds=true&address=${addr}`)
  const s = ((j.list && j.list[0]) || {}).diamonds || ''
  const out = []
  for (let i = 0; i + 6 <= s.length; i += 6) out.push(s.slice(i, i + 6))
  return out
}

// trslogs（chrome.storage.local 'trslogs'）里等一笔新交易达到期望状态（0 pending / 1 ok）
async function waitTxStat(home, match, wantStat = 1, ms = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const logs = (await stoLocalGet(home, 'trslogs')) || []
    const hit = logs.find(match)
    if (hit && hit.stat === wantStat) return hit
    // 重载主页触发 refreshAll → updtxsts 查询 pending 并回写状态
    //（页面自身的自动刷新间隔是分钟级，菜单开合不会触发刷新）
    await home.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    await sleep(1800)
  }
  const logs = (await stoLocalGet(home, 'trslogs')) || []
  const hit = logs.find(match)
  throw new Error(`tx never reached stat=${wantStat} :: last=${JSON.stringify(hit)}`)
}

async function openDotrs(home) {
  await clickByText(home, '^Send$')
  for (let i = 0; i < 12; i++) {
    if (await home.evaluate(() => !!document.querySelector('#dotrs input')?.getBoundingClientRect().width)) break
    await sleep(400)
  }
  await sleep(600)
}
// 等 swtgas 自动询价完成（Avg 卡片显示出 X HAC）
async function waitGasFilled(home) {
  for (let i = 0; i < 24; i++) {
    const v = await home.evaluate(() => {
      const items = [...document.querySelectorAll('#dotrs .gasw .item')]
      const avg = items.find((x) => /avg/i.test(x.innerText || ''))
      const m = avg ? (avg.innerText.match(/([0-9.]+)\s*HAC/) || [])[1] : ''
      return m || ''
    }).catch(() => '')
    if (v && parseFloat(v) > 0) return v
    await sleep(500)
  }
  throw new Error('gas never auto-filled')
}
async function dotrsTransfer(home) {
  // 防脏状态：上一 case 遗留的 wpcfm 会被下面的等待误认为本 case 的确认框并误确认。
  // 点击 Transfer 前先取消任何已可见的 wpcfm，再等「新」对话框出现。
  await home.evaluate(() => {
    const w = document.getElementById('wpcfm')
    if (w && !String(w.className).includes('hide')) {
      const c = [...w.querySelectorAll('button')].find((x) => /cancel/i.test(x.innerText || '') || /(^|\s)cancel(\s|$)/i.test(x.className))
      c && c.click()
    }
  }).catch(() => {})
  await sleep(300)
  await home.evaluate(() => {
    const b = document.querySelector('#dotrs .btns button.blue')
    if (!b) throw new Error('no transfer button')
    b.click()
  })
  // 校验通过 → wpcfm「Check transfer detail」；解析 Gas 显示值
  for (let i = 0; i < 20; i++) {
    const w = await home.evaluate(() => {
      const el = document.getElementById('wpcfm')
      return el && !String(el.className).includes('hide') ? el.innerText : ''
    }).catch(() => '')
    if (w && /check transfer detail/i.test(w)) return w
    await sleep(500)
  }
  throw new Error('transfer confirm dialog never opened')
}

export const cases = {
  async 'dotrs send HAC: balance delta + activity pending→confirm'(browser) {
    const home = await unlockWallet(browser)
    await waitBalances(home)
    const before = parseFloat((await rpcBalance()).hacash)
    const AMOUNT = '0.5'

    await openDotrs(home)
    await shot(home, 'onchain-01-dotrs-hac')
    const inputs = await home.evaluate(() => [...document.querySelectorAll('#dotrs .ipw input')]
      .filter((x) => x.getBoundingClientRect().width > 4).map((x) => x.placeholder))
    const gas = await waitGasFilled(home)
    await home.evaluate((to, amt) => {
      const set = (el, v) => {
        const setr = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setr.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const boxes = [...document.querySelectorAll('#dotrs .ipw input')].filter((x) => x.getBoundingClientRect().width > 4)
      set(boxes[0], to) // Send to
      const amtI = boxes.find((x) => /HAC amount/i.test(x.placeholder || ''))
      set(amtI, amt)
    }, RECIPIENT, AMOUNT)
    const cfmText = await dotrsTransfer(home)
    await shot(home, 'onchain-02-hac-cfm')
    const feeMatch = cfmText.match(/gas[^0-9]*([0-9.]+)\s*HAC[\s\S]{0,40}?to\s+1Drrsep/i)
      || cfmText.match(/gas\s*([0-9.]+)\s*HAC/i)
    assert(feeMatch, 'confirm dialog shows the gas fee', cfmText.slice(0, 300))
    const fee = parseFloat(feeMatch[1])
    assert(/to\s+1Drrsep/i.test(cfmText), 'confirm shows the recipient', cfmText.slice(0, 300))
    await confirmWpcfm(home)

    // 提交成功 toast + 自动返回主页
    for (let i = 0; i < 20; i++) {
      const t = await bodyText(home)
      if (/submitted successfully/i.test(t)) break
      await sleep(600)
    }
    for (let i = 0; i < 20; i++) {
      if (await home.evaluate(() => !!document.querySelector('h1.btn.adrs-btn')?.getBoundingClientRect().width)) break
      await sleep(600)
    }
    let t = await bodyText(home)
    assert(/submitted successfully|Assets|Activity/i.test(t), 'back home after submit', t.slice(0, 200))

    // Activity 出现该笔（pending 或已 confirm），最终 stat=1
    await clickByText(home, '^Activity$')
    await sleep(1200)
    await shot(home, 'onchain-03-activity')
    t = await bodyText(home)
    assert(/1Drrsep|0\.5/.test(t), 'activity lists the new transfer', t.slice(0, 300))
    const hit = await waitTxStat(home, (li) => li.to === RECIPIENT && li.type === 'HAC')
    assert(hit && hit.hash && /^[0-9a-f]{64}$/.test(hit.hash), 'activity entry carries the tx hash',
      JSON.stringify(hit).slice(0, 200))

    // 余额差值 = amount + fee（链上查询为准）
    for (let i = 0; i < 15; i++) {
      const now = parseFloat((await rpcBalance()).hacash)
      if (Math.abs((before - now) - (parseFloat(AMOUNT) + fee)) < 1e-6) {
        assert(true, `balance delta == amount+fee (${AMOUNT}+${fee})`)
        return
      }
      await sleep(1000)
    }
    const now = parseFloat((await rpcBalance()).hacash)
    assert(false, `balance delta == amount+fee (want ${parseFloat(AMOUNT) + fee}, got ${before - now})`,
      `before=${before} after=${now} fee=${fee}`)
  },

  async 'dotrs send HACD: genesis diamond moves on-chain'(browser) {
    const home = await ensureHome(browser)
    await waitBalances(home)
    const diasBefore = await rpcDiamonds()
    const dia = diasBefore[0]
    assert(dia && /^[A-Z]{6}$/.test(dia), 'genesis has diamonds to send', String(dia))

    await openDotrs(home)
    await home.evaluate(() => {
      // 切到 HACD 标签
      const tab = [...document.querySelectorAll('#dotrs .cis .it')].find((x) => /HACD/.test(x.innerText || ''))
      tab && tab.click()
    })
    await sleep(600)
    await waitGasFilled(home)
    await home.evaluate((to, dia) => {
      const set = (el, v) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setr = Object.getOwnPropertyDescriptor(proto, 'value').set
        setr.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const toI = document.querySelector('#dotrs .ipw input')
      set(toI, to)
      set(document.querySelector('#dotrs textarea'), dia)
    }, RECIPIENT, dia)
    await shot(home, 'onchain-04-dotrs-hacd')
    const cfmText = await dotrsTransfer(home)
    assert(/HACD|diamond/i.test(cfmText), 'confirm shows the diamond transfer', cfmText.slice(0, 300))
    await confirmWpcfm(home)
    await sleep(2500)

    const hit = await waitTxStat(home, (li) => li.to === RECIPIENT && li.type === 'HACD' && li.desc === dia)
    assert(hit && /^1\s+HACD|HACD/.test(hit.asset || ''), 'activity entry is the diamond transfer', JSON.stringify(hit).slice(0, 200))
    for (let i = 0; i < 15; i++) {
      const now = await rpcDiamonds()
      if (now.length === diasBefore.length - 1 && !now.includes(dia)) {
        assert(true, `diamond ${dia} left the account`)
        await shot(home, 'onchain-05-hacd-done')
        return
      }
      await sleep(1000)
    }
    assert(false, 'diamond count decreased on-chain', `${diasBefore.length} → ${(await rpcDiamonds()).length}`)
  },

  async 'dotrs send Asset: HUSD with decimals display'(browser) {
    const home = await ensureHome(browser)
    await waitBalances(home)
    await clickByText(home, '^Assets$').catch(() => {}) // 上一 case 可能停在 Activity 标签
    await sleep(800)
    const bal = await rpcBalance()
    const husd = ((bal.assets || []).find((a) => a.ticket === 'HUSD') || {})
    assert(husd.serial === '1', 'HUSD asset present', JSON.stringify(husd).slice(0, 120))
    const atomsBefore = BigInt(husd.amount || '0')

    // 资产行的 Send 按钮 → dotrs ASSET 预填
    const clicked = await home.evaluate(() => {
      const li = [...document.querySelectorAll('#home ul li, #home .assets li')]
        .find((x) => /HUSD/.test(x.innerText || ''))
      if (!li) return false
      const b = li.querySelector('button.send')
      if (!b || b.disabled) return false
      b.click(); return true
    }).catch(() => false)
    assert(clicked, 'HUSD row send button clicked')
    for (let i = 0; i < 12; i++) {
      if (await home.evaluate(() => !!document.querySelector('#dotrs input')?.getBoundingClientRect().width)) break
      await sleep(400)
    }
    await sleep(600)
    let t = await bodyText(home)
    assert(/Serial #1/.test(t), 'dotrs shows the asset serial', t.slice(0, 300))
    assert(/Hacash USD|HUSD/.test(t), 'dotrs shows the asset name', t.slice(0, 300))
    const availShown = await home.evaluate(() =>
      (document.querySelector('#dotrs .ainfo ~ p, #dotrs .ipw p') || {}).textContent || '')
    await shot(home, 'onchain-06-dotrs-asset')

    await waitGasFilled(home)
    await home.evaluate((to, amt) => {
      const set = (el, v) => {
        const setr = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setr.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const boxes = [...document.querySelectorAll('#dotrs .ipw input')].filter((x) => x.getBoundingClientRect().width > 4)
      set(boxes[0], to)
      const amtI = boxes.find((x) => /amount/i.test(x.placeholder || ''))
      set(amtI, amt)
    }, RECIPIENT, '1.5')
    const cfmText = await dotrsTransfer(home)
    await shot(home, 'onchain-07-asset-cfm')
    // decimals 显示：1.5 HUSD（6 位小数 → atoms 1500000）
    assert(/1\.5\s*HUSD|1\.5\s*Hacash USD/i.test(cfmText), 'confirm shows the decimal amount', cfmText.slice(0, 400))
    assert(/serial\s*#?\s*1\b/i.test(cfmText), 'confirm shows serial #1', cfmText.slice(0, 400))
    await confirmWpcfm(home)
    await sleep(2500)

    const hit = await waitTxStat(home, (li) => li.to === RECIPIENT && li.type === 'ASSET' && String(li.assetSerial) === '1')
    assert(String(hit.assetAtoms) === '1500000',
      'atoms = 1.5 × 10^6 (decimals=6)', JSON.stringify(hit).slice(0, 200))
    for (let i = 0; i < 15; i++) {
      const now = (await rpcBalance()).assets || []
      const h = now.find((a) => a.ticket === 'HUSD') || {}
      if (atomsBefore - BigInt(h.amount || '0') === 1500000n) {
        assert(true, 'on-chain HUSD atoms decreased by exactly 1500000')
        return
      }
      await sleep(1000)
    }
    assert(false, 'on-chain HUSD balance delta == 1500000 atoms')
  },

  async 'dotrs self-transfer is refused in-form'(browser) {
    const home = await ensureHome(browser)
    const logsBefore = ((await stoLocalGet(home, 'trslogs')) || []).length
    const SELF_T0 = Math.floor(Date.now() / 1000)
    await openDotrs(home)
    await waitGasFilled(home)
    await home.evaluate((me) => {
      const set = (el, v) => {
        const setr = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setr.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const boxes = [...document.querySelectorAll('#dotrs .ipw input')].filter((x) => x.getBoundingClientRect().width > 4)
      set(boxes[0], me)
      const amtI = boxes.find((x) => /HAC amount/i.test(x.placeholder || ''))
      set(amtI, '0.1')
    }, EXPECTED_ADDRESS)
    await home.evaluate(() => document.querySelector('#dotrs .btns button.blue')?.click())
    await sleep(1000)
    const t = await bodyText(home)
    await shot(home, 'onchain-08-self-refused')
    assert(/cannot transfer to yourself/i.test(t), 'self-transfer refused with the rule', t.slice(0, 300))
    const logs = (await stoLocalGet(home, 'trslogs')) || []
    assert(logs.length === logsBefore, 'no new log written for the refused self-transfer',
      `before=${logsBefore} after=${logs.length}`)
    assert(!(logs[0] && logs[0].to === EXPECTED_ADDRESS && logs[0].type === 'HAC'),
      'newest log is not the refused self-transfer', JSON.stringify(logs[0]).slice(0, 200))
    await home.evaluate(() => document.querySelector('#dotrs .pchead button.icbtn[title="Back"]')?.click())
    await sleep(800)
  },

  async 'dotrs insufficient balance fails visibly'(browser) {
    const home = await ensureHome(browser)
    await waitBalances(home)
    const before = parseFloat((await rpcBalance()).hacash)
    await openDotrs(home)
    await waitGasFilled(home)
    await home.evaluate((to, amt) => {
      const set = (el, v) => {
        const setr = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setr.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const boxes = [...document.querySelectorAll('#dotrs .ipw input')].filter((x) => x.getBoundingClientRect().width > 4)
      set(boxes[0], to)
      const amtI = boxes.find((x) => /HAC amount/i.test(x.placeholder || ''))
      set(amtI, amt)
    }, RECIPIENT, '3000000')
    await dotrsTransfer(home)
    // 错误提示是瞬态的（3s 自动隐藏）：装一个 MutationObserver 记录 #wptip 文本史
    await home.evaluate(() => {
      const con = document.querySelector('#wptip .con')
      if (!con || window.__mnxTipObs) return
      window.__mnxTipHist = window.__mnxTipHist || []
      window.__mnxTipObs = new MutationObserver(() => {
        const t = (con.textContent || '').trim()
        if (t && window.__mnxTipHist[window.__mnxTipHist.length - 1] !== t) window.__mnxTipHist.push(t)
      })
      window.__mnxTipObs.observe(con, { childList: true, characterData: true, subtree: true })
    })
    await confirmWpcfm(home)
    let tips = []
    for (let i = 0; i < 30; i++) {
      tips = await home.evaluate(() => window.__mnxTipHist || []).catch(() => [])
      if (tips.some((x) => /insufficient/i.test(x))) break
      await sleep(800)
    }
    await shot(home, 'onchain-09-insufficient')
    assert(tips.some((x) => /insufficient|not enough/i.test(x)),
      'insufficient balance error surfaced (tip history)', JSON.stringify(tips).slice(0, 400))
    const after = parseFloat((await rpcBalance()).hacash)
    assert(Math.abs(after - before) < 1e-9, 'balance unchanged by the failed transfer', `${before} → ${after}`)
    await home.evaluate(() => document.querySelector('#dotrs .pchead button.icbtn[title="Back"]')?.click())
    await sleep(800)
  },
}
