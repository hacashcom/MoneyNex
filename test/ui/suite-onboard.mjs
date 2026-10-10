// test/ui/suite-onboard.mjs — 板载/一次性 profile 功能簇（在 disposable 沙盒上运行）：
//   熵收集流程、创建钱包（备份确认 + 密码规则）、doexit 三重确认重置、
//   导入 64-hex 私钥、导入 BIP39 助记词（合法/校验和错）、口令导入校验（<6 位/非法字符）、
//   锁定/解锁循环。
// 运行方式（由 run-all 全量编排，或手工）：
//   bash test/ui/provision-once.sh && TEST_INSTANCE_ID=mnxui-once node test/ui/run-all.mjs suite-onboard
// 注意：本套件不做链 preflight（无链也能跑）；每阶段以 doexit 重置开场保证互不污染。
import {
  getBrowser, sleep, bodyText, shot, assert, clickByText, fillVisiblePasswords,
  setInputValue, confirmWpcfm, confirmWpass, menuClick, stoSyncGet, PW, EXT, VP,
} from './lib.mjs'
import { createHash } from 'node:crypto'

const SHA256_123456 = createHash('sha256').update('123456').digest('hex') // 公开测试值
const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const BAD_CHECKSUM_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'

// 熵收集：合成 mousemove（MoneyNex 只计坐标，不要求 isTrusted）
async function handleEntropy(page) {
  for (let round = 0; round < 24; round++) {
    const t = await bodyText(page)
    if (!/move your mouse/i.test(t)) return
    await page.evaluate(() => {
      const el = document.querySelector('.container') || document.body
      const q = el.getBoundingClientRect()
      for (let i = 0; i < 500; i++) {
        el.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: q.x + ((i * 37) % Math.max(40, q.width - 16)),
          clientY: q.y + ((i * 71) % Math.max(40, q.height - 16)),
        }))
      }
    })
    await sleep(700)
  }
  throw new Error('entropy never completed')
}

async function openOnceHome(browser) {
  const pages = await browser.pages()
  let page = pages.find((p) => p.url().includes('chrome-extension://') && p.url().includes('moneynex.html'))
  if (!page) {
    page = pages.length ? pages[0] : await browser.newPage()
    await page.setViewport(VP)
    await page.goto(`${EXT}/popup/moneynex.html`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  }
  await sleep(1200)
  return page
}

// 到达初始 Create/Import 界面（fresh 或已重置）
async function reachInit(page) {
  for (let i = 0; i < 30; i++) {
    const booted = await page.evaluate(() =>
      !document.getElementById('boot') || document.getElementById('boot').style.display === 'none').catch(() => false)
    if (booted) break
    await sleep(500)
  }
  await handleEntropy(page)
  await sleep(600)
}

// doexit 的原生 prompt 是同步阻塞的：确认链（菜单 → wpass → wpcfm 红 → prompt）中，
// prompt 触发前必须已注册 page.once('dialog')，各 case 内联处理。

// 在 init 的 Import 标签里提交一段秘密
async function importSecret(page, secret) {
  const switched = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#init .swts .swt')]
      .find((x) => /^Import$/i.test((x.innerText || '').trim()))
    if (!el) return false
    el.click(); return true
  }).catch(() => false)
  assert(switched, 'import tab clicked')
  await sleep(900)
  await setInputValue(page, '#init textarea', secret)
  await clickByText(page, 'Import wallet', '#init')
  await sleep(1500)
}

// setpass 阶段：填两个密码框并点 OK
async function fillPasswords(page, p1, p2) {
  await fillVisiblePasswords(page, p1) // 两框同填（fillVisiblePasswords 填所有可见框）
  if (p2 !== undefined && p2 !== p1) {
    await page.evaluate((p2) => {
      const boxes = [...document.querySelectorAll('#init input[type=password]')]
        .filter((x) => x.getBoundingClientRect().width > 4)
      const second = boxes[1]
      if (!second) return false
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(second, p2)
      second.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }, p2)
  }
  await clickByText(page, '^OK$', '#init')
  await sleep(1200)
}

