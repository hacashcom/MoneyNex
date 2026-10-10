// test/ui/suite-reqrecall.mjs — 请求召回三件套（2026-10-10，MetaMask 对齐）：
//   1 connect 类静默：开窗不计数、不发系统通知（只有 sign* 类召回）
//   2 sign 类（signtext）开窗：召回计数 '1' + 恰一条 mnxreq- 通知；取消后双清
//   3 钱包面打开即路由到待签页并接管（MetaMask home.component 的
//     checkStatusAndNavigate 对齐）：moneynex.html 启动 → 整页替换为
//     signtext.html，旧弹窗被静默关闭（不发 cancel，请求仍活）；在接管页
//     取消 → dApp 收到 user_canceled + 通知/计数双清
// 前提：已解锁、dapp 已连接（sign 类需要授权）。工具栏图标点击本体（侧边栏
// 打开）CDP 无法模拟 —— 用「打开 moneynex.html」等价（同一页面文件）。
//
// 角标文本断言（badge === '1'）在本沙盒不可测，标记待确认：CFT 152 内核里
// chrome.action.getBadgeText 永久无数据返回（回调无参、lastError 为空；页面与
// SW 上下文同坏，setBadgeText 确认无错、getTitle 正常）——内核 bug，非产品代
// 码问题。改用 mnx_pending_sign 的 count 断言：它与角标消费同一份
// REQ_SIGN_KINDS 过滤后的待签注册表（updateRequestBadge 同源）。角标文本本身
// 的真实显示待真实浏览器人工确认（生产代码 writeBadgeVerified 带读回自愈）。
import {
  sleep, shot, assert, ensureHome, openDapp, waitReqWin, waitNoWin, waitOut,
  clickBtn, closeReqTargets, openExtPage,
} from './lib.mjs'

// 召回计数 + 通知状态（任一扩展页上下文可读）
async function recallState(page) {
  return await page.evaluate(async () => {
    const cnt = await new Promise((res) => {
      try {
        chrome.runtime.sendMessage({ action: 'mnx_pending_sign' }, (r) => {
          res(chrome.runtime.lastError ? null : (r || null))
        })
      } catch (e) { res(null) }
    })
    const ns = await chrome.notifications.getAll()
    const ids = Object.keys(ns).filter((x) => x.indexOf('mnxreq-') == 0)
    return { count: cnt ? cnt.count : -1, url: (cnt && cnt.url) || '', notifs: ids }
  })
}

// 稳定读取器：wallet home 页在存在待签请求时会被启动钩子重定向走（这正是被测
// 行为），不能当读取器用。connectedsites.html 不打包含启动钩子的 index/index.js，
// 是稳定的扩展页上下文。
async function openReader(browser) {
  const r = await openExtPage(browser, 'connectedsites.html')
  return r
}

// 撤销全部连接授权（case 1 的前提：connect 要真的开窗，必须先处于未连接态）
async function revokeAll(browser) {
  const home = await ensureHome(browser)
  await home.evaluate(async () => { await chrome.storage.local.remove('connect_sites') })
  await sleep(400)
}

