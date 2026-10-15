'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ctx = vm.createContext({ JSON_parse: JSON.parse, explorer_url: 'https://explorer.hacash.org', setTimeout })
vm.runInContext(fs.readFileSync(path.join(__dirname, 'crypto-js.4.1.1.js'), 'utf8'), ctx)
for (const file of ['moneynx_sdk_facade.js', 'assetamt.js', 'msglayout.js', 'moneynx_txview.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), ctx)
}
const main = '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9'
const from = 'bJASBXHo5SbNWJWbfACqZVNmi2j2hhCpe'
const asset = { kind: 19, path: '0', transfer: { from, to: main, payload: { type: 'asset', serial: '1101', atoms: '10000' } } }
ctx.mnx_asset_meta_mem = { '0': { '1101': { decimal: 2, ticket: 'HACASTLP', name: 'LP' } } }
const review = { main, actions: [asset] }
const original = JSON.stringify(review)
let text = ctx.parseTxDesc(review)[0]
assert.match(text, /Transfer <b class="amt">100<\/b> HACASTLP \(Asset #1101\) from/)
assert(text.includes(`title="${main}">1MzNY1o...</a>`))
assert(text.includes(`/address/${main}"`))
assert(text.includes(`>${from}</a>`))
assert.equal(JSON.stringify(review), original)

ctx.mnx_asset_meta_mem = {}
text = ctx.parseTxDesc(review)[0]
assert(text.includes('asset-unit-unknown'))
assert(text.includes('asset-unit-warning'))
assert(text.includes('10000'))
assert(text.includes('Decimals unknown: raw atoms, not token units'))
assert(!text.includes('HACASTLP'))

text = ctx.parseTxDesc({ main, actions: [{ kind: 1, description: `Transfer 37947332:240 HAC to ${main}` }] })[0]
assert(text.includes('Transfer <b class="amt">0.37947332</b> HAC to'))
assert(!text.includes('37947332:240'))
assert.equal(ctx.mnx_fin_to_decimal('1:240'), '0.00000001')
assert.equal(ctx.mnx_fin_to_decimal('1:248'), '1')

ctx.mnx_asset_meta_mem = { '0': { '1101': { decimal: 2, ticket: '<img src=x onerror=alert(1)>', name: '' } } }
text = ctx.parseTxDesc(review)[0]
assert(!text.includes('<img'))
assert(text.includes('&lt;img'))

const register = {
    kind: 16,
    description: 'Register asset <AST1001A>',
    json: JSON.stringify({ metadata: {
        serial: 1001,
        ticket: '0x4153543130303141',
        name: '0x416374696f6e20546f6b656e',
        issuer: main,
    } }),
}
text = ctx.parseTxDesc({ main, actions: [register] })[0]
assert.match(text, /Register asset #1001 · AST1001A · Action Token · issuer/)
assert(text.includes(`/address/${main}"`))
assert(!text.includes('Register asset &lt;AST1001A&gt;'))

const deployAddress = 'dLVr1xSixCKt2a6KC6tbjNS6yMSCF68tA'
assert.equal(ctx.mnx_contract_deploy_address(main, 233), deployAddress)
text = ctx.parseTxDesc({ main, actions: [{
    kind: 40,
    description: 'Deploy smart contract with nonce 233',
    json: JSON.stringify({ nonce: 233 }),
}] })[0]
assert(text.includes('Deploy smart contract with nonce 233'))
assert(text.includes('deployed address'))
assert(text.includes(`/address/${deployAddress}"`))
const template = fs.readFileSync(path.join(__dirname, '../popup/signtx/signtx/vue.html'), 'utf8')
assert(template.indexOf('Actions <span') < template.indexOf('Fee and gas'))
assert(template.indexOf('Fee and gas') < template.indexOf('Signature status'))
assert(!template.includes('Valid height') && !template.includes('Allowed chains'))
assert(template.includes('Main address') && template.includes('<dt>Hash</dt>'))
assert(template.includes('({{txres.timestamp}})'))
assert(template.includes('<a>{{v.address}}</a>'))
assert(!template.includes('gas-note'))
console.log('txdisplay tests ok')
