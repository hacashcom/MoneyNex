import './envboot.mjs'
import { getBrowser, unlockWallet, openDapp, sleep, shot, waitNoWin, EXT, DAPP_URL } from './lib.mjs'

const browser = await getBrowser()
try {
await unlockWallet(browser)
for (const page of await browser.pages()) {
  const url = await Promise.resolve(page.url()).catch(() => '')
  if (url.startsWith(`${EXT}/popup/signtx.html`) || url.startsWith(`${EXT}/popup/actionview.html`)) await page.close().catch(() => {})
}
const dapp = await openDapp(browser)
const freshDappUrl = new URL(DAPP_URL)
freshDappUrl.searchParams.set('presentation', String(Date.now()))
await dapp.goto(freshDappUrl.href, { waitUntil: 'domcontentloaded' })
await dapp.waitForFunction(() =>
  document.querySelector('#i-stx-review-preset')?.dataset.presetsReady === 'true' &&
  window.MoneyNex && typeof window.MoneyNex.signtx === 'function' &&
  (document.querySelector('#wallet-state')?.innerText || '').startsWith('MoneyNex detected — info:'),
  { timeout: 30000 },
)

const cases = [
  { key: 'large-asset-supply', sign: /9007199254740993/, details: /9007199254740993/ },
  { key: 'ast-if-depth', sign: /if-branch|if-branch select/i, details: /condition select[\s\S]*if-branch select[\s\S]*else-branch select/i },
  { key: 'pointer-from-to', sign: /bJASBXHo5SbNWJWbfACqZVNmi2j2hhCpe/, details: /address pointer/ },
  { key: 'tex-all-cells', sign: /Execute TEX cells signed by[\s\S]*cell 23/i, details: /cell 23/ },
  { key: 'inscription-type-200', sign: /type 200/i, details: /type 200/i },
  { key: 'message-layout-review', sign: /memo[\s\S]*o/i, details: /memo[\s\S]*o/i },
  { key: 'multi-mainnet', sign: /Message[\s\S]*bytes/i, details: /Message[\s\S]*bytes/i },
  { key: 'signature-status-mixed', sign: /Signature status/i, details: /Signature Status/i },
]

for (const item of cases) {
  console.log(`opening ${item.key}`)
  const expectedBody = await dapp.evaluate(async key => {
    const response = await fetch('./signtx-review-presets.json?capture=' + Date.now(), { cache: 'no-store' })
    const presets = await response.json()
    const entry = presets[key]
    return typeof entry === 'string' ? entry : entry && entry.body
  }, item.key)
  if (!expectedBody) throw new Error(`${item.key}: preset body is unavailable`)
  await dapp.evaluate(key => {
    const select = document.getElementById('i-stx-review-preset')
    if (![...select.options].some(option => option.value === key)) throw new Error(`review preset missing: ${key}`)
    select.value = key
    document.getElementById('b-stx-review').click()
  }, item.key)
  let sign = null
  for (let i = 0; i < 60 && !sign; i++) {
    sign = (await browser.pages()).find(page => page.url().startsWith(`${EXT}/popup/signtx.html`)) || null
    if (!sign) await sleep(500)
  }
  if (!sign) throw new Error(`${item.key}: Sign window did not open`)
  const signUrl = new URL(sign.url())
  if (signUrl.searchParams.get('txbody') !== expectedBody) throw new Error(`${item.key}: stale Sign window body was reused`)
  await sign.waitForFunction(() => !!document.querySelector('#sgtx .txd li'), { timeout: 30000 })
  await sleep(500)
  let signText = await sign.evaluate(() => document.body.innerText)
  if (!item.sign.test(signText)) throw new Error(`${item.key}: Sign content assertion failed: ${signText.slice(0, 1200)}`)
  const signIndexes = await sign.$$eval('.tx-address-table .tx-addr-index', els => els.map(el => el.innerText.trim()))
  if (!signIndexes.length || signIndexes.some((value, index) => value !== `${index}:`)) throw new Error(`${item.key}: Sign address table indices are ambiguous: ${JSON.stringify(signIndexes)}`)
  if (item.key === 'signature-status-mixed') {
    const rows = await sign.$$eval('.sgck .sgr', els => els.map(el => ({ address: el.querySelector('a')?.innerText.trim(), status: el.querySelector('b')?.innerText.trim() })))
    for (const status of ['Signed', 'Invalid signature', 'Not yet']) {
      if (!rows.some(row => row.address && row.status === status)) throw new Error(`Sign signer row missing ${status}: ${JSON.stringify(rows)}`)
    }
  }
  if (item.key === 'large-asset-supply') {
    const layout = await sign.evaluate(() => {
      const action = document.querySelector('#sgtx .txd li')
      const rect = action?.getBoundingClientRect()
      const fields = [...(action?.querySelectorAll('.actfield') || [])].map(el => ({
        text: el.innerText,
        rect: el.getBoundingClientRect().toJSON(),
      }))
      const feeTop = document.querySelector('#sgtx .txfee')?.getBoundingClientRect().top
      return { rect: rect?.toJSON(), fields, feeTop }
    })
    if (layout.fields.length < 3 || layout.fields.some(field => field.rect.height < 16 || field.rect.left < layout.rect.left - 1 || field.rect.right > layout.rect.right + 1)) {
      throw new Error(`asset fields are not readable inside their action row: ${JSON.stringify(layout)}`)
    }
    if (layout.feeTop != null && layout.rect.bottom > layout.feeTop + 1) throw new Error(`asset action overlaps fee section: ${JSON.stringify(layout)}`)
    await sign.evaluate(() => document.querySelector('.gas-more > summary')?.click())
    await sign.waitForFunction(() => document.querySelector('.gas-more')?.open === true, { timeout: 5000 })
    const gasText = await sign.$eval('.txfee', el => el.innerText)
    for (const expected of ['Maximum gas charge', '0.001355 HAC', 'Decoded gas budget', '271', 'Billing size', '223 bytes', '44843049327 u232 / byte', '50000000000 u232 / byte']) {
      if (!gasText.includes(expected)) throw new Error(`expanded Sign fee/gas missing ${expected}: ${gasText}`)
    }
    await sign.evaluate(() => document.querySelector('.txfee')?.scrollIntoView({ block: 'start' }))
    await shot(sign, `${item.key}-sign-gas-narrow`, { width: 355, height: 720 })
  }
  if (item.key === 'multi-mainnet') {
    const preview = await sign.$('.txd .hexgray.clickable[data-hexid]')
    if (!preview) throw new Error('Message did not render the long HEX preview as a clickable full-payload control')
    const beforePages = new Set((await browser.pages()).map(page => page.url()))
    await preview.click()
    let hexPage = null
    for (let i = 0; i < 30 && !hexPage; i++) {
      hexPage = (await browser.pages()).find(page => page.url().startsWith('blob:') && !beforePages.has(page.url())) || null
      if (!hexPage) await sleep(300)
    }
    if (!hexPage) throw new Error('Clicking the long Message HEX preview did not open its full payload')
    const fullHex = await hexPage.evaluate(() => document.body.innerText.trim())
    if (!/^0x[0-9a-f]{130,}$/.test(fullHex) || fullHex.includes('…')) throw new Error(`long Message HEX viewer did not show the complete payload: ${fullHex.slice(0, 180)}`)
    await hexPage.close().catch(() => {})
  }
  if (item.key === 'pointer-from-to') {
    const refs = await sign.$$eval('.addrref[title]', els => els.map(el => el.title))
    if (!refs.some(value => /address pointer 2/.test(value)) || !refs.some(value => /address pointer 0/.test(value))) throw new Error('pointer Sign output lost the protocol pointer identity')
  }
  await sign.setViewport({ width: 355, height: 720 })
  await shot(sign, `presentation-${item.key}-sign-meta-narrow`, { width: 355, height: 720 })
  await sign.evaluate(() => document.querySelector('.txd li')?.scrollIntoView({ block: 'start' }))
  await sleep(200)
  const signOverflow = await sign.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  if (signOverflow.scrollWidth > signOverflow.width + 1) throw new Error(`${item.key}: Sign overflow ${JSON.stringify(signOverflow)}`)
  await shot(sign, `presentation-${item.key}-sign-narrow`, { width: 355, height: 720 })

  await sign.evaluate(() => [...document.querySelectorAll('button')].find(button => /^details$/i.test(button.innerText.trim()))?.click())
  let details = null
  for (let i = 0; i < 12 && !details; i++) {
    for (const page of await browser.pages()) {
      const url = await Promise.resolve(page.url()).catch(() => '')
      if (url.startsWith(`${EXT}/popup/actionview.html`)) { details = page; break }
    }
    if (!details) await sleep(500)
  }
  if (!details) throw new Error(`${item.key}: Details window did not open`)
  await sleep(900)
  await details.setViewport({ width: 355, height: 720 })
  const actionGroups = await details.$$eval('.avacts > .avline', els => els.map(el => ({
    children: el.children.length,
    complete: el.firstElementChild?.classList.contains('avact') && !!el.firstElementChild.querySelector('.avrow .avv') && el.firstElementChild.querySelectorAll('details.avdet').length >= 3,
  })))
  if (!actionGroups.length || actionGroups.some(group => group.children !== 1 || !group.complete)) throw new Error(`${item.key}: Details split an action across v-html containers: ${JSON.stringify(actionGroups)}`)
  await shot(details, `presentation-${item.key}-details-meta-narrow`, { width: 355, height: 720 })
  const detailsText = await details.evaluate(() => document.body.innerText)
  const detailIndexes = await details.$$eval('.av-address-table .av-address-index', els => els.map(el => el.innerText.trim()))
  if (!detailIndexes.length || detailIndexes.some((value, index) => value !== `${index}:`)) throw new Error(`${item.key}: Details address table indices are ambiguous: ${JSON.stringify(detailIndexes)}`)
  if (item.key === 'pointer-from-to') {
    const refs = await details.$$eval('.addrref[title]', els => els.map(el => el.title))
    if (!refs.some(value => /address pointer 2/.test(value)) || !refs.some(value => /address pointer 0/.test(value))) throw new Error('pointer Details output lost the protocol pointer identity')
    const addressValues = await details.$$eval('.avact .addrref a[href]', els => els.filter(el => el.href.endsWith('/address/' + el.innerText.trim())).map(el => el.innerText.trim()))
    if (!addressValues.includes('bJASBXHo5SbNWJWbfACqZVNmi2j2hhCpe') || !addressValues.includes('1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9')) throw new Error(`pointer Details must resolve to actual addresses: ${JSON.stringify(addressValues)}`)
    const sdkExpanded = await details.evaluate(() => {
      const section = [...document.querySelectorAll('.avact .avdet')]
        .find(section => /SDK description/.test(section.querySelector('summary')?.innerText || ''))
      if (!section) return false
      section.querySelector('summary')?.click()
      return section.open
    })
    if (!sdkExpanded) throw new Error('pointer Details has no expandable SDK description detail')
    const sdkDescription = await details.evaluate(() => [...document.querySelectorAll('.avact .avdet')]
      .find(section => /SDK description/.test(section.querySelector('summary')?.innerText || ''))?.querySelector('pre')?.innerText || '')
    if (!/<address pointer 2>/.test(sdkDescription) || !/<address pointer 0>/.test(sdkDescription)) throw new Error(`pointer SDK description did not preserve protocol pointer identity: ${sdkDescription}`)
  } else if (!item.details.test(detailsText)) {
    throw new Error(`${item.key}: Details content assertion failed: ${detailsText.slice(0, 1600)}`)
  }
  if (item.key === 'signature-status-mixed') {
    const rows = await details.$$eval('.sgck p', els => els.map(el => ({ address: el.querySelector('.avaddr')?.innerText.trim(), status: el.querySelector('b')?.innerText.trim() })))
    for (const status of ['Signed', 'Invalid signature', 'Not Yet']) {
      if (!rows.some(row => row.address && row.status === status)) throw new Error(`Details signer row missing ${status}: ${JSON.stringify(rows)}`)
    }
  }
  if (item.key === 'ast-if-depth' && !/0\/0\/0/.test(detailsText)) throw new Error('AST Details lost the original nested action path')
  if (item.key === 'tex-all-cells') {
    const cellRows = await details.$$eval('.actfield', els => els.length)
    if (cellRows < 23) throw new Error(`TEX Details shows only ${cellRows} cells`)
  }
  await details.evaluate(() => document.querySelector('.avact')?.scrollIntoView({ block: 'start' }))
  await sleep(200)
  const detailsOverflow = await details.evaluate(() => ({
    width: innerWidth,
    maxRight: Math.max(innerWidth, ...[...document.querySelectorAll('body *')]
      .filter(el => !el.closest('.hide, .prep:not(.active)'))
      .map(el => el.getBoundingClientRect().right)),
  }))
  if (detailsOverflow.maxRight > detailsOverflow.width + 1) throw new Error(`${item.key}: Details overflow ${JSON.stringify(detailsOverflow)}`)
  await shot(details, `presentation-${item.key}-details-narrow`, { width: 355, height: 720 })
  await details.close().catch(() => {})
  await sign.evaluate(() => document.querySelector('#sgtx .reqbtns button.cancel')?.click())
  await waitNoWin(browser, 'signtx', 15000)
  console.log(`${item.key}: Sign and Details content/overflow checks passed`)
}
} finally {
  for (const page of await browser.pages().catch(() => [])) {
    const url = await Promise.resolve(page.url()).catch(() => '')
    if (url.startsWith(`${EXT}/popup/signtx.html`)) {
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => /cancel/i.test(button.innerText))?.click()).catch(() => {})
      await page.close().catch(() => {})
    } else if (url.startsWith(`${EXT}/popup/actionview.html`)) {
      await page.close().catch(() => {})
    }
  }
  await browser.disconnect().catch(() => {})
}
