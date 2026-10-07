/**
 * node jslib/assetamt.test.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const src = fs.readFileSync(path.join(__dirname, 'assetamt.js'), 'utf8')
const ctx = { console, Uint8Array, BigInt, JSON, String, Number, Array, Object, Math, parseInt, isFinite }
vm.createContext(ctx)
vm.runInContext(src, ctx)

function assert(cond, msg) {
    if(!cond) throw new Error(msg || 'assert failed')
}
function eq(a, b, msg) {
    if(a !== b) throw new Error((msg || 'eq') + ': got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b))
}

const FOLD64_MAX = '2305843009213693951'
eq(ctx.MNX_ASSET_FOLD64_MAX.toString(), FOLD64_MAX, 'Fold64 max')

// formatAssetAtoms
eq(ctx.formatAssetAtoms('123456', 2), '1234.56', '1234.56')
eq(ctx.formatAssetAtoms('100', 2), '1', 'trailing zeros')
eq(ctx.formatAssetAtoms('1', 8), '0.00000001', 'tiny')
eq(ctx.formatAssetAtoms('9007199254740993', 0), '9007199254740993', 'over MAX_SAFE_INTEGER')
eq(ctx.formatAssetAtoms('0', 2), '0', 'zero')
eq(ctx.formatAssetAtoms('10', 0), '10', 'decimal 0')
eq(ctx.formatAssetAtoms('1', 16), '0.0000000000000001', 'decimal 16')
eq(ctx.formatAssetAtoms('1000', 3), '1', '1.000 -> 1')
eq(ctx.formatAssetAtoms('1010', 3), '1.01', '1.010 -> 1.01')
eq(ctx.formatAssetAtoms(FOLD64_MAX, 0), FOLD64_MAX, 'max format')

// parseAssetAmount happy path
eq(ctx.parseAssetAmount('1234.56', 2).atoms, '123456', 'parse 1234.56')
eq(ctx.parseAssetAmount('1', 2).atoms, '100', 'parse 1 @2')
eq(ctx.parseAssetAmount('0.00000001', 8).atoms, '1', 'parse tiny')
eq(ctx.parseAssetAmount('9007199254740993', 0).atoms, '9007199254740993', 'parse big')
eq(ctx.parseAssetAmount('01.20', 2).atoms, '120', 'leading zeros')
eq(ctx.parseAssetAmount('1.2', 2).atoms, '120', 'pad frac')
eq(ctx.parseAssetAmount(FOLD64_MAX, 0).atoms, FOLD64_MAX, 'parse max')
eq(ctx.parseAssetAmount('1', 16).atoms, '10000000000000000', 'decimal 16')

// parse errors
function errOf(input, decimal, maxAtoms) {
    let r = ctx.parseAssetAmount(input, decimal, maxAtoms)
    return r.err || ''
}
assert(/Invalid/.test(errOf('', 2)), 'empty')
assert(/Invalid/.test(errOf('1e2', 2)), 'exponent')
assert(/Invalid/.test(errOf('1E-2', 8)), 'neg exponent')
assert(/Invalid/.test(errOf('-1', 0)), 'minus')
assert(/Invalid/.test(errOf('+1', 0)), 'plus')
assert(/Invalid/.test(errOf('1,234', 0)), 'comma')
assert(/Invalid/.test(errOf('1. 2', 2)), 'space inside')
assert(/Invalid/.test(errOf('.5', 2)), 'no integer')
assert(/Invalid/.test(errOf('1.', 2)), 'trailing dot')
assert(/greater than 0/.test(errOf('0', 2)), 'zero')
assert(/greater than 0/.test(errOf('0.00', 2)), 'zero frac')
assert(/Integer/.test(errOf('1.0', 0)), 'decimal 0 with point')
assert(/Too many/.test(errOf('1.234', 2)), 'precision')
assert(/exceeds maximum/.test(errOf('2305843009213693952', 0)), 'over Fold64')
assert(/Insufficient/.test(errOf('1.01', 2, '100')), 'over balance')
eq(ctx.parseAssetAmount('1', 2, '100').atoms, '100', 'equal balance ok')
assert(/Invalid/.test(errOf('abc', 2)), 'letters')

// normalize
let n = ctx.mnx_normalize_asset_list([
    { serial: '1001', amount: '123456', decimal: 2, name: 'USD Coin', ticket: 'USDX' },
    { serial: '9', amount: '1' },
    { serial: '7', amount: '5', metadata: false, name: 'Broken', decimal: 2 },
])
eq(n.list.length, 3, '3 items')
eq(n.list[0].displayAmount, '1234.56', 'meta display')
eq(n.list[0].metadata, true, 'meta ok')
eq(n.list[1].metadata, false, 'old api no meta')
eq(n.list[1].displayAmount, '1', 'atoms fallback')
eq(n.list[1].name, 'Asset #9', 'fallback name')
eq(n.list[2].metadata, false, 'explicit metadata false')
eq(ctx.mnx_normalize_asset_list(null).list.length, 0, 'missing assets')
assert(ctx.mnx_normalize_asset_list({}).err, 'non-array')

// review match
let rv = {
    actions: [{
        transfer: { to: '1abc', payload: { type: 'asset', serial: '1001', atoms: '123456' } },
    }],
}
assert(ctx.mnx_review_asset_match(rv, '1001', '123456', '1abc').ok, 'review match')
assert(ctx.mnx_review_asset_match(rv, '1002', '123456', '1abc').err, 'serial mismatch')
assert(ctx.mnx_review_asset_match(rv, '1001', '1', '1abc').err, 'atoms mismatch')
assert(ctx.mnx_review_asset_match({ actions: [] }, '1001', '1', '1abc').err, 'missing action')

eq(ctx.mnx_tx_log_icon_file('ASSET'), 'asset.svg', 'icon')
eq(ctx.mnx_tx_log_icon_file('NOPE'), 'trade.svg', 'icon fallback')
eq(ctx.mnx_asset_log_amount('123456', 2, 'USD Coin'), '1234.56 USD Coin', 'log amount')

eq(ctx.mnx_u64_string('9007199254740993'), '9007199254740993', 'u64 string')
eq(ctx.mnx_u64_string(1001), '1001', 'u64 number small')

// asset metadata cache + display text (shared by the signing/review/Activity pages)
eq(ctx.mnx_asset_meta_norm({ decimal: 6, name: 'HUSD', ticket: 'HUSD' }).decimal, 6, 'meta norm decimal')
eq(ctx.mnx_asset_meta_norm({ metadata: false, decimal: 6 }), null, 'meta norm metadata:false')
eq(ctx.mnx_asset_meta_norm({ decimal: 17 }), null, 'meta norm decimal > 16 rejected')
eq(ctx.mnx_asset_meta_norm({ decimal: '6', name: ' X ' }).name, 'X', 'meta norm trims name')
eq(ctx.mnx_asset_meta_norm(null), null, 'meta norm null')
// cache not warmed: raw atoms with known=false (never guess decimals)
let unknown = ctx.mnx_asset_amount_text('5000000', '5')
eq(unknown.text, '5000000', 'unknown meta -> raw atoms')
eq(unknown.known, false, 'unknown meta flag')
eq(unknown.unit, '', 'unknown meta unit empty')
// after warm-up: converted via the on-chain decimal, unit from ticket
ctx.mnx_asset_meta_mem = { '5': { decimal: 6, name: 'HUSD', ticket: 'HUSD' } }
let known = ctx.mnx_asset_amount_text('5000000', '5')
eq(known.text, '5', 'known meta applies decimal')
eq(known.unit, 'HUSD', 'known meta unit from ticket')
eq(known.known, true, 'known meta flag')
eq(ctx.mnx_asset_amount_text('5000000', 5).text, '5', 'serial as number')
eq(ctx.mnx_asset_amount_text('1', '9999').known, false, 'missing serial -> unknown')
eq(ctx.mnx_asset_meta_get('5').decimal, 6, 'meta get by serial')
eq(ctx.mnx_asset_meta_get('9999'), null, 'meta get missing serial')

console.log('assetamt tests ok')
