// test/ui/onboard.mjs — 全新 profile 的一次性钱包初始化（导入 genesis 资助测试账户）。
// 幂等：已板载（主页/解锁框可见）时直接退出。流程参照沙盒 mnx-setup.mjs：
// 熵收集（合成 mousemove，MoneyNex 只计坐标，不要求 isTrusted）→ Import →
// 私钥口令 123456（privkey = SHA256("123456")，公开测试值）→ 密码 MoneyNexTest88。
// 用法：node test/ui/onboard.mjs
import './envboot.mjs'
import {
  getBrowser, sleep, bodyText, shot, assert, clickByText, fillVisiblePasswords,
  EXPECTED_ADDRESS, EXT, PW, VP,
} from './lib.mjs'

const browser = await getBrowser({ quiet: false })
const pages = await browser.pages()
let page = pages.find((p) => p.url().includes('chrome-extension://') && p.url().includes('moneynex.html'))
if (!page) {
  page = (pages.length ? pages[0] : await browser.newPage())
  await page.setViewport(VP)
  await page.goto(`${EXT}/popup/moneynex.html`, { waitUntil: 'domcontentloaded' }).catch(() => {})
}
await sleep(1200)

let t = await bodyText(page)
if (/1MzNY1oA3|Unlock|password/i.test(t) && !/Create\s+Import|mouse/i.test(t)) {
  console.log('onboard: wallet already onboarded — nothing to do')
  process.exit(0)
}

// #boot 自旋等 Vue 挂载
for (let i = 0; i < 30; i++) {
  const booted = await page.evaluate(() =>
    !document.getElementById('boot') || document.getElementById('boot').style.display === 'none').catch(() => false)
  if (booted) break
  await sleep(500)
}
await sleep(1000)
await shot(page, 'onboard-01-first')

// 熵收集：合成 mousemove 流
async function handleEntropy() {
  for (let round = 0; round < 20; round++) {
    if (!/mouse/i.test(await bodyText(page))) return
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
}
await handleEntropy()
await sleep(800)
await shot(page, 'onboard-02-welcome')

for (let step = 0; step < 16; step++) {
  t = await bodyText(page)
  if (t.includes(EXPECTED_ADDRESS) || /1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9/.test(t)) break
  if (/mouse/i.test(t)) { await handleEntropy(); continue }

  const hasImportForm = await page.evaluate(() =>
    !!document.querySelector('.p2 input, .ipt input') || !!document.querySelector('textarea')).catch(() => false)
  if (/Create\s+Import/i.test(t) && !hasImportForm) {
    // 切到 Import 标签（.swt div 不在 clickByText 的选择器面里，直接点）
    const switched = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#init .swt')].find((x) => /^Import$/i.test((x.innerText || '').trim()))
      if (!el) return false
      el.click()
      return true
    }).catch(() => false)
    assert(switched, 'import tab clicked', t.slice(0, 120))
    await sleep(900)
    continue
  }
  if (/Create\s+Import/i.test(t) && hasImportForm) {
    // 导入表：0.4.x 为 .ipt 下的 textarea
    const filled = await page.evaluate((v) => {
      const el = document.querySelector('.p2 textarea, .ipt textarea, .p2 input, .ipt input')
      if (!el) return 0
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set
      set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 1
    }, '123456').catch(() => 0)
    assert(filled === 1, 'import form filled', t.slice(0, 120))
    await clickByText(page, 'Import wallet', '#init')
    await sleep(1200)
    continue
  }

  const pwCount = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=password]')].filter((x) => {
      for (let n = x; n; n = n.parentElement) { if (String(n.className).includes('hide')) return false }
      return x.getBoundingClientRect().width > 4
    }).length).catch(() => 0)
  if (pwCount > 0) {
    await fillVisiblePasswords(page, PW)
    await shot(page, 'onboard-03-password')
    await clickByText(page, 'Confirm|OK|Save|Unlock', '#init')
    await sleep(1500)
    continue
  }
  if (await (async () => { try { await clickByText(page, 'I have backed up|OK|Confirm|Next|Done', '#init'); return true } catch { return false } })()) continue
  await sleep(900)
}

t = await bodyText(page)
await shot(page, 'onboard-04-final')
assert(/1MzNY1oA3(?:kfgYi75zquj3SRUPY)?\.\.\.ztzXHzK9|1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9/.test(t),
  'onboarded with the genesis-funded test account', t.slice(0, 200))
console.log('onboard: OK')
process.exit(0)
