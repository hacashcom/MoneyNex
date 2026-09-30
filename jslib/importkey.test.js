/**
 * node jslib/importkey.test.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const crypto = require('crypto')

const ctx = { console, String, Number, Array, Object, Math, parseInt, isFinite, RegExp }
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.join(__dirname, 'crypto-js.4.1.1.js'), 'utf8'), ctx)
vm.runInContext(fs.readFileSync(path.join(__dirname, 'importkey.js'), 'utf8'), ctx)

function eq(a, b, msg) {
    if(a !== b) throw new Error((msg || 'eq') + ': got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b))
}
function bip39priv(phrase) {
    return crypto.pbkdf2Sync(phrase, 'mnemonic', 2048, 64, 'sha512').toString('hex').slice(0, 64)
}
function bufBits(buf) {
    let bits = ''
    for(let i=0;i<buf.length;i++) bits += buf[i].toString(2).padStart(8, '0')
    return bits
}
function entropyToMnemonic(entBuf, wordlist) {
    const hash = crypto.createHash('sha256').update(entBuf).digest()
    const bits = bufBits(entBuf) + bufBits(hash).slice(0, entBuf.length * 8 / 32)
    const out = []
    for(let i=0;i<bits.length;i+=11){
        out.push(wordlist[parseInt(bits.slice(i, i+11), 2)])
    }
    return out.join(' ')
}

const words = ctx.MNX_BIP39_EN_LIST.split(' ')
eq(words.length, 2048, 'bip39 word count')
eq(words[0], 'abandon', 'first word')
eq(words[2047], 'zoo', 'last word')

const PK = '5d37b709da5388406ce959f7b16c6f04ecd99b86e798cf5086f7059f5966e134'
const MN12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const MN12_PRIV = bip39priv(MN12)
eq(entropyToMnemonic(Buffer.alloc(16, 0), words), MN12, 'zero entropy 12-word')

function kindOf(s) {
    return ctx.mnx_resolve_import_secret(s)
}

let r = kindOf(PK)
eq(r.kind, 'privkey', 'raw hex')
eq(r.stuff, PK, 'raw hex stuff')
eq(r.rawkey, true, 'raw hex rawkey')

r = kindOf('0x' + PK)
eq(r.kind, 'privkey', '0x prefix')
eq(r.stuff, PK, '0x prefix stuff')

r = kindOf('0X' + PK.toUpperCase())
eq(r.kind, 'privkey', '0X uppercase')
eq(r.stuff, PK, '0X uppercase lowercased')

r = kindOf('  \n0x ' + PK.slice(0, 8) + ' ' + PK.slice(8) + '\t')
eq(r.kind, 'privkey', 'hex whitespace')
eq(r.stuff, PK, 'hex whitespace stuff')

r = kindOf(MN12)
eq(r.kind, 'mnemonic', '12-word mnemonic')
eq(r.rawkey, true, 'mnemonic rawkey')
eq(!!r.err, false, 'valid 12-word no err')
eq(r.stuff, MN12_PRIV, 'mnemonic is BIP39 seed[0:32], not SHA-256')
eq(r.stuff.length, 64, 'mnemonic privkey hex length')

r = kindOf('  ABANDON\n  abandon\tabandon abandon abandon abandon abandon abandon abandon abandon abandon about  ')
eq(r.kind, 'mnemonic', 'mnemonic whitespace + case')
eq(r.stuff, MN12_PRIV, 'mnemonic normalized to same privkey')

const lengths = {12:16, 15:20, 18:24, 21:28, 24:32}
for(const n of [12, 15, 18, 21, 24]){
    const phrase = entropyToMnemonic(Buffer.alloc(lengths[n], 0), words)
    eq(phrase.split(' ').length, n, n + '-word count')
    r = kindOf(phrase)
    eq(r.kind, 'mnemonic', n + '-word kind')
    eq(!!r.err, false, n + '-word checksum')
    eq(r.stuff, bip39priv(phrase), n + '-word same seed KDF')
}

r = kindOf(Array(24).fill('zoo').join('   '))
eq(r.kind, 'mnemonic', 'invalid checksum still classified as mnemonic')
eq(r.err, 'Invalid mnemonic checksum', '24 zoo fails checksum')
eq(r.rawkey, false, 'checksum fail not rawkey')

r = kindOf('abandon ability able about above absent absorb abstract absurd abuse access accident')
eq(r.kind, 'mnemonic', '12 in-list words')
eq(r.err, 'Invalid mnemonic checksum', '12 in-list but bad checksum')

r = kindOf('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword')
eq(r.kind, 'password', 'invalid word is password')
eq(r.rawkey, false, 'invalid word not rawkey')
eq(r.stuff, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword', 'invalid word keeps original')

r = kindOf('abandon ability able')
eq(r.kind, 'password', 'too few words')

r = kindOf('hello world this is not twelve words')
eq(r.kind, 'password', 'short phrase')

r = kindOf('  mySecretPass1  ')
eq(r.kind, 'password', 'password')
eq(r.stuff, 'mySecretPass1', 'password trim only')
eq(r.rawkey, false, 'password rawkey')

r = kindOf('0xhellohellohello')
eq(r.kind, 'password', '0x non-hex is password')
eq(r.stuff, '0xhellohellohello', 'password keeps 0x')

r = kindOf('')
eq(r.kind, 'password', 'empty')
eq(r.stuff, '', 'empty stuff')

console.log('importkey.test.js ok')
