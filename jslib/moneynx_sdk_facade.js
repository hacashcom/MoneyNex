/**
 * MoneyNex SDK facade (thin wrapper, fullnode sdk transport v10 adapter)
 *
 * Concat order (build.js pppjslibs): crypto-util -> message-types -> elliptic
 * -> hacash_sdk (page build, wasm inlined as base64, exposes globalThis.hacash_sdk)
 * -> this file. Loaded by popup pages only; background does not load the SDK.
 *
 * Talks to the fullnode sdk single transport surface (transport v10, doc 14;
 * v10 = fee pricing in the u232 unit: review/fee-estimate/params carry an explicit
 * fee_purity_unit and purity/floor figures are u232-valued — envelope/ops unchanged):
 *   sdk_invoke_json(operation_id, payload_json_bytes) -> envelope string
 *     {"ok":1,"body":<json>} / {"ok":0,"code":<id>,"msg":"...","detail":"..."}
 *   operation_id is the 1-based ordinal of the profile.rs OPERATIONS registry (MNX_OP table below).
 *   Request fields are flat JSON keys (tx.prepare_signature's options.* are literal key names).
 * Private keys never enter the SDK: this module uses elliptic for privkey->pubkey and
 * digest signing, producing a SignatureProof handed back to SDK attach. Signing algorithm
 * frozen as secp256k1-rfc6979-sha256: ECDSA directly on the 32-byte digest (no second hash),
 * canonical (low-S) output as 64 bytes r||s.
 */

var mnx_sdk_ptr = null
, mnx_sdk_ready = async function() {
    if(mnx_sdk_ptr){ return mnx_sdk_ptr }
    let hsd = globalThis.hacash_sdk
    if(!hsd){
        throw new Error('MoneyNex SDK not loaded (jslib/hacash_sdk.js missing)')
    }
    mnx_sdk_ptr = await hsd()
    return mnx_sdk_ptr
}
// Unified envelope: on failure throw {code, message, detail, sdkError} (sdkError = raw {ok:0,...})
, mnx_sdk_invoke = async function(op_id, payload) {
    let api = await mnx_sdk_ready()
    let text = payload ? JSON.stringify(payload) : '{}'
    let res = JSON.parse(api.sdk_invoke_json(op_id, new TextEncoder().encode(text)))
    if(!res.ok){
        let e = new Error(res.msg || 'sdk error')
        e.code = res.code
        e.detail = res.detail
        e.sdkError = res
        throw e
    }
    return res.body
}
// Error normalization: SDK structured error / plain exception -> {err, code?, detail?} (pages keep using resp.err)
, mnx_err = function(e) {
    if(e && e.sdkError){
        return { err: e.message, code: e.code, detail: e.detail, sdkError: e.sdkError }
    }
    if(e && e.message){
        return { err: e.message, code: e.code }
    }
    return { err: String(e) }
}
, mnx_err_message = function(e) {
    return (e && e.message) ? e.message : String(e)
}

// Operation IDs (fullnode sdk profile.rs `define_operations!` registry, 1-based order).
// New operations are appended at the end; v9 removed system.capabilities/system.codec_profile,
// and renamed amount.parse_protocol/format_protocol to amount.parse/format (ids shifted).
, MNX_OP = {
    SYSTEM_SDK_VERSION: 1,
    TX_BUILD: 2,
    TX_INSPECT_REPORT: 3,
    TX_INSPECT: 4,
    TX_PREPARE_SIGNATURE: 5,
    TX_ATTACH_SIGNATURE: 6,
    TX_ATTACH_SIGNATURE_UNBOUND: 7,
    TX_VERIFY: 8,
    TX_SIGNATURE_REPORT: 9,
    TX_DECODE: 10,
    TX_ENCODE: 11,
    ACCOUNT_VERIFY_ADDRESS: 12,
    ACCOUNT_ADDRESS_FROM_PUBLIC_KEY: 13,
    AMOUNT_PARSE: 14,
    AMOUNT_FORMAT: 15,
    MESSAGE_PREPARE_SIGNATURE: 16,
    MESSAGE_VERIFY: 17,
    POLICY_EVALUATE: 18,
    SYSTEM_PARAMS: 19,
    TX_ESTIMATE_FEE: 20,
    ACCOUNT_VERIFY_SIGNATURE: 21,
    DIAMOND_LOOKUP: 22,
    VM_DECODE_CALL: 23,
    ACTION_DESCRIBE: 24,
    VM_CODE: 25,
}