export const cases = {
  async 'entropy + create wallet: backup view, password rules, home'(browser) {
    let page = await openOnceHome(browser)
    await reachInit(page)
    let t = await bodyText(page)
    await shot(page, 'onboard-01-welcome')
    assert(/create\s+import/i.test(t), 'create/import tabs rendered after entropy', t.slice(0, 200))

    await clickByText(page, 'Create wallet', '#init')
    await sleep(1200)
    t = await bodyText(page)
    await shot(page, 'onboard-02-backup')
    assert(/back up your private key/i.test(t), 'backup view rendered', t.slice(0, 200))
    assert(/your new wallet address/i.test(t), 'new address shown', t.slice(0, 300))
    const pvk = await page.evaluate(() => (document.querySelector('#init .bkup textarea') || {}).value || '')
    assert(/^[0-9a-f]{64}$/.test(pvk), 'backup shows a 64-hex private key', pvk.slice(0, 20))

    await clickByText(page, '^Next$', '#init')
    await sleep(700)
    await confirmWpcfm(page) // 'Backed up'
    await sleep(700)

    // 密码规则：<8 位 / 不一致
    await fillPasswords(page, 'short')
    t = await bodyText(page)
    assert(/at least 8 characters/i.test(t), 'short password rejected', t.slice(0, 300))
    await fillPasswords(page, 'MoneyNexTest88', 'DifferentPass99')
    t = await bodyText(page)
    assert(/not macth/i.test(t), 'mismatched password rejected (source spelling)', t.slice(0, 300))
    await shot(page, 'onboard-03-passrules')

    await fillPasswords(page, PW)
    await sleep(1800)
    t = await bodyText(page)
    await shot(page, 'onboard-04-home')
    assert(/HAC|Assets|Activity/i.test(t), 'home rendered after create', t.slice(0, 200))
    const cur = await stoSyncGet(page, 'current_account')
    assert(cur && /^1[a-zA-Z0-9]{25,}$/.test(cur), 'current account saved', String(cur))
  },

  async 'doexit: triple-confirm reset returns to onboarding'(browser) {
    // prompt 是同步阻塞的：预先注册 dialog 处理器，再走菜单点击链
    const page = await openOnceHome(browser)
    page.once('dialog', (d) => { d.accept('I ACKNOWLEDGE THE RISK').catch(() => {}) })
    // 手动三连（resetWallet 内含 wpass/wpcfm；prompt 已由 once 处理器接管）
    await menuClick(page, 'Reset wallet')
    await sleep(700)
    await confirmWpass(page, PW)
    await sleep(700)
    await shot(page, 'onboard-05-exit-wpcfm')
    await confirmWpcfm(page)
    await sleep(1500)
    // doexit 清空三处 storage：随机熵也被清掉 → 先过熵屏再断言 Create/Import
    await handleEntropy(page)
    await sleep(600)
    const t = await bodyText(page)
    await shot(page, 'onboard-06-after-reset')
    assert(/create\s+import/i.test(t), 'reset returns to the create/import screen', t.slice(0, 200))
    const cur = await stoSyncGet(page, 'current_account')
    assert(!cur, 'current_account cleared by reset', String(cur))
  },

  async 'import 64-hex private key: password rules then home + lock/unlock'(browser) {
    let page = await openOnceHome(browser)
    await reachInit(page)
    await importSecret(page, SHA256_123456)
    // 导入路径：无备份视图，直接 setpass
    await fillPasswords(page, 'short')
    let t = await bodyText(page)
    assert(/at least 8 characters/i.test(t), 'import password rule enforced', t.slice(0, 300))
    await fillPasswords(page, PW)
    await sleep(1800)
    t = await bodyText(page)
    await shot(page, 'onboard-07-imported')
    assert(/1MzNY1oA3/.test(t), 'imported the genesis-funded test account', t.slice(0, 200))
    assert(await stoSyncGet(page, 'current_account') === '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9',
      'current_account is the imported address')

    // 锁定 → 解锁循环
    await menuClick(page, '^Lock wallet$')
    await sleep(1500)
    t = await bodyText(page)
    await shot(page, 'onboard-08-locked')
    assert(/welcome back/i.test(t), 'locked view rendered', t.slice(0, 200))
    await fillVisiblePasswords(page, PW)
    await clickByText(page, '^Unlock$', '#init')
    await sleep(1800)
    t = await bodyText(page)
    assert(/1MzNY1oA3/.test(t), 'unlocked back to home', t.slice(0, 200))

    // 收尾重置，给下个 case 干净现场
    page.once('dialog', (d) => { d.accept('I ACKNOWLEDGE THE RISK').catch(() => {}) })
    await menuClick(page, 'Reset wallet')
    await sleep(700)
    await confirmWpass(page, PW)
    await sleep(700)
    await confirmWpcfm(page)
    await sleep(1500)
  },

  async 'import BIP39 mnemonic: valid works, bad checksum refused'(browser) {
    let page = await openOnceHome(browser)
    await reachInit(page)
    // 合法助记词
    await importSecret(page, VALID_MNEMONIC)
    await fillPasswords(page, PW)
    await sleep(1800)
    let t = await bodyText(page)
    await shot(page, 'onboard-09-mnemonic')
    assert(/HAC|Assets|Activity/i.test(t), 'home rendered after mnemonic import', t.slice(0, 200))
    const cur = await stoSyncGet(page, 'current_account')
    assert(cur && cur !== '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9', 'mnemonic-derived account differs from the passphrase account', String(cur))

    // 重置后试校验和错的助记词
    page.once('dialog', (d) => { d.accept('I ACKNOWLEDGE THE RISK').catch(() => {}) })
    await menuClick(page, 'Reset wallet')
    await sleep(700)
    await confirmWpass(page, PW)
    await sleep(700)
    await confirmWpcfm(page)
    await sleep(1500)
    await reachInit(page)
    await importSecret(page, BAD_CHECKSUM_MNEMONIC)
    t = await bodyText(page)
    await shot(page, 'onboard-10-mnemonic-badsum')
    assert(/invalid mnemonic checksum/i.test(t), 'bad-checksum mnemonic refused', t.slice(0, 300))
    const stillInit = await page.evaluate(() => !!document.querySelector('#init textarea'))
    assert(stillInit, 'import form still shown after refusal')
  },

  async 'import passphrase validation: min length and charset'(browser) {
    const page = await openOnceHome(browser)
    await reachInit(page)
    // <6 位
    await importSecret(page, 'abc12')
    let t = await bodyText(page)
    assert(/cannot be less than 6/i.test(t), 'short passphrase refused', t.slice(0, 300))
    // 非法字符
    await setInputValue(page, '#init textarea', 'abc def?')
    await clickByText(page, 'Import wallet', '#init')
    await sleep(1200)
    t = await bodyText(page)
    await shot(page, 'onboard-11-passphrase-rules')
    assert(/unsupported characters/i.test(t), 'passphrase with unsupported characters refused', t.slice(0, 300))
    const cur = await stoSyncGet(page, 'current_account')
    assert(!cur, 'no account saved by refused imports', String(cur))
  },
}
