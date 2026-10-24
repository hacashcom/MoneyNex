'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ctx = vm.createContext({ JSON_parse: JSON.parse, explorer_url: 'https://explorer.hacash.org', setTimeout })
vm.runInContext(fs.readFileSync(path.join(__dirname, 'crypto-js.4.1.1.js'), 'utf8'), ctx)
for (const file of ['moneynx_sdk_facade.js', 'assetamt.js', 'msglayout.js', 'actionfacts.js', 'actiondisplay.js', 'actionrender.js', 'moneynx_txview.js', '../popup/actionview/actionview/vue.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), ctx)
}
const main = '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9'
const from = 'bJASBXHo5SbNWJWbfACqZVNmi2j2hhCpe'
const asset = { kind: 19, name: 'transfer_asset_from_to', path: '0', transfer: { from, to: main, payload: { type: 'asset', serial: '1101', atoms: '10000' } } }
ctx.mnx_asset_meta_mem = { '0': { '1101': { decimal: 2, ticket: 'HACASTLP', name: 'LP' } } }
const review = { main, actions: [asset] }
const original = JSON.stringify(review)
let text = ctx.parseTxDesc(review)[0]
assert.match(text, /Transfer <b class="amt">100<\/b> HACASTLP \(Asset #1101\) from/)
assert(text.includes(`title="${main}">1MzNY1o...</a>`))
assert(text.includes(`/address/${main}"`))
assert(text.includes(`>${from}</a>`))
assert.equal(JSON.stringify(review), original)
assert.equal(ctx.mnx_address_html(main), `<a class="addr" href="https://explorer.hacash.org/address/${main}" target="_blank" rel="noopener noreferrer" title="${main}">${main}</a>`)
assert.equal(ctx.mnx_actv_addr_html(main), `<a class="avaddr" href="https://explorer.hacash.org/address/${main}" target="_blank" title="${main}">${main}</a>`)
ctx.explorer_url = 'https://explorer.example/" onmouseover="alert(1)&x='
for (const link of [ctx.mnx_address_html(main), ctx.mnx_actv_addr_html(main)]) {
    assert(link.includes('https://explorer.example/&quot; onmouseover=&quot;alert(1)&amp;x=/address/'))
    assert(!/onmouseover="/.test(link), 'explorer URL must not inject an HTML attribute')
}
for (const scheme of ['javascript:alert(1)', 'data:text/html,alert(1)']) {
    ctx.explorer_url = scheme
    assert.equal(ctx.mnx_address_html(main), main, `${scheme} must render as address text in Sign`)
    assert.equal(ctx.mnx_address_html(main, { main, abbrev_main: true }), main, `${scheme} must keep the full address when main abbreviation is enabled`)
    assert.equal(ctx.mnx_actv_addr_html(main), `<span class="avaddr">${main}</span>`, `${scheme} must render as address text in Details`)
}
ctx.explorer_url = 'https://explorer.hacash.org'

ctx.mnx_asset_meta_mem = {}
text = ctx.parseTxDesc(review)[0]
assert(text.includes('asset-unit-unknown'))
assert(text.includes('asset-unit-warning'))
assert(text.includes('10000'))
assert(text.includes('Decimals unknown: raw atoms, not token units'))
assert(!text.includes('HACASTLP'))

// typed HAC transfer: fin payload -> exact decimal amount token (no regex rewrite)
text = ctx.parseTxDesc({ main, actions: [{ kind: 1, name: 'transfer_hac_to', transfer: { to: main, payload: { type: 'hac', amount: '37947332:240' } } }] })[0]
assert(text.includes('Transfer <b class="amt">0.37947332</b> HAC'))
assert(!text.includes('37947332:240'))
assert(text.includes('the transaction main address'))
// implied endpoints resolve through the address table when provided
text = ctx.parseTxDesc({ main, address_table: [main, from], actions: [{ kind: 1, name: 'transfer_hac_to', json: '{"kind":1,"to":1}', transfer: { payload: { type: 'hac', amount: '1:248' } } }] })[0]
assert(text.includes('to <span class="addrref" title="address pointer 1"><a'))
assert(text.includes(`/address/${from}"`))
// A pointer hidden by describe.with_json=false cannot be mistaken for an
// omitted endpoint and rendered as the primary address.
const pointerNoJson = { kind: 14, name: 'transfer_hac_from_to', transfer: { payload: { type: 'hac', amount: '1:248' } } }
const pointerNoJsonModel = ctx.mnx_action_presentation(pointerNoJson, { review: { main } })
assert.equal(pointerNoJsonModel.mode, 'verbatim')
const decoratedPointer = ctx.mnx_action_presentation({ kind: 14, name: 'transfer_hac_from_to', description: 'Transfer from <address pointer 1> to <address pointer 0>', json: '{"kind":14,"from":1,"to":0,"hacash":"bad"}', transfer: { payload: { type: 'hac' } } }, { review: { main, address_table: [main, from] } })
assert.equal(decoratedPointer.mode, 'decorate')
assert(ctx.mnx_action_line_html(decoratedPointer, 0, {}).includes(`/address/${from}"`))
assert(ctx.mnx_action_plain_text(decoratedPointer).includes('<address pointer 1> = ' + from))
const badPointer = { kind: 14, name: 'transfer_hac_from_to', json: '{"kind":14,"from":999,"to":1,"hacash":"1:248"}', transfer: { payload: { type: 'hac', amount: '1:248' } } }
const badPointerModel = ctx.mnx_action_presentation(badPointer, { review: { main, address_table: [main, from] } })
assert.equal(badPointerModel.mode, 'structured')
assert(ctx.mnx_action_plain_text(badPointerModel).includes('<invalid address reference: 999>'))
assert.equal(ctx.mnx_fin_to_decimal('1:240'), '0.00000001')
assert.equal(ctx.mnx_fin_to_decimal('1:248'), '1')

ctx.mnx_asset_meta_mem = { '0': { '1101': { decimal: 2, ticket: '<img src=x onerror=alert(1)>', name: '' } } }
text = ctx.parseTxDesc(review)[0]
assert(!text.includes('<img'))
assert(text.includes('&lt;img'))

const register = {
    kind: 16,
    name: 'asset_create',
    description: 'Register asset <AST1001A>',
    json: JSON.stringify({ protocol_cost: '1:244', metadata: {
        serial: 1001,
        supply: 1000,
        decimal: 2,
        ticket: '0x4153543130303141',
        name: '0x416374696f6e20546f6b656e',
        issuer: main,
    } }),
}
text = ctx.parseTxDesc({ main, actions: [register] })[0]
assert.match(text, /Register asset #1001/)
assert(text.includes('&quot;AST1001A&quot;') && text.includes('&quot;Action Token&quot;'))
assert(text.includes(`/address/${main}"`))
assert(!text.includes('Register asset &lt;AST1001A&gt;'))

const deployAddress = 'dLVr1xSixCKt2a6KC6tbjNS6yMSCF68tA'
assert.equal(ctx.mnx_contract_deploy_address(main, 233), deployAddress)
text = ctx.parseTxDesc({ main, actions: [{
    kind: 40,
    name: 'contract_deploy',
    description: 'Deploy smart contract: nonce 233, 0 functions, 0 libraries, 0 inherits, construct input 0 bytes',
    json: JSON.stringify({ nonce: 233 }),
}] })[0]
assert(text.includes('Deploy smart contract: nonce 233'))
assert(text.includes('deployed address'))
assert(text.includes(`/address/${deployAddress}"`))

// plain-text serializer: full addresses, no HTML, no entities, one line per action
ctx.mnx_asset_meta_mem = { '0': { '1101': { decimal: 2, ticket: 'HACASTLP', name: 'LP' } } }
const plain = ctx.mnx_txdesc_plain(review)
assert.equal(plain.length, 1)
assert(!/[<>]|&\w+;/.test(plain[0]))
assert(plain[0].includes(`from ${from} to ${main}`))
assert(plain[0].includes('Transfer 100 HACASTLP (Asset #1101)'))

// decorate mode: address styling only for provable facts, no amount conversion
text = ctx.parseTxDesc({ main, actions: [{ kind: 3, name: 'channel_close', description: `Close channel abcdabcdabcdabcdabcdabcdabcdabcd by ${main}` }] })[0]
assert(text.includes(`/address/${main}"`))
// an unrelated base58-looking word in user-free text is not linked when unprovable
text = ctx.parseTxDesc({ main, actions: [{ kind: 3, name: 'channel_close', description: 'Close channel 2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }] })[0]
assert(!text.includes('/address/'))

// verbatim fallback for unregistered kinds: escaped plain text, no links
text = ctx.parseTxDesc({ main, actions: [{ kind: 9999, description: `Future action <b> ${main}` }] })[0]
assert(text.includes('Future action &lt;b&gt;'))
assert(!text.includes('/address/'))
assert(!text.includes(`<b>${main}`))

// guard adapters from canonical JSON
text = ctx.parseTxDesc({ main, actions: [{ kind: 1044, name: 'required_signers', json: JSON.stringify({ kind: 1044, signers: [main, from] }) }] })[0]
assert(text.includes('Extra signatures required from'))
assert(text.includes(`/address/${main}"`) && text.includes(`/address/${from}"`))
text = ctx.parseTxDesc({ main, actions: [{ kind: 1043, name: 'balance_floor', json: JSON.stringify({ kind: 1043, addr: main, hacash: '12:244', satoshi: 100, diamond: 5, assets: [{ serial: 7, amount: 100 }] }) }] })[0]
assert(text.includes('Balance floor'))
assert(text.includes('0.0012 HAC'))
assert(text.includes('Asset #7'))
text = ctx.parseTxDesc({ main, actions: [{ kind: 1041, name: 'chain_allow', json: JSON.stringify({ kind: 1041, chains: [1, 2] }) }] })[0]
assert(text.includes('Allowed networks (chain IDs):'))
assert(text.includes('<code class="actid">1</code>, <code class="actid">2</code>'))

// payload adapter: message bytes + protocol boundary
text = ctx.parseTxDesc({ main, actions: [{ kind: 1025, name: 'message', json: JSON.stringify({ kind: 1025, data: '0x68656c6c6f' }) }] })[0]
assert(text.includes('Message · <b class="amt">5</b> bytes'))
assert(text.includes('&quot;hello&quot;'))

// AST children render with their SDK path under the control parent
text = ctx.parseTxDesc({ main, actions: [{ kind: 25, name: 'ast_select', description: 'Execute between 1 and 2 of 2 listed actions in order; reverted actions are skipped', children: [
    { kind: 1, name: 'transfer_hac_to', path: '0/0', transfer: { to: main, payload: { type: 'hac', amount: '1:248' } } },
    { kind: 1042, name: 'height_scope', path: '0/1', json: JSON.stringify({ kind: 1042, start: 100, end: 0 }) },
] }] })[0]
assert(text.includes('Execute between 1 and 2 of 2 listed actions'))
assert(text.includes('[0/0] Transfer <b class="amt">1</b> HAC'))
assert(text.includes('[0/1] Height scope 100 to Unlimited'))

// Asset registration uses typed canonical facts, retains a bare u64 exactly,
// and keeps SDK protocol_cost visible in the same presentation fields.
const largeSupply = {
    kind: 16, name: 'asset_create', description: 'Register Asset #2',
    json: '{"kind":16,"protocol_cost":"1:244","metadata":{"serial":2,"supply":9007199254740993,"decimal":0,"issuer":"' + main + '","ticket":"0x41535432203b206973737565722066616b65","name":"0x4c61726765"}}',
}
const assetModel = ctx.mnx_action_presentation(largeSupply, { review: { main }, asset_text: atoms => ({ text: String(atoms), unit: '', known: false }) })
assert.equal(assetModel.mode, 'structured')
assert.equal(assetModel.fields[0].tokens[0].v, '9007199254740993')
assert.equal(assetModel.fields[2].tokens[0].v, '0.0001')
const assetLine = ctx.mnx_action_line_html(assetModel, 0, {})
assert(assetLine.includes('<span class="actnum">1</span>'), 'Sign action counter has a dedicated class')
assert(assetLine.includes('class="actfield"'), 'asset facts are distinct from action counter styling')
assert(assetLine.includes('&quot;AST2 ; issuer fake&quot;'))
assert(assetLine.includes('protocol fee'))
const beforeParse = Object.keys(largeSupply).sort().join(',')
ctx.mnx_act_json(largeSupply)
assert.equal(Object.keys(largeSupply).sort().join(','), beforeParse)

// Every action with protocol_cost keeps a positive charge visible in the
// normalized Sign presentation, including SDK-description-backed contracts.
const protocolFeeActions = [
    { kind: 32, name: 'hacd_insc_push', json: '{"kind":32,"diamonds":"WTYUIA","engraved_content":"0x6869","engraved_type":2,"protocol_cost":"1:244"}' },
    { kind: 33, name: 'hacd_insc_clean', json: '{"kind":33,"diamonds":"WTYUIA","protocol_cost":"1:244"}' },
    { kind: 34, name: 'hacd_insc_edit', json: '{"kind":34,"diamond":"WTYUIA","index":0,"engraved_content":"0x6869","engraved_type":2,"protocol_cost":"1:244"}' },
    { kind: 35, name: 'hacd_insc_move', json: '{"kind":35,"from_diamond":"WTYUIA","to_diamond":"XVMEKB","index":0,"protocol_cost":"1:244"}' },
    { kind: 36, name: 'hacd_insc_drop', json: '{"kind":36,"diamond":"WTYUIA","index":0,"protocol_cost":"1:244"}' },
    { kind: 40, name: 'contract_deploy', description: 'Deploy contract; pay 0.0001 HAC protocol fee', json: '{"kind":40,"protocol_cost":"1:244"}' },
    { kind: 41, name: 'contract_update', description: 'Update contract; pay 0.0001 HAC protocol fee', json: '{"kind":41,"protocol_cost":"1:244"}' },
]
for(const act of protocolFeeActions){
    const model = ctx.mnx_action_presentation(act, { review: { main } })
    const html = ctx.mnx_action_line_html(model, 0, {})
    const plain = ctx.mnx_action_plain_text(model)
    assert(html.includes('protocol fee') && html.includes('0.0001'), `${act.name} HTML keeps its protocol fee`)
    assert(plain.includes('protocol fee') && plain.includes('0.0001 HAC'), `${act.name} plain text keeps its protocol fee`)
}

// The TEX adapter is based on typed cell ids and fields, not desc punctuation.
const texCells = [
    { cellid: 1, haczhu: 1000000 }, { cellid: 2, haczhu: 2000000 },
    { cellid: 3, satnum: 3 }, { cellid: 4, satnum: 4 }, { cellid: 5, diamonds: 'WTYUIA,XVMEKB' }, { cellid: 6, dianum: 6 },
    { cellid: 7, asset: { serial: 7, amount: 70 } }, { cellid: 8, asset: { serial: 8, amount: 80 } },
    ...[11,12,13].map(cellid => ({ cellid, haczhu: 1100000 })),
    ...[14,15,16].map(cellid => ({ cellid, satoshi: 140 })),
    ...[17,18,19].map(cellid => ({ cellid, diamond: 17 })),
    ...[20,21,22].map(cellid => ({ cellid, asset: { serial: 20, amount: 200 } })),
    { cellid: 23, height: 23 }, { cellid: 24, height: 24 }, { cellid: 25, chainid: 25 },
]
const tex = { kind: 22, name: 'tex_cell_execute', description: 'natural language not parsed', json: JSON.stringify({ kind: 22, addr: main, cells: texCells }) }
const texModel = ctx.mnx_action_presentation(tex, { review: { main } })
assert.equal(texModel.mode, 'structured')
assert.equal(texModel.fields.length, 23)
assert(texModel.fields[0].tokens[0].v.includes('pay 0.01 HAC'))
assert(texModel.fields[10].tokens[0].v.includes('require HAC balance equal to 0.011 HAC'))
assert(texModel.fields[4].tokens[0].v.includes('WTYUIA,XVMEKB'))
assert.equal(ctx.mnx_action_presentation({ ...tex, json: JSON.stringify({ kind: 22, addr: main, cells: [{ cellid: 1 }] }) }, { review: { main } }).mode, 'decorate')

// Inscription type distinguishes otherwise-identical content and survives all
// three outputs. AST child rendering descends without rewriting SDK paths.
const inscription = type => ({ kind: 32, name: 'hacd_insc_push', description: 'SDK text', json: JSON.stringify({ kind: 32, diamonds: 'WTYUIA', engraved_content: '0x6869', engraved_type: type, protocol_cost: '0:0' }) })
const insc2 = ctx.mnx_action_presentation(inscription(2), { review: { main } })
const insc200 = ctx.mnx_action_presentation(inscription(200), { review: { main } })
assert.notEqual(ctx.mnx_action_plain_text(insc2), ctx.mnx_action_plain_text(insc200))
assert(ctx.mnx_action_plain_text(insc200).includes('type 200'))
const deepAst = ctx.mnx_action_presentation({ kind: 25, name: 'ast_select', description: 'old text', json: JSON.stringify({ kind: 25, exe_min: 1, exe_max: 1, actions: [{}] }), children: [{ kind: 25, name: 'ast_select', path: '0/0', json: JSON.stringify({ kind: 25, exe_min: 1, exe_max: 1, actions: [{}] }), children: [{ kind: 1, name: 'transfer_hac_to', path: '0/0/0', transfer: { to: main, payload: { type: 'hac', amount: '1:248' } } }] }] }, { review: { main } })
const deepHtml = ctx.mnx_action_line_html(deepAst, 0, {})
assert(deepHtml.includes('[0/0/0] Transfer'))
assert(ctx.mnx_action_plain_text(deepAst).includes('[0/0/0]'))
const astIf = ctx.mnx_review_presentations({ main, actions: [{ kind: 26, name: 'ast_if', path: '0', json: '{"kind":26,"cond":{"kind":25,"exe_min":1,"exe_max":1,"actions":[{}]},"br_if":{"kind":25,"exe_min":1,"exe_max":1,"actions":[{}]},"br_else":{"kind":25,"exe_min":0,"exe_max":1,"actions":[{}]}}', children: [
    { kind: 25, path: '0/0', children: [{ kind: 1, path: '0/0/0', description: 'condition payment' }] },
    { kind: 25, path: '0/1', children: [{ kind: 1, path: '0/1/0', description: 'if payment' }] },
    { kind: 25, path: '0/2', children: [{ kind: 1, path: '0/2/0', description: 'else payment' }] },
] }] })[0]
assert.equal(astIf.children[0].children[0].branch, 'condition')
assert.equal(astIf.children[1].children[0].branch, 'if-branch')
assert.equal(astIf.children[2].children[0].branch, 'else-branch')
const astIfHtml = ctx.mnx_action_line_html(astIf, 0, {})
assert(astIfHtml.includes('[0/0/0] <b>condition</b> condition payment'))
assert(astIfHtml.includes('[0/1/0] <b>if-branch</b> if payment'))
assert(astIfHtml.includes('[0/2/0] <b>else-branch</b> else payment'))
const futureAstIf = ctx.mnx_review_presentations({ main, actions: [{
    kind: 26, name: 'ast_if', path: '0', schema: 'hacash.sdk/action-desc@999',
    description: 'Future conditional operation', json: '{"kind":26,"cond":{},"br_if":{},"br_else":{}}',
    children: [{ kind: 25, path: '0/0', children: [{ kind: 1, path: '0/0/0', description: 'future child' }] }],
}] }, { review: { main } })[0]
assert.equal(futureAstIf.mode, 'verbatim')
assert.equal(futureAstIf.children[0].children[0].branch, undefined)
assert.equal(ctx.mnx_act_codes_hex({ json: '{"kind":2001,"lockbox":"0xdeadbeef"}' }), 'deadbeef')

// Registry identity is schema-gated: mismatched name/kind cannot reach an adapter.
const mismatch = ctx.mnx_action_presentation({ kind: 22, name: 'asset_create', schema: 'hacash.sdk/action-desc@3', description: 'SDK fallback' }, { review: { main } })
assert.equal(mismatch.mode, 'verbatim')
assert.equal(ctx.mnx_action_plain_text(mismatch), 'SDK fallback')
const unknownSchema = ctx.mnx_action_presentation({ kind: 1, name: 'transfer_hac_to', schema: 'hacash.sdk/action-desc@999', description: 'new SDK sentence', transfer: { schema: 'hacash.sdk/transfer-desc@999', payload: { type: 'hac', amount: '1:248' } } }, { review: { main } })
assert.equal(unknownSchema.mode, 'verbatim')
assert.equal(ctx.mnx_action_plain_text(unknownSchema), 'new SDK sentence')

const template = fs.readFileSync(path.join(__dirname, '../popup/signtx/signtx/vue.html'), 'utf8')
assert(template.indexOf('Actions <span') < template.indexOf('Fee and gas'))
assert(template.indexOf('Fee and gas') < template.indexOf('Signature status'))
assert(!template.includes('Valid height') && !template.includes('Allowed chains'))
assert(template.includes('Main address') && template.includes('<dt>Hash</dt>'))
assert(template.includes('({{txres.timestamp}})'))
assert(template.includes('<a>{{v.address}}</a>'))
assert(!template.includes('gas-note'))
const hacdJoin = (v) => (v && v.names ? v.names.join(',') : v && v.err)
assert.equal(hacdJoin(ctx.mnx_parse_hacd_list('TUHBME')), 'TUHBME')
assert.equal(ctx.mnx_hacd_transfer_action('to', ctx.mnx_parse_hacd_list('TUHBME').names).kind, 'transfer_hacd_single_to')
for (const text of ['TUHBME,WTYUIA', 'TUHBME, WTYUIA', 'TUHBME , WTYUIA', 'TUHBME WTYUIA', 'TUHBME|WTYUIA', 'TUHBMEWTYUIA']) {
    const listed = ctx.mnx_parse_hacd_list(text)
    assert.equal(hacdJoin(listed), 'TUHBME,WTYUIA', text)
    assert.equal(ctx.mnx_hacd_transfer_action('to', listed.names).kind, 'transfer_hacd_to')
}
assert.equal(ctx.mnx_parse_hacd_list('tuhbme').err, 'diamond name tuhbme is not valid')
assert.equal(ctx.mnx_parse_hacd_list('TUHBM').err, 'diamond list format invalid')
assert.equal(ctx.mnx_parse_hacd_list('TUHBME,TUHBME').err, 'diamond name TUHBME is duplicated')
assert.equal(hacdJoin(ctx.mnx_parse_hacd_list(['TUHBME', 'WTYUIA'])), 'TUHBME,WTYUIA')

console.log('txdisplay tests ok')