export const cases = {

  async 'connect window stays silent: no recall count, no notification'(browser) {
    await revokeAll(browser)
    const reader = await openReader(browser)
    // 先清残留请求窗（关闭路径 = 取消 = 通知/计数一并自清），再读基线
    await closeReqTargets(browser)
    await sleep(800)
    let st = await recallState(reader)
    assert(st.count === 0 && st.notifs.length === 0,
      'baseline has no pending recall and no notifications', JSON.stringify(st))
    const dapp = await openDapp(browser)
    await dapp.evaluate(() => document.getElementById('b-connect').click())
    const cw = await waitReqWin(browser, 'connect')
    await sleep(1200) // 角标/注册表写入为异步
    st = await recallState(reader)
    assert(st.count === 0, 'connect window adds no pending-sign recall', JSON.stringify(st))
    assert(st.notifs.length === 0, 'connect window fires no OS notification', JSON.stringify(st.notifs))
    await shot(cw, 'reqrecall-01-connect-silent')
    // 批准收尾：恢复基线连接态（下游套件依赖）
    await clickBtn(cw, 'blue')
    await waitOut(dapp, 'out-connect', 20000).catch(() => {})
    await waitNoWin(browser, 'connect', 15000)
    await sleep(600)
    st = await recallState(reader)
    assert(st.count === 0 && st.notifs.length === 0,
      'approval leaves no recall artifacts', JSON.stringify(st))
    await reader.close().catch(() => {})
  },

  async 'sign request raises recall count + notification; cancel clears both'(browser) {
    const reader = await openReader(browser)
    const dapp = await openDapp(browser)
    await closeReqTargets(browser)
    await dapp.evaluate(() => document.getElementById('b-signtext').click())
    const sw = await waitReqWin(browser, 'signtext')
    await sleep(1500)
    let st = await recallState(reader)
    assert(st.count === 1, 'sign window raises pending-sign count to 1', JSON.stringify(st))
    assert(st.notifs.length === 1, 'sign window fires exactly one OS notification', JSON.stringify(st.notifs))
    await shot(sw, 'reqrecall-02-sign-recalled')
    await clickBtn(sw, 'cancel')
    await waitOut(dapp, 'out-signtext', 20000)
    await waitNoWin(browser, 'signtext', 15000)
    await sleep(600)
    st = await recallState(reader)
    assert(st.count === 0 && st.notifs.length === 0,
      'cancel clears recall count and notification', JSON.stringify(st))
    await reader.close().catch(() => {})
  },

  async 'wallet surface routes to the pending sign page and takes it over'(browser) {
    const dapp = await openDapp(browser)
    await closeReqTargets(browser)
    await dapp.evaluate(() => document.getElementById('b-signtext').click())
    const sw = await waitReqWin(browser, 'signtext')
    await sleep(800)
    // 「点击工具栏图标」的等价物：打开钱包面（侧边栏内容即 moneynex.html）
    const surf = await openExtPage(browser, 'moneynex.html')
    let routed = false
    for (let i = 0; i < 25 && !routed; i++) {
      await sleep(400)
      routed = (surf.url() || '').includes('/popup/signtext.html')
    }
    assert(routed, 'wallet surface redirects to the pending sign page', surf.url())
    // 接管（mnx_req_takeover）：旧弹窗静默关闭——dApp 此刻必须还收不到任何应答
    let took = false
    for (let i = 0; i < 20 && !took; i++) { await sleep(400); took = sw.isClosed() }
    assert(took, 'takeover silently closes the old popup window', 'old window still open')
    const early = await waitOut(dapp, 'out-signtext', 1200).catch(() => '')
    assert(!early, 'takeover delivers no premature cancel/reply to the dApp', String(early).slice(0, 200))
    const reader = await openReader(browser)
    await sleep(1200)
    let st = await recallState(reader)
    assert(st.count === 1, 'pending request still counts after takeover', JSON.stringify(st))
    assert(st.notifs.length === 1, 'recall notification survives the takeover', JSON.stringify(st))
    // 在接管页取消 → 正常应答取消 + 双清 + 回退钱包面
    await clickBtn(surf, 'cancel')
    const out = await waitOut(dapp, 'out-signtext', 20000).catch(() => '')
    assert(/reject|cancel/i.test(out), 'routed page cancel reaches the dApp', String(out).slice(0, 200))
    await waitNoWin(browser, 'signtext', 15000)
    await sleep(800)
    st = await recallState(reader)
    assert(st.count === 0 && st.notifs.length === 0,
      'answering the routed page clears count and notification', JSON.stringify(st))
    await shot(surf, 'reqrecall-03-after-answer')
    await reader.close().catch(() => {})
  },
}
