// test/ui/suite-accounts.mjs — 账号管理功能簇：
//   acinf：查看私钥需过密码框（123456 账户的 privkey == SHA256("123456")，公开测试值）、
//          复制按钮、添加第二个账户后删除账户、最后一个账户（无删除入口，UI 层拒删）。
// 前提：已解锁（run-all 先 unlock）。链不强制（余额非断言点）。
import {
  sleep, bodyText, shot, assert, clickByText, ensureHome, waitBalances,
  unlockWallet, setInputValue, stoSyncGet, menuClick, confirmWpass, confirmWpcfm,
  PW, EXPECTED_ADDRESS,
} from './lib.mjs'
import { createHash } from 'node:crypto'

const SHA256_123456 = createHash('sha256').update('123456').digest('hex') // 公开测试值

// 首页添加新账户：⋮ → donewacc 实际是「Account details」下的入口？
// home.vue.js donewacc 由账号切换菜单触发（adrswct 弹层），找到入口后走 init(force) 的
// Import 表单 → 导入口令 → 直接入库（newmode：无 setpass/backup）。
async function addAccountByPassphrase(home, passphrase) {
  await home.evaluate(() => document.querySelector('h1.btn.adrs-btn')?.click())
  await sleep(700)
  const clicked = await home.evaluate(() => {
    const el = [...document.querySelectorAll('.popmenu.acctmenu li, .popmenu.acctmenu .item, .popmenu.acctmenu a, .popmenu.acctmenu button')]
      .find((x) => /add|create|import/i.test((x.innerText || x.title || '').trim()))
    if (!el) return false
    el.click(); return true
  }).catch(() => false)
  assert(clicked, 'add-account entry found in the account switcher')
  await sleep(1200)
  // init(force) 视图：Import 标签 → 填口令 → Import wallet
  for (let i = 0; i < 12; i++) {
    const hasForm = await home.evaluate(() =>
      !!document.querySelector('.ipt textarea, .p2 textarea, #init textarea')).catch(() => false)
    const t = await bodyText(home)
    if (hasForm || /import/i.test(t)) break
    await sleep(500)
  }
  const switched = await home.evaluate(() => {
    const el = [...document.querySelectorAll('#init .swts .swt')]
      .find((x) => /^Import$/i.test((x.innerText || '').trim()))
    if (!el) return false
    el.click(); return true
  }).catch(() => false)
  if (switched) await sleep(900)
  await sleep(300)
  const filled = await home.evaluate((v) => {
    const el = document.querySelector('.ipt textarea, .p2 textarea, #init textarea')
    if (!el) return false
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, passphrase).catch(() => false)
  assert(filled, 'import form filled for the new account')
  await clickByText(home, 'Import wallet', '#init')
  await sleep(1800)
}

export const cases = {
  async 'acinf: show private key requires the password'(browser) {
    const home = await unlockWallet(browser)
    await waitBalances(home)
    await menuClick(home, 'Account details')
    await sleep(1300)
    let t = await bodyText(home)
    await shot(home, 'accounts-01-acinf')
    assert(/Scan to send/i.test(t), 'acinf shows the QR view first', t.slice(0, 200))

    // Show private key → wpass 密码框；先试过短密码，再给错密码
    await home.evaluate(() => [...document.querySelectorAll('#acinf button')]
      .find((x) => /show private key/i.test(x.innerText || ''))?.click())
    await sleep(700)
    await shot(home, 'accounts-02-wpass')
    t = await bodyText(home)
    assert(/confirm password/i.test(t), 'password dialog opened', t.slice(0, 200))
    await confirmWpass(home, 'short')
    await sleep(800)
    t = await bodyText(home)
    assert(/use at least 8 characters/i.test(t), 'too-short password refused by the dialog rule', t.slice(0, 300))
    await confirmWpass(home, 'WrongPassword99')
    await sleep(900)
    t = await bodyText(home)
    assert(/wrong password/i.test(t), 'wrong password refused', t.slice(0, 300))

    // 正确密码 → 私钥展示（公开测试值：SHA256("123456")）
    await home.evaluate(() => [...document.querySelectorAll('#acinf button')]
      .find((x) => /show private key/i.test(x.innerText || ''))?.click())
    await sleep(700)
    await confirmWpass(home, PW)
    await sleep(1000)
    const pvk = await home.evaluate(() =>
      (document.querySelector('#acinf .pvky textarea') || {}).value || '')
    await shot(home, 'accounts-03-privkey')
    assert(pvk === SHA256_123456, 'private key shown equals the public test value',
      `got ${pvk.slice(0, 12)}… want ${SHA256_123456.slice(0, 12)}…`)
    t = await bodyText(home)
    assert(/never share your private key/i.test(t), 'private key warning rendered', t.slice(0, 300))

    // 复制按钮（toast 证据；剪贴板内容在后台页不可直接断言）
    await home.evaluate(() => document.querySelector('#acinf .pvky a.cp')?.click())
    await sleep(700)
    t = await bodyText(home)
    assert(/copied/i.test(t), 'copy private key tipped', t.slice(0, 300))

    await home.evaluate(() => document.querySelector('#acinf .pchead button.icbtn[title="Back"]')?.click())
    await sleep(900)
  },

  async 'accounts: add second account, remove it, last account undeletable'(browser) {
    const home = await ensureHome(browser)
    await waitBalances(home)

    // 添加第二个账户（口令导入，newmode：无备份/密码步骤，直接入库并切换）
    await addAccountByPassphrase(home, 'testacct8888')
    for (let i = 0; i < 20; i++) {
      const t = await bodyText(home)
      if (!/1MzNY1oA3/.test(t) && /Scan to send|Assets|HAC/.test(t)) break
      await sleep(700)
    }
    let accs = await stoSyncGet(home, 'accounts')
    const secondAddr = await stoSyncGet(home, 'current_account')
    assert(secondAddr && secondAddr !== EXPECTED_ADDRESS, 'new account became current', String(secondAddr))
    await shot(home, 'accounts-04-second')

    // acinf：当前（第二个）账户可删除
    await menuClick(home, 'Account details')
    await sleep(1300)
    let t = await bodyText(home)
    assert(/remove account/i.test(t), 'remove button rendered with 2 accounts', t.slice(0, 200))
    await home.evaluate(() => [...document.querySelectorAll('#acinf button')]
      .find((x) => /remove account/i.test(x.innerText || ''))?.click())
    await sleep(700)
    await confirmWpcfm(home)   // 备份确认（Backed up）
    await sleep(500)
    await confirmWpass(home, PW) // 密码确认
    await sleep(1500)
    // 删除后路由回主页，当前账户回落为 genesis 账户
    accs = await stoSyncGet(home, 'accounts')
    const cur = await stoSyncGet(home, 'current_account')
    await shot(home, 'accounts-05-after-remove')
    assert(cur === EXPECTED_ADDRESS, 'current falls back to the genesis account after removal', String(cur))
    assert(!accs || !accs[secondAddr], 'removed account gone from storage')

    // 最后一个账户：无删除入口（v-if adrn>1）+ 存储层兜底语义
    await menuClick(home, 'Account details')
    await sleep(1300)
    t = await bodyText(home)
    const hasRemove = await home.evaluate(() =>
      !![...document.querySelectorAll('#acinf button')].find((x) => /remove account/i.test(x.innerText || '')))
    await shot(home, 'accounts-06-last-undeletable')
    assert(!hasRemove, 'last account has no remove entry', t.slice(0, 200))
    accs = await stoSyncGet(home, 'accounts')
    assert(accs && accs[EXPECTED_ADDRESS], 'genesis account still in storage')

    await home.evaluate(() => document.querySelector('#acinf .pchead button.icbtn[title="Back"]')?.click())
    await sleep(900)
  },
}