///////////////// tx operations /////////////////

// spec: {schema?, tx_type, main, fee, timestamp?, gas_max?, actions:[ActionSpec]}
// ActionSpec.kind takes registry schema names (transfer_hac_to / transfer_hacd_single_to /
// hacd_insc_* / message / blob / required_signers ...); the SDK also accepts numeric kinds.
// Note names follow the selection registry: 1025=message, 1026=blob, 1044=required_signers —
// homonyms of the VM syscalls tx_message/tx_blob but different things.
, sdk_tx_build = function(spec) {
    return mnx_sdk_invoke(MNX_OP.TX_BUILD, { spec })
}
, sdk_tx_inspect_report = function(body, signer_address) {
    let req = { body }
    if(signer_address){ req.signer_address = signer_address }
    return mnx_sdk_invoke(MNX_OP.TX_INSPECT_REPORT, req)
}
, sdk_tx_inspect = function(body, signer_address, context) {
    let req = { body, context }
    if(signer_address){ req.signer_address = signer_address }
    return mnx_sdk_invoke(MNX_OP.TX_INSPECT, req)
}
, sdk_tx_prepare_signature = function(body, signer_address, opts) {
    opts = opts || {}
    let req = { body, signer_address }
    // transport v9+: options.* are flat literal key names (not a nested options object);
    // review must strip wallet-added display fields (_strict_err/_strict_note — SDK strict parsing rejects unknown keys)
    if(opts.review){ req['options.review'] = mnx_sdk_review_clean(opts.review) }
    if(opts.policy){ req['options.policy'] = opts.policy }
    if(opts.origin){ req['options.origin'] = opts.origin }
    if(opts.expires_at != null){ req['options.expires_at'] = opts.expires_at }
    return mnx_sdk_invoke(MNX_OP.TX_PREPARE_SIGNATURE, req)
}
, sdk_tx_attach_signature = function(body, proof, review, request) {
    return mnx_sdk_invoke(MNX_OP.TX_ATTACH_SIGNATURE, { body, proof, review: mnx_sdk_review_clean(review), request })
}
, sdk_tx_attach_signature_unbound = function(body, proof) {
    return mnx_sdk_invoke(MNX_OP.TX_ATTACH_SIGNATURE_UNBOUND, { body, proof })
}
, sdk_tx_verify = function(body) {
    return mnx_sdk_invoke(MNX_OP.TX_VERIFY, { body })
}
, sdk_tx_signature_report = function(body) {
    return mnx_sdk_invoke(MNX_OP.TX_SIGNATURE_REPORT, { body })
}
, sdk_tx_decode = function(body) {
    return mnx_sdk_invoke(MNX_OP.TX_DECODE, { body })
}
, sdk_tx_encode = function(transaction, review) {
    let req = { transaction }
    if(review){ req.review = review }
    return mnx_sdk_invoke(MNX_OP.TX_ENCODE, req)
}

///////////////// system / account / amount /////////////////

