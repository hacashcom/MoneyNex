// test/ui/suite-settings.mjs — 设置类功能簇：
//   RPC node 覆盖（非法 URL 拒绝 / 保存生效 / 重置默认）
//   网络管理全流程（chains：添加 → chainform 校验 → 编辑 → 切换 → 删除 → 主网不可删）
// 前提：已解锁（run-all 先 unlock）；本地链在线（RPC 保存后余额刷新依赖）。
import {
  sleep, bodyText, shot, assert, clickByText, ensureHome, waitBalances,
  unlockWallet, setInputValue, stoLocalGet, menuClick, confirmWpcfm,
} from './lib.mjs'

const { HACASH_RPC } = await import('./lib.mjs')

// 打开 RPC 设置对话框
async function openRpcDialog(home) {
  await menuClick(home, '^RPC node$')
  for (let i = 0; i < 10; i++) {
    if (await home.evaluate(() => !!document.querySelector('.rpcsg input')?.getBoundingClientRect().width)) return
    await sleep(300)
  }
  throw new Error('rpc dialog never opened')
}
const rpcDialogBtn = (home, label) => home.evaluate((label) => {
  const b = [...document.querySelectorAll('.rpcsg .btns button.mid')]
    .find((x) => (x.innerText || '').trim() === label)
  if (!b) return false
  b.click(); return true
}, label)

