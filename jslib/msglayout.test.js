/**
 * node jslib/msglayout.test.js
 * No browser / CryptoJS dependency; covers BB01 28-byte and fail-closed rules.
 */
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const src = fs.readFileSync(path.join(__dirname, 'msglayout.js'), 'utf8')
const ctx = { console, Uint8Array, BigInt, JSON, String, Number, Array, Object, Math, parseInt, isFinite, TextDecoder }
vm.createContext(ctx)
vm.runInContext(src, ctx)

function hexToU8(hex) {
    hex = hex.replace(/^0x/i, '')
    const out = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.substr(i, 2), 16)
    return out
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assert failed')
}

const BB01_LAYOUT = [
    ['magic4'],
    ['u32be', 'net'],
    ['evm_addr20', 'to'],
]

// magic BB01 + net 31337 + to 0x11 * 20
const carrier = Buffer.alloc(28)
carrier.write('BB01', 0, 4, 'ascii')
carrier.writeUInt32BE(31337, 4)
carrier.fill(0x11, 8, 28)
const bytes = new Uint8Array(carrier)

let r = ctx.mnx_msglayout_parse(bytes, BB01_LAYOUT)
assert(r.ok, 'BB01 parse: ' + (r.err || ''))
assert(r.fields.length === 3, '3 fields')
assert(r.fields[0].text === '"BB01"', 'magic ' + r.fields[0].text)
assert(r.fields[1].text.indexOf('31337') === 0, 'net ' + r.fields[1].text)
assert(r.fields[1].note === 'net', 'net note')
assert(r.fields[2].text === '0x' + '11'.repeat(20), 'evm ' + r.fields[2].text)
assert(r.fields[2].note === 'to', 'to note')

// empty name == omitted
r = ctx.mnx_msglayout_parse(bytes, [['magic4', ''], ['u32be', '', 4], ['evm_addr20', 'to']])
assert(r.ok, 'empty name: ' + (r.err || ''))
assert(r.fields[0].note === '', 'empty name stripped')
assert(r.fields[1].note === '', 'empty name + len')

// shorthand [field_id]
r = ctx.mnx_msglayout_parse(bytes, [['magic4'], ['u32be'], ['evm_addr20']])
assert(r.ok, 'no names: ' + (r.err || ''))
assert(r.fields[1].note === '')

// overrun / leftover
r = ctx.mnx_msglayout_parse(bytes, [['magic4'], ['u32be']])
assert(!r.ok && /covered/.test(r.err), 'leftover: ' + r.err)
r = ctx.mnx_msglayout_parse(bytes.subarray(0, 8), BB01_LAYOUT)
assert(!r.ok && /overrun/.test(r.err), 'overrun: ' + r.err)

// unknown field_id
r = ctx.mnx_msglayout_parse(bytes, [['not_a_type']])
assert(!r.ok && /unknown field_id/.test(r.err), 'unknown: ' + r.err)

// lying layout still must cover: evm20 + hex8
r = ctx.mnx_msglayout_parse(bytes, [['evm_addr20', 'payee'], ['hex', '', 8]])
assert(r.ok, 'cover with hex: ' + (r.err || ''))
assert(r.fields[1].hex, 'hex field marked ugly')

// variable without len
r = ctx.mnx_msglayout_parse(bytes, [['hex']])
assert(!r.ok && /requires len/.test(r.err), 'hex needs len: ' + r.err)

// ascii fail-closed on NUL
r = ctx.mnx_msglayout_parse(hexToU8('610062'), [['ascii', '', 3]])
assert(!r.ok && /printable ascii/.test(r.err), 'ascii nul: ' + r.err)
r = ctx.mnx_msglayout_parse(hexToU8('68656c6c6f'), [['ascii', 'memo', 5]])
assert(r.ok && r.fields[0].text === 'hello', 'ascii hello')

// hacd
r = ctx.mnx_msglayout_parse(Uint8Array.from(Buffer.from('TUHBME')), [['hacd_name']])
assert(r.ok && r.fields[0].text === 'TUHBME', 'hacd')
r = ctx.mnx_msglayout_parse(Uint8Array.from(Buffer.from('CCCCCC')), [['hacd_name']])
assert(!r.ok, 'invalid hacd char')