, sdk_system_sdk_version = function() {
    return mnx_sdk_invoke(MNX_OP.SYSTEM_SDK_VERSION, {})
}
, sdk_system_params = function() {
    return mnx_sdk_invoke(MNX_OP.SYSTEM_PARAMS, {})
}
, sdk_account_verify_address = function(address) {
    return mnx_sdk_invoke(MNX_OP.ACCOUNT_VERIFY_ADDRESS, { address })
}
, sdk_account_address_from_public_key = function(public_key) {
    return mnx_sdk_invoke(MNX_OP.ACCOUNT_ADDRESS_FROM_PUBLIC_KEY, { public_key })
}
, sdk_amount_parse = function(value) {
    return mnx_sdk_invoke(MNX_OP.AMOUNT_PARSE, { value })
}
, sdk_amount_format = function(value, unit) {
    return mnx_sdk_invoke(MNX_OP.AMOUNT_FORMAT, { value, unit })
}
, sdk_policy_evaluate = function(review, policy) {
    let req = { review }
    if(policy){ req.policy = policy }
    return mnx_sdk_invoke(MNX_OP.POLICY_EVALUATE, req)
}
// Single-action describe (action = raw action hex; describe optional {description,json,code} booleans)
, sdk_action_describe = function(action, describe) {
    let req = { action }
    if(describe){ req.describe = describe }
    return mnx_sdk_invoke(MNX_OP.ACTION_DESCRIBE, req)
}
// contract_main_call structured view (action = raw action hex): marks/codeconf/code_type/codes_hash
, sdk_vm_decode_call = function(action) {
    return mnx_sdk_invoke(MNX_OP.VM_DECODE_CALL, { action })
}
// Code decompilation: code_type 0=bytecode -> assembly|raw;
// 1=ir_node -> fitsh|tree|assembly|raw. codes is hex.
, sdk_vm_code = function(codes, code_type, format) {
    let req = { codes, code_type: String(code_type) }
    if(format){ req.format = format }
    return mnx_sdk_invoke(MNX_OP.VM_CODE, req)
}
, sdk_tx_estimate_fee = function(body, height) {
    let req = { body }
    if(height != null){ req.height = height }
    return mnx_sdk_invoke(MNX_OP.TX_ESTIMATE_FEE, req)
}
, sdk_account_verify_signature = function(public_key, digest, signature) {
    return mnx_sdk_invoke(MNX_OP.ACCOUNT_VERIFY_SIGNATURE, { public_key, digest, signature })
}
, sdk_diamond_lookup = function(name, serial) {
    let req = {}
    if(name != null){ req.name = name }
    if(serial != null){ req.serial = serial }
    return mnx_sdk_invoke(MNX_OP.DIAMOND_LOOKUP, req)
}
, sdk_message_prepare_signature = function(params) {
    return mnx_sdk_invoke(MNX_OP.MESSAGE_PREPARE_SIGNATURE, { params })
}
, sdk_message_verify = function(request, proof) {
    return mnx_sdk_invoke(MNX_OP.MESSAGE_VERIFY, { request, proof })
}

///////////////// ECDSA (pure JS, replaces old wasm sign/create_account_by) ///////////////

, mnx_ec_get = function() {
    let ell = globalThis.elliptic || (typeof window !== 'undefined' ? window.elliptic : null)
    if(!ell){ throw new Error('elliptic not loaded (jslib/elliptic.min.js missing)') }
    return new ell.ec('secp256k1')
}
// privkey(64hex) -> 33B compressed pubkey hex
, mnx_privkey_to_pubkey = function(privhex) {
    mnx_validate_privkey(privhex)
    let key = mnx_ec_get().keyFromPrivate(privhex, 'hex')
    return key.getPublic(true, 'hex')
}
// digest(64hex) -> 64B r||s hex (canonical low-S, matching libsecp256k1 output)
, mnx_sign_digest = function(digesthex, privhex) {
    mnx_validate_digest(digesthex)
    mnx_validate_privkey(privhex)
    let sig = mnx_ec_get().sign(Buffer_from_hex(digesthex), privhex, { canonical: true })
    return pad64(sig.r.toString(16)) + pad64(sig.s.toString(16))
}
// privkey -> {private_key, public_key, address} (address derived from pubkey by the SDK)
, mnx_derive_address = async function(privhex) {
    let pubkey = mnx_privkey_to_pubkey(privhex)
    let res = await sdk_account_address_from_public_key(pubkey)
    return { private_key: privhex, public_key: pubkey, address: res.address }
}
// SigningRequest -> SignatureProof (assembled after the vault signs the digest)
, mnx_signing_proof = function(request, privhex) {
    return {
        schema: 'hacash.sdk/signature-proof@1',
        request_id: request.id,
        request_binding: request.request_binding,
        public_key: mnx_privkey_to_pubkey(privhex),
        signature: mnx_sign_digest(request.digest, privhex),
        algorithm: 'secp256k1-rfc6979-sha256',
    }
}

///////////////// amount display (sync, pure JS) ///////////////

