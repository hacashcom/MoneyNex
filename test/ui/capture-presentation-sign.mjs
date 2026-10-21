import './envboot.mjs'
import { getBrowser, unlockWallet, openDapp, waitReqWin, sleep, shot, waitNoWin, EXT } from './lib.mjs'

const browser = await getBrowser()
await unlockWallet(browser)
// close any stray signtx windows from earlier attempts
for (const p of await browser.pages()) {
  const url = p.url().catch ? '' : ''
  const u = await Promise.resolve(p.url()).catch(() => '')
  if (u.startsWith(`${EXT}/popup/signtx.html`)) await p.close().catch(() => {})
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
if (!sw) {
  const out = await dapp.evaluate(() => (document.getElementById('out-signtx') || {}).textContent || '(none)')
  console.log('out-signtx:', out.slice(0, 400))
  throw new Error('signtx window never appeared')
}
await sleep(3500)
const text = await sw.evaluate(() => document.body.innerText)
console.log('===== SIGN WINDOW (multi-mainnet preset) =====')
console.log(text.split('\n').slice(0, 40).join('\n'))
await sw.setViewport({ width: 355, height: 720 })
await sleep(300)
const signOverflow = await sw.evaluate(() => ({
  width: innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  offenders: [...document.querySelectorAll('.txmeta,.txd,.txfee,.sgck')]
    .filter(el => el.getBoundingClientRect().right > innerWidth + 1)
    .map(el => ({ className: el.className, rect: el.getBoundingClientRect().toJSON(), parent: el.parentElement?.getBoundingClientRect().toJSON() })),
}))
if (signOverflow.scrollWidth > signOverflow.width + 1 || signOverflow.offenders.length) throw new Error(`Sign narrow-window overflow: ${JSON.stringify(signOverflow)}`)
await shot(sw, 'presentation-pipeline-sign-narrow', { width: 355, height: 720 })
await sw.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /cancel/i.test(x.innerText)); if (b) b.click() }).catch(() => {})
await waitNoWin(browser, 'signtx').catch(() => {})
console.log('narrow-window overflow check passed; screenshot: artifacts/presentation-pipeline-sign-narrow.png')
process.exit(0)