// amount 1:248 → unit 248, dist 1, mantissa [1]
r = ctx.mnx_msglayout_parse(hexToU8('f80101'), [['hac_zhu', '', 3]])
assert(r.ok, 'amount: ' + (r.err || ''))
assert(/HAC/.test(r.fields[0].text), 'amount text ' + r.fields[0].text)

// normalize: single + msgid, many tables
let t = ctx.mnx_msglayout_normalize({ msgid: 0, msglayout: BB01_LAYOUT })
assert(t.byMsgIndex[0] === BB01_LAYOUT, 'msgid 0')
assert(t.single == null, 'not single when msgid given')

t = ctx.mnx_msglayout_normalize({ msglayout: BB01_LAYOUT })
assert(t.single === BB01_LAYOUT, 'single layout')

t = ctx.mnx_msglayout_normalize({
    msglayouts: [
        { id: 0, layout: BB01_LAYOUT },
        { id: 1, layout: [['hex', '', 4]] },
    ],
})
assert(t.byMsgIndex[0] === BB01_LAYOUT, 'multi 0')
assert(Array.isArray(t.byMsgIndex[1]), 'multi 1')

t = ctx.mnx_msglayout_normalize({ msglayouts: { '0': BB01_LAYOUT, '2': [['ascii', '', 1]] } })
assert(t.byMsgIndex[0] === BB01_LAYOUT, 'map 0')
assert(t.byMsgIndex[2], 'map 2')

t = ctx.mnx_msglayout_normalize({ msglayouts: [{ action_id: 3, layout: BB01_LAYOUT }] })
assert(t.byActionIndex[3] === BB01_LAYOUT, 'action_id')

let act = { kind: 1025, index: 0, path: '0', json: JSON.stringify({ data: '0x' + carrier.toString('hex') }) }
let blob = { kind: 1026, index: 2, path: '2', json: JSON.stringify({ data: '0x68656c6c6f' }) }
let xfer = { kind: 1, index: 1, path: '1', transfer: { payload: { type: 'hac', amount: '1:248' } } }
assert(ctx.mnx_is_tx_message_action(act), 'is message')
assert(ctx.mnx_is_tx_message_action(blob), 'is blob')

let got = ctx.mnx_action_message_bytes(act)
assert(got.bytes.length === 28, 'bytes from json')

let actions = [act, xfer, blob]
let bind = ctx.mnx_msglayout_bind(actions, ctx.mnx_msglayout_normalize({ msgid: 1, msglayout: [['ascii', '', 5]] }))
assert(bind.slots.length === 2, 'msg+blob share id sequence')
assert(bind.slots[0].id === 0 && bind.slots[0].i === 0, 'first found is action 0')
assert(bind.slots[1].id === 1 && bind.slots[1].i === 2, 'second found is action 2')
assert(bind.byArrayIndex[2], 'id 1 maps to blob at action_id 2')
assert(!bind.errors.length, 'ascii layout on blob: ' + bind.errors.join(' '))

bind = ctx.mnx_msglayout_bind(actions, ctx.mnx_msglayout_normalize({ action_id: 1, msglayout: BB01_LAYOUT }))
assert(bind.errors.some(e => /action_id 1 is not a message\/blob/.test(e)), 'action_id on transfer: ' + bind.errors.join(' '))

bind = ctx.mnx_msglayout_bind(actions, ctx.mnx_msglayout_normalize({ action_id: 0, msglayout: BB01_LAYOUT }))
assert(!bind.errors.length, 'action_id 0 ok: ' + bind.errors.join(' '))
assert(bind.byArrayIndex[0] === BB01_LAYOUT, 'action_id 0 layout')

bind = ctx.mnx_msglayout_bind(actions, ctx.mnx_msglayout_normalize({ msgid: 0, msglayout: [['u32be']] }))
assert(bind.errors.some(e => /layout failed/.test(e)), 'parse error recorded: ' + bind.errors.join(' '))
assert(bind.byArrayIndex[0], 'failed layout still bound for hex fallback')

console.log('msglayout tests ok')
