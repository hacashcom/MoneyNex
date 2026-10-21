import './envboot.mjs'
import { getBrowser, unlockWallet, openDapp, waitReqWin, sleep, shot, waitNoWin, EXT } from './lib.mjs'

const browser = await getBrowser()
await unlockWallet(browser)
for (const p of await browser.pages()) {
  const u = await Promise.resolve(p.url()).catch(() => '')
  if (u.startsWith(`${EXT}/popup/signtx.html`) || u.startsWith(`${EXT}/popup/actionview.html`)) await p.close().catch(() => {})
}
const dapp = await openDapp(browser)
await dapp.evaluate(() => {
  document.getElementById('i-stx-review-preset').value = 'multi-mainnet'
  document.getElementById('b-stx-review').click()
})
let sw = null
for (let i = 0; i < 5 && !sw; i++) {
  sw = await waitReqWin(browser, 'signtx').catch(() => null)
  if (!sw) await sleep(1500)
}
if (!sw) throw new Error('signtx window never appeared')
await sleep(2500)
await sw.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^details$/i.test((x.innerText || '').trim()))
  if (b) b.click()
})
let av = null
for (let i = 0; i < 10 && !av; i++) {
  for (const p of await browser.pages()) {
    const u = await Promise.resolve(p.url()).catch(() => '')
    if (u.startsWith(`${EXT}/popup/actionview.html`)) { av = p }
  }
  if (!av) await sleep(700)
}
if (!av) throw new Error('actionview window never appeared')
await sleep(2500)
const text = await av.evaluate(() => document.body.innerText)
console.log('===== ACTIONVIEW (Details) =====')
console.log(text.split('\n').slice(0, 46).join('\n'))
await av.setViewport({ width: 355, height: 720 })
await sleep(300)
const detailsOverflow = await av.evaluate(() => ({
  width: innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  visibleMaxRight: Math.max(innerWidth, ...[...document.querySelectorAll('body *')]
    .filter(el => !el.closest('.hide, .prep:not(.active)'))
    .map(el => el.getBoundingClientRect().right)),
  offenders: [...document.querySelectorAll('.avmeta,.avmrow,.avacts,.avact,.avdet')]
    .filter(el => el.getBoundingClientRect().right > innerWidth + 1)
    .map(el => el.className),
  wideNodes: [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.hide, .prep:not(.active)'))
    .slice(0, 12)
    .map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right, text: (el.innerText || '').slice(0, 80) })),
}))
if (detailsOverflow.visibleMaxRight > detailsOverflow.width + 1 || detailsOverflow.offenders.length) throw new Error(`Details narrow-window overflow: ${JSON.stringify(detailsOverflow)}`)
await shot(av, 'presentation-pipeline-details-narrow', { width: 355, height: 720 })
// cancel the sign window to clean up
await sw.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /cancel/i.test(x.innerText)); if (b) b.click() }).catch(() => {})
await waitNoWin(browser, 'signtx').catch(() => {})
console.log('narrow-window overflow check passed; screenshot: artifacts/presentation-pipeline-details-narrow.png')
process.exit(0)