// chainform：按序填输入（0=Chain ID 1=Name 2=RPC），点 Save
const chainformFill = (home, { id, name, rpc }) => home.evaluate(({ id, name, rpc }) => {
  const inputs = [...document.querySelectorAll('#chainform .chnfrm .item input')]
  const set = (el, v) => {
    if (v === undefined) return
    const setr = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setr.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(inputs[0], id); set(inputs[1], name); set(inputs[2], rpc)
}, { id, name, rpc })
const chainformSave = (home) => home.evaluate(() => {
  const b = document.querySelector('#chainform .btns button.blue')
  if (!b) return false
  b.click(); return true
})

// chains 列表里对某网络行执行操作（按按钮文本 Switch/Edit/Delete）
const chainsAction = (home, name, label) => home.evaluate((name, label) => {
  const li = [...document.querySelectorAll('#chains .chlist li')]
    .find((x) => (x.innerText || '').includes(name))
  if (!li) return false
  const a = [...li.querySelectorAll('.btns a')]
    .find((x) => (x.innerText || '').trim().toLowerCase() === label.toLowerCase())
  if (!a) return false
  a.click(); return true
}, name, label)

export const cases = {
  async 'rpc override: invalid URL rejected, valid saved, reset works'(browser) {
    const home = await unlockWallet(browser)
    await waitBalances(home)

    // 非法 URL：保存被拒（tip 提示 + 对话框不关 + storage 不变）
    await openRpcDialog(home)
    await setInputValue(home, '.rpcsg input', 'not-a-url')
    await shot(home, 'settings-01-rpc-invalid')
    assert(await rpcDialogBtn(home, 'Save'), 'save clicked')
    await sleep(900)
    let t = await bodyText(home)
    const stillOpen = await home.evaluate(() => !!document.querySelector('.rpcsg input')?.getBoundingClientRect().width)
    assert(/must start with http/i.test(t), 'invalid RPC URL rejected with the rule', t.slice(0, 300))
    assert(stillOpen, 'dialog stays open on invalid URL')
    assert((await stoLocalGet(home, 'mnx_fullnode_url')) !== 'not-a-url', 'override not saved for invalid URL')

    // 合法 URL：保存生效（storage == 该值），对话框关闭
    await setInputValue(home, '.rpcsg input', HACASH_RPC)
    assert(await rpcDialogBtn(home, 'Save'), 'save clicked (valid)')
    await sleep(900)
    t = await bodyText(home)
    assert(/RPC node saved/i.test(t), 'save confirmed by tip', t.slice(0, 300))
    assert(await stoLocalGet(home, 'mnx_fullnode_url') === HACASH_RPC, 'override persisted to mnx_fullnode_url')
    await waitBalances(home) // 保存后立即用新节点刷新余额（仍指向本地链，应正常）

    // 重置默认：override 清空，余额仍可加载
    await openRpcDialog(home)
    assert(await rpcDialogBtn(home, 'Use default'), 'use-default clicked')
    await sleep(900)
    t = await bodyText(home)
    assert(/reset to default/i.test(t), 'reset confirmed by tip', t.slice(0, 300))
    const saved = await stoLocalGet(home, 'mnx_fullnode_url')
    assert(saved === '' || saved == null, 'override cleared after reset', String(saved))
    await waitBalances(home)
    await shot(home, 'settings-02-rpc-reset')
  },

  async 'networks: chainform validation blocks bad input'(browser) {
    const home = await ensureHome(browser)
    await menuClick(home, 'Networks')
    await sleep(1100)
    let t = await bodyText(home)
    assert(/Mainnet/i.test(t), 'chains view lists Mainnet', t.slice(0, 200))
    await shot(home, 'settings-03-chains')

    await clickByText(home, 'Add Network')
    for (let i = 0; i < 10; i++) {
      if (await home.evaluate(() => !!document.querySelector('#chainform .chnfrm .item input')?.getBoundingClientRect().width)) break
      await sleep(300)
    }

    // 非法 ID
    await chainformFill(home, { id: 'abc', rpc: 'http://127.0.0.1:1' })
    await chainformSave(home)
    await sleep(700)
    t = await bodyText(home)
    await shot(home, 'settings-04-chainform-badid')
    assert(/Invalid Chain ID/i.test(t), 'invalid chain id rejected', t.slice(0, 300))

    // 重复主网
    await chainformFill(home, { id: '0', rpc: 'http://127.0.0.1:1' })
    await chainformSave(home)
    await sleep(700)
    t = await bodyText(home)
    assert(/Mainnet already exists/i.test(t), 'duplicate mainnet rejected', t.slice(0, 300))

    // RPC 必填
    await chainformFill(home, { id: '7', rpc: '' })
    await chainformSave(home)
    await sleep(700)
    t = await bodyText(home)
    assert(/RPC URL is required/i.test(t), 'empty rpc rejected', t.slice(0, 300))

    // RPC 协议
    await chainformFill(home, { rpc: '127.0.0.1:9999' })
    await chainformSave(home)
    await sleep(700)
    t = await bodyText(home)
    await shot(home, 'settings-05-chainform-badrpc')
    assert(/RPC URL must start with/i.test(t), 'rpc without protocol rejected', t.slice(0, 300))

    // 返回（不保存）
    await home.evaluate(() => document.querySelector('#chainform .pchead button.icbtn[title="Back"]')?.click())
    await sleep(800)
    const cfgs = await stoLocalGet(home, 'chain_configs')
    assert(!(cfgs && cfgs['7']), 'no chain 7 saved after validation-only session')
  },

  async 'networks: add → edit → switch → delete → mainnet undeletable'(browser) {
    const home = await ensureHome(browser)
    // 基线：记录当前网络（删除被切换网络前先切回，保持套件间环境一致）
    const baselineChain = String(await stoLocalGet(home, 'current_chain_id') ?? '0')
    await menuClick(home, 'Networks')
    await sleep(1100)
    await clickByText(home, 'Add Network')
    for (let i = 0; i < 10; i++) {
      if (await home.evaluate(() => !!document.querySelector('#chainform .chnfrm .item input')?.getBoundingClientRect().width)) break
      await sleep(300)
    }

    // 添加 id=7
    await chainformFill(home, { id: '7', name: 'Test Net Seven', rpc: HACASH_RPC })
    await shot(home, 'settings-06-chainform-filled')
    await chainformSave(home)
    await sleep(1100)
    let t = await bodyText(home)
    assert(/Network saved/i.test(t) || /Test Net Seven/.test(t), 'chain 7 saved', t.slice(0, 300))
    let cfgs = await stoLocalGet(home, 'chain_configs')
    assert(cfgs && cfgs['7'] && cfgs['7'].name === 'Test Net Seven', 'chain_configs[7] persisted', JSON.stringify(cfgs && cfgs['7']))

    // 编辑：改名
    assert(await chainsAction(home, 'Test Net Seven', 'Edit'), 'edit clicked')
    await sleep(900)
    await home.evaluate(() => {
      const nm = document.querySelectorAll('#chainform .chnfrm .item input')[1]
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(nm, 'Test Net 7B'); nm.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await chainformSave(home)
    await sleep(1100)
    cfgs = await stoLocalGet(home, 'chain_configs')
    assert(cfgs && cfgs['7'] && cfgs['7'].name === 'Test Net 7B', 'chain 7 renamed by edit', JSON.stringify(cfgs && cfgs['7']))

    // 切换到 7（wpcfm 确认）
    assert(await chainsAction(home, 'Test Net 7B', 'Switch'), 'switch clicked')
    await sleep(700)
    await shot(home, 'settings-07-switch-cfm')
    await confirmWpcfm(home)
    await sleep(1100)
    assert(String(await stoLocalGet(home, 'current_chain_id')) === '7', 'current_chain_id switched to 7',
      String(await stoLocalGet(home, 'current_chain_id')))

    // 切回基线网络，再删除 7（红色确认；非当前网络删除不触发回落）
    const baselineName = baselineChain === '0' ? 'Mainnet' : `ID: ${baselineChain}`
    assert(await chainsAction(home, baselineName, 'Switch'), 'switch back to baseline clicked')
    await sleep(700)
    await confirmWpcfm(home)
    await sleep(1100)
    assert(String(await stoLocalGet(home, 'current_chain_id')) === baselineChain, 'current_chain_id restored to baseline',
      String(await stoLocalGet(home, 'current_chain_id')))

    assert(await chainsAction(home, 'Test Net 7B', 'Delete'), 'delete clicked')
    await sleep(700)
    await confirmWpcfm(home)
    await sleep(1100)
    t = await bodyText(home)
    assert(/Network deleted/i.test(t), 'delete confirmed by tip', t.slice(0, 300))
    cfgs = await stoLocalGet(home, 'chain_configs')
    assert(!(cfgs && cfgs['7']), 'chain_configs[7] removed')
    assert(String(await stoLocalGet(home, 'current_chain_id')) === baselineChain, 'current network unchanged by delete',
      String(await stoLocalGet(home, 'current_chain_id')))
    await shot(home, 'settings-08-after-delete')

    // 主网不可删（模板 v-if c.id!=0：主网行根本没有 Delete 按钮）
    const mainnetDel = await home.evaluate(() => {
      const li = [...document.querySelectorAll('#chains .chlist li')].find((x) => (x.innerText || '').includes('Mainnet'))
      return li ? !!li.querySelector('.btns a.red') : null
    })
    assert(mainnetDel === false, 'mainnet row renders no delete action', String(mainnetDel))
    cfgs = await stoLocalGet(home, 'chain_configs')
    assert(cfgs && cfgs['0'], 'mainnet config still present')

    // 返回主页收尾
    await home.evaluate(() => document.querySelector('#chains .pchead button.icbtn[title="Back"]')?.click())
    await sleep(900)
  },
}