// Strip currency prefix: "HAC 1250:240" / "ㄜ1:248" -> "1250:240" (input may be a number; coerced to string first)
, mnx_strip_currency_prefix = function(amt) {
    amt = (amt == null ? '' : String(amt)).trim()
    return amt.replace(/^(HAC\s+|ㄜ)/, '')
}
// fin "X:U" -> HAC string with up to 8 decimals (replicates SDK format_protocol(v, 248))
, mnx_fin_to_decimal = function(xu) {
    xu = mnx_strip_currency_prefix(xu)
    if(xu.indexOf(':') < 0){ return xu } // already decimal
    let neg = false
    let s = xu.trim()
    if(s.charAt(0) === '-'){ neg = true; s = s.slice(1) }
    let parts = s.split(':')
    if(parts.length !== 2){ return xu }
    let xs = parts[0]
    let u = parseInt(parts[1], 10)
    if(isNaN(u)){ return xu }
    let base = 248 // UNIT_MEI
    let mag = BigInt(xs)
    let out
    if(u >= base){
        out = mag.toString() + '0'.repeat(u - base)
    }else{
        let dp = base - u
        let d = mag.toString()
        if(d.length <= dp){
            out = '0.' + '0'.repeat(dp - d.length) + d
        }else{
            out = d.slice(0, d.length - dp) + '.' + d.slice(d.length - dp)
        }
        out = out.replace(/0+$/, '')
        if(out.endsWith('.')){ out = out.slice(0, -1) }
    }
    if(neg){ out = '-' + out }
    return out
}

///////////////// internal utils /////////////////

// Strip wallet-attached internal display fields (_strict_err/_strict_note) from the SDK Review.
// transport's from_json parses strictly (reject_unknown); these keys would trigger an
// unknown-field error in prepare/attach.
, mnx_sdk_review_clean = function(review) {
    if(!review || typeof review != 'object'){ return review }
    let copy = {}
    for(let k in review){
        if(k.charAt(0) === '_'){ continue }
        copy[k] = review[k]
    }
    return copy
}
// "0x466972..." (or bare hex) -> UTF-8 string (make engraved content/messages readable)
, mnx_hex_to_utf8 = function(hex) {
    hex = (hex == null ? '' : String(hex)).replace(/^0x/, '')
    if(!hex || hex.length % 2 !== 0){ return hex }
    let out = ''
    for(let i = 0; i < hex.length; i += 2){
        out += String.fromCharCode(parseInt(hex.substr(i, 2), 16))
    }
    try { return decodeURIComponent(escape(out)) } catch(e) { return out }
}
// UTF-8 string -> hex (engraved content etc. must be hex in ActionSpec's BytesW1 fields)
, mnx_utf8_to_hex = function(text) {
    text = (text == null ? '' : String(text))
    let bytes = new TextEncoder().encode(text)
    let out = ''
    for(let i = 0; i < bytes.length; i++){
        out += bytes[i].toString(16).padStart(2, '0')
    }
    return out
}

function Buffer_from_hex(hex) {
    let out = new Uint8Array(hex.length / 2)
    for(let i = 0; i < hex.length; i += 2){
        out[i / 2] = parseInt(hex.substr(i, 2), 16)
    }
    return out
}
const MNX_SECP256K1_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')
function mnx_random_private_key() {
    if(!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
        throw new Error('Secure random generation is unavailable')
    }
    const bytes = new Uint8Array(32)
    try {
        // Rejection sampling preserves uniformity over valid secp256k1 scalars.
        // Never fall back to timestamps, mouse input or a persisted seed.
        for(let attempt = 0; attempt < 128; attempt++) {
            globalThis.crypto.getRandomValues(bytes)
            const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
            const scalar = BigInt('0x' + hex)
            if(scalar > 0n && scalar < MNX_SECP256K1_N) { return hex }
        }
        throw new Error('Secure random generation failed to produce a valid key')
    } finally {
        // JavaScript strings cannot be reliably erased; clear the owned byte buffer.
        bytes.fill(0)
    }
}
function mnx_validate_privkey(hex) {
    if(typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error('Invalid private key: expected 64 hexadecimal characters')
    }
    const n = BigInt('0x' + hex)
    if(n <= 0n || n >= MNX_SECP256K1_N) {
        throw new Error('Invalid private key: scalar out of range')
    }
    return hex.toLowerCase()
}
function mnx_validate_digest(hex) {
    if(typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error('Invalid digest: expected 32-byte hexadecimal value')
    }
    return hex.toLowerCase()
}
function pad64(h) {
    while(h.length < 64){ h = '0' + h }
    return h
}
