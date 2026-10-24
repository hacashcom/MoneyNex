/**
 * MoneyNex action fact layer (presentation plan §7.2 "事实适配").
 *
 * Pure functions over the SDK Review action objects: typed facts first, then
 * the SDK-decoded canonical JSON (never dApp request JSON), each parsed at
 * most once per action object. Field access is validated for display needs;
 * anything unexpected yields null so callers fall back — no try/catch
 * guessing scattered in pages, no RPC, no DOM, no HTML.
 *
 * The canonical JSON here is always the SDK's decode of the actual
 * transaction body (act.json on the review action), matching the plan's
 * input priority: SDK typed facts > SDK canonical JSON > verbatim fallback.
 */
// Decoded diamonds come as a comma string (multi-name) or a single-name diamond
// field (or an array); normalize to a trimmed non-empty name array. Shared by
// the fact layer / txjson_to_spec / the actionview renderer / the transfer page
// (moved from moneynx_txview.js, kept as one definition).
var mnx_split_diamond_names = (v) => {
    if(v == null){ return [] }
    let arr = typeof v === 'string' ? v.split(',') : v
    return arr.map(s=>(s+'').trim()).filter(s=>s.length>0)
}

// Readable HACD list, same rules as field::DiamondNameListMax200::from_readable:
// drop space, newline, '|' and ',', then cut the remainder into 6-character names.
// A string, or an array of those strings. Returns {names} or {err}.
, MNX_HACD_LIST_MAX = 200
, mnx_parse_hacd_list = (v) => {
    if(Array.isArray(v)){
        let names = []
        for(let i = 0; i < v.length; i++){
            let one = mnx_parse_hacd_list(v[i])
            if(one.err){ return one }
            names = names.concat(one.names)
        }
        return mnx_hacd_list_check(names)
    }
    let s = String(v == null ? '' : v).replace(/[ \n|,]/g, '')
    if(!s){ return { err: 'diamond list is empty' } }
    if(s.length % 6 !== 0){ return { err: 'diamond list format invalid' } }
    let names = []
    for(let i = 0; i < s.length; i += 6){
        names.push(s.slice(i, i + 6))
    }
    return mnx_hacd_list_check(names)
}
, mnx_hacd_list_check = (names) => {
    if(!names.length){ return { err: 'diamond list is empty' } }
    if(names.length > MNX_HACD_LIST_MAX){ return { err: 'diamond list max 200 overflow' } }
    let seen = {}
    for(let i = 0; i < names.length; i++){
        let name = names[i]
        if(name.length !== 6 || !mnx_hacd_name_chars_ok(name)){
            return { err: 'diamond name ' + name + ' is not valid' }
        }
        if(seen[name]){ return { err: 'diamond name ' + name + ' is duplicated' } }
        seen[name] = 1
    }
    return { names: names }
}
, mnx_hacd_name_chars_ok = (name) => {
    for(let i = 0; i < name.length; i++){
        if(MNX_HACD_NAME_CHARS.indexOf(name.charAt(i)) < 0){ return false }
    }
    return true
}
// One valid name is kind 5 (diamond). More than one is kind 7 (diamonds),
// because kind 5 does not strip separators.
, mnx_hacd_transfer_action = (to, names) => {
    if(names.length === 1){
        return { kind: 'transfer_hacd_single_to', to: to, diamond: names[0] }
    }
    return { kind: 'transfer_hacd_to', to: to, diamonds: names }
}

// Cache canonical JSON without mutating the SDK-owned Review snapshot.
var mnx_act_json_cache = new WeakMap()
, mnx_act_json = function(act) {
    if(!act || act.json == null){ return null }
    if(typeof act === 'object' && mnx_act_json_cache.has(act)){ return mnx_act_json_cache.get(act) }
    let parsed = null
    try { parsed = mnx_json_parse_lossless(act.json) } catch(e){ parsed = null }
    if(!parsed || typeof parsed !== 'object'){ parsed = null }
    if(typeof act === 'object'){ mnx_act_json_cache.set(act, parsed) }
    return parsed
}

// Preserve bare JSON u64 integers before JSON.parse rounds them through IEEE-754.
// Only integer tokens outside the exact JS range are quoted; strings and syntax
// inside JSON strings are left untouched.
, mnx_json_parse_lossless = function(source) {
    let text = String(source), out = '', inString = false, escaped = false
    for(let i = 0; i < text.length;){
        let ch = text[i]
        if(inString){
            out += ch
            if(escaped){ escaped = false }
            else if(ch === '\\'){ escaped = true }
            else if(ch === '"'){ inString = false }
            i++
            continue
        }
        if(ch === '"'){ inString = true; out += ch; i++; continue }
        if(ch === '-' || ch >= '0' && ch <= '9'){
            let match = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
            if(match){
                let token = match[0]
                if(/^-?(?:0|[1-9]\d*)$/.test(token) && BigInt(token) > BigInt(Number.MAX_SAFE_INTEGER) || /^-(?:0|[1-9]\d*)$/.test(token) && BigInt(token) < BigInt(Number.MIN_SAFE_INTEGER)){
                    out += JSON.stringify(token)
                }else{ out += token }
                i += token.length
                continue
            }
        }
        out += ch
        i++
    }
    return JSON_parse(out)
}

// strict unsigned integer within max (returns null on anything else)
, mnx_act_uint = function(value, max) {
    if((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))){ return null }
    let n = Number(value)
    return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null
}

// User-writable byte content rendered with the protocol description boundary:
// fully printable ASCII -> double quoted with \ escaping for " and \;
// anything else -> 0x hex of the raw bytes. Mirrors field::descfmt::user_text.
, mnx_act_user_text = function(hex) {
    if(typeof hex !== 'string' || !/^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(hex)){ return null }
    let clean = hex.replace(/^0x/i, '')
    let bytes = []
    for(let i = 0; i < clean.length; i += 2){ bytes.push(parseInt(clean.substr(i, 2), 16)) }
    let printable = bytes.length > 0 && bytes.every(b => b >= 0x20 && b <= 0x7e)
    if(printable){
        let out = '"'
        for(let b of bytes){
            if(b === 0x22 || b === 0x5c){ out += '\\' }
            out += String.fromCharCode(b)
        }
        return out + '"'
    }
    return '0x' + clean.toLowerCase()
}

// Only these wire kinds omit an endpoint side and define it as transaction
// main. Missing data on an explicit side is not evidence of an implied main.
, mnx_endpoint_is_implicit_main = function(act, field) {
    let kind = Number(act && act.kind)
    return field === 'from' && [1,5,7,10,17].includes(kind) ||
        field === 'to' && [8,11,13,18].includes(kind)
}

// Endpoint resolution shared by transfer / guard adapters. Canonical JSON is
// the wire identity and therefore wins over any future resolved typed pointer.
// Only kind-known omitted transfer sides may fall back to primary.
, mnx_act_endpoint = function(act, field, review) {
    let typed = act && act.transfer && field === 'from' ? act.transfer.from : (act && act.transfer && field === 'to' ? act.transfer.to : null)
    let json = mnx_act_json(act)
    if(!json){
        if(typeof typed === 'string' && typed){ return { kind: 'address', value: typed } }
        if(mnx_endpoint_is_implicit_main(act, field) && review && typeof review.main === 'string'){
            return { kind: 'implied-main', value: review.main }
        }
        return null
    }
    let raw = json ? json[field] : null
    if(typeof raw === 'string' && /^[a-km-zA-HJ-NP-Z1-9]{28,34}$/.test(raw)){ return { kind: 'address', value: raw } }
    let pointer = mnx_act_uint(raw, 235)
    if(pointer != null){
        let table = (review && review.address_table) || []
        let resolved = Array.isArray(table) && typeof table[pointer] === 'string' ? table[pointer] : null
        return { kind: 'pointer', index: pointer, resolved }
    }
    if(Object.prototype.hasOwnProperty.call(json, field)){
        return { kind: 'invalid-reference', value: raw == null ? 'null' : String(raw) }
    }
    if(typeof typed === 'string' && typed){ return { kind: 'address', value: typed } }
    if(!mnx_endpoint_is_implicit_main(act, field)){ return null }
    let main = review && typeof review.main === 'string' ? review.main : ''
    return { kind: 'implied-main', value: main }
}

// Transfer facts (13 kinds). Payload from the SDK typed transfer intent;
// HACD names fall back to the canonical JSON (typed payload may abbreviate).
, mnx_transfer_facts = function(act, review) {
    if(!act || !act.transfer){ return null }
    let p = act.transfer.payload
    if(!p || !p.type){ return null }
    let facts = {
        from: mnx_act_endpoint(act, 'from', review),
        to: mnx_act_endpoint(act, 'to', review),
        payload: null,
    }
    if(!facts.from || !facts.to){ return null }
    if(p.type === 'hac' && p.amount != null){
        facts.payload = { type: 'hac', amount: mnx_fin_to_decimal(p.amount) }
    }else if(p.type === 'satoshi' && p.atoms != null){
        facts.payload = { type: 'satoshi', atoms: String(p.atoms) }
    }else if(p.type === 'hacd'){
        let names = (p.names || []).map(String)
        if(!names.length){
            let json = mnx_act_json(act) || {}
            names = mnx_split_diamond_names(json.diamond).concat(mnx_split_diamond_names(json.diamonds))
        }
        facts.payload = { type: 'hacd', count: mnx_act_uint(p.count, 200), names }
    }else if(p.type === 'asset' && p.serial != null && p.atoms != null){
        facts.payload = { type: 'asset', serial: String(p.serial), atoms: String(p.atoms) }
    }else{
        return null
    }
    return facts
}

// Height scope (kind 1042): inclusive start..end, end = 0 means unlimited.
, mnx_act_height_scope = function(act) {
    if(!act || Number(act.kind) !== 1042){ return null }
    let json = mnx_act_json(act)
    if(!json){ return null }
    let start = mnx_act_uint(json.start, 1099511627775)
    let end = mnx_act_uint(json.end, 1099511627775)
    return start == null || end == null ? null : { start, end }
}

// Chain allow (kind 1041): the full allowed chain ID list.
, mnx_act_chain_allow = function(act) {
    if(!act || Number(act.kind) !== 1041){ return null }
    let json = mnx_act_json(act)
    let chains = json ? json.chains : null
    if(!Array.isArray(chains) || !chains.length){ return null }
    let ids = []
    for(let i = 0; i < chains.length; i++){
        let id = mnx_act_uint(chains[i], 4294967295)
        if(id == null){ return null }
        ids.push(id)
    }
    return { chains: ids }
}

// Balance floor (kind 1043): per-asset thresholds keep full wire order;
// zero components impose no check at execution and are dropped here too.
, mnx_act_balance_floor = function(act, review) {
    if(!act || Number(act.kind) !== 1043){ return null }
    let json = mnx_act_json(act)
    if(!json){ return null }
    let addr = mnx_act_endpoint(act, 'addr', review)
    if(!addr){ return null }
    let parts = []
    if(typeof json.hacash === 'string' && json.hacash !== '0:0'){
        parts.push({ type: 'hac', amount: mnx_fin_to_decimal(json.hacash) })
    }
    let sat = typeof json.satoshi === 'string' && /^\d+$/.test(json.satoshi) ? json.satoshi : (Number.isSafeInteger(json.satoshi) && json.satoshi >= 0 ? String(json.satoshi) : null)
    if(sat == null){ return null }
    if(BigInt(sat) > 0n){ parts.push({ type: 'satoshi', atoms: sat }) }
    let dia = mnx_act_uint(json.diamond, Number.MAX_SAFE_INTEGER)
    if(dia > 0){ parts.push({ type: 'hacd', count: dia }) }
    if(Array.isArray(json.assets)){
        for(let i = 0; i < json.assets.length; i++){
            let e = json.assets[i] || {}
            let serial = mnx_act_uint(e.serial, Number.MAX_SAFE_INTEGER)
            let atoms = typeof e.amount === 'string' && /^\d+$/.test(e.amount) ? e.amount : (Number.isSafeInteger(e.amount) && e.amount >= 0 ? String(e.amount) : null)
            if(serial == null || atoms == null || BigInt(atoms) === 0n){ return null }
            parts.push({ type: 'asset', serial: String(serial), atoms })
        }
    }
    return { addr, parts }
}

// Required signers (kind 1044): the complete signer list (addresses or
// address-table pointers, resolved through the SDK address table).
, mnx_act_required_signers = function(act, review) {
    if(!act || Number(act.kind) !== 1044){ return null }
    let json = mnx_act_json(act)
    let signers = json ? json.signers : null
    if(!Array.isArray(signers) || !signers.length){ return null }
    let table = (review && review.address_table) || []
    let out = []
    for(let i = 0; i < signers.length; i++){
        let s = signers[i]
        if(typeof s === 'string' && s){ out.push({ kind: 'address', value: s }) ; continue }
        let pointer = mnx_act_uint(s, 235)
        if(pointer == null){ return null }
        out.push({ kind: 'pointer', index: pointer, resolved: typeof table[pointer] === 'string' ? table[pointer] : null })
    }
    return { signers: out }
}

// Message / blob payload carriers (kinds 1025 / 1026).
, mnx_act_payload = function(act) {
    let kind = Number(act && act.kind)
    if(kind !== 1025 && kind !== 1026){ return null }
    let json = mnx_act_json(act)
    let data = json ? json.data : null
    if(typeof data !== 'string' || !/^(?:0x)?(?:[0-9a-fA-F]{2})*$/.test(data)){ return null }
    let clean = data.replace(/^0x/i, '')
    return {
        kind,
        bytes: clean.length / 2,
        text: kind === 1025 ? mnx_act_user_text(data) : null,
        hex: clean.toLowerCase(),
    }
}

// Inscriptions (kinds 32-36). Content keeps the protocol text boundary.
, mnx_act_inscription = function(act) {
    let kind = Number(act && act.kind)
    if(kind < 32 || kind > 36){ return null }
    let json = mnx_act_json(act)
    if(!json){ return null }
    let cost = typeof json.protocol_cost === 'string' && json.protocol_cost !== '0:0' ? mnx_fin_to_decimal(json.protocol_cost) : null
    let names = list => mnx_split_diamond_names(list)
    if(kind === 32){
        let type = mnx_act_uint(json.engraved_type, 255)
        if(type == null){ return null }
        return { kind, op: 'push', engraved_type: type, diamonds: names(json.diamonds), content: mnx_act_user_text(json.engraved_content), cost }
    }
    if(kind === 33){ return { kind, op: 'clean', diamonds: names(json.diamonds), cost } }
    let index = mnx_act_uint(json.index, 255)
    if(index == null){ return null }
    if(kind === 34){
        let type = mnx_act_uint(json.engraved_type, 255)
        if(type == null){ return null }
        return { kind, op: 'edit', engraved_type: type, diamond: String(json.diamond || '').trim(), index, content: mnx_act_user_text(json.engraved_content), cost }
    }
    if(kind === 35){ return { kind, op: 'move', from: String(json.from_diamond || '').trim(), to: String(json.to_diamond || '').trim(), index, cost } }
    return { kind, op: 'drop', diamond: String(json.diamond || '').trim(), index, cost }
}

// Channels (kinds 2 / 3).
, mnx_act_channel = function(act) {
    let kind = Number(act && act.kind)
    if(kind !== 2 && kind !== 3){ return null }
    let json = mnx_act_json(act)
    if(!json || typeof json.channel_id !== 'string'){ return null }
    let id = json.channel_id.replace(/^0x/i, '').toLowerCase()
    if(!/^[0-9a-f]{32}$/.test(id)){ return null }
    if(kind === 3){ return { kind, close: true, id } }
    let left = json.left_bill || {}, right = json.right_bill || {}
    if(typeof left.address !== 'string' || typeof right.address !== 'string'){ return null }
    return {
        kind,
        close: false,
        id,
        left: { address: left.address, amount: typeof left.amount === 'string' ? mnx_fin_to_decimal(left.amount) : null },
        right: { address: right.address, amount: typeof right.amount === 'string' ? mnx_fin_to_decimal(right.amount) : null },
    }
}

// Asset registration (kind 16): display-only decode of the metadata fields.
, mnx_asset_registration_facts = function(act) {
    if(!act || Number(act.kind) !== 16){ return null }
    let json = mnx_act_json(act)
    let meta = json && json.metadata
    if(!meta){ return null }
    let decode = value => {
        if(typeof value !== 'string' || !/^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(value)){ return null }
        let decoded = mnx_hex_to_utf8(value)
        return decoded && !/[\u0000-\u001f\u007f]/.test(decoded) ? `"${decoded.replace(/["\\]/g, '\\$&')}"` : null
    }
    return {
        serial: mnx_act_uint(meta.serial, Number.MAX_SAFE_INTEGER) == null ? null : String(meta.serial),
        ticket: decode(meta.ticket),
        name: decode(meta.name),
        issuer: typeof meta.issuer === 'string' ? meta.issuer : null,
        supply: (typeof meta.supply === 'string' && /^\d+$/.test(meta.supply)) || (typeof meta.supply === 'number' && Number.isSafeInteger(meta.supply) && meta.supply >= 0) ? String(meta.supply) : null,
        decimals: mnx_act_uint(meta.decimal, 255),
        protocol_cost: typeof json.protocol_cost === 'string' ? json.protocol_cost : null,
    }
}

// Contract deploy address = version byte + RIPEMD160(SHA3-256(main raw || nonce BE)).
// Wallet-derived display fact (consensus derivation, display-only); the SDK
// action JSON remains the exact wire fields. Hash helpers moved verbatim from
// moneynx_txview.js — do not reimplement.
, mnx_sha3_256_bytes = input => {
    const mask = (1n << 64n) - 1n
    const rotations = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]
    const roundConstants = [
        0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
        0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
        0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
        0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
        0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
        0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
    ]
    let state = new Array(25).fill(0n)
    let padded = Array.from(input)
    padded.push(0x06)
    while(padded.length % 136 !== 135){ padded.push(0) }
    padded.push(0x80)
    let rotl = (x, n) => n ? ((x << BigInt(n)) | (x >> BigInt(64 - n))) & mask : x
    for(let offset = 0; offset < padded.length; offset += 136){
        for(let i = 0; i < 136; i++){
            state[i >> 3] ^= BigInt(padded[offset + i]) << BigInt((i & 7) * 8)
        }
        for(let rc of roundConstants){
            let c = new Array(5), d = new Array(5), b = new Array(25)
            for(let x = 0; x < 5; x++){ c[x] = state[x] ^ state[x+5] ^ state[x+10] ^ state[x+15] ^ state[x+20] }
            for(let x = 0; x < 5; x++){ d[x] = c[(x+4)%5] ^ rotl(c[(x+1)%5], 1) }
            for(let y = 0; y < 5; y++) for(let x = 0; x < 5; x++){
                let i = x + 5*y
                b[y + 5*((2*x + 3*y)%5)] = rotl(state[i] ^ d[x], rotations[i])
            }
            for(let y = 0; y < 5; y++) for(let x = 0; x < 5; x++){
                let i = x + 5*y
                state[i] = (b[i] ^ ((~b[(x+1)%5 + 5*y]) & b[(x+2)%5 + 5*y])) & mask
            }
            state[0] ^= rc
        }
    }
    let digest = new Uint8Array(32)
    for(let i = 0; i < digest.length; i++){ digest[i] = Number((state[i >> 3] >> BigInt((i & 7) * 8)) & 0xffn) }
    return digest
}
, mnx_base58check_decode = text => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    if(typeof text !== 'string' || !text.length){ return null }
    let bytes = [0]
    for(let char of text){
        let digit = alphabet.indexOf(char)
        if(digit < 0){ return null }
        let carry = digit
        for(let i = 0; i < bytes.length; i++){
            let value = bytes[i] * 58 + carry
            bytes[i] = value & 255
            carry = value >> 8
        }
        while(carry){ bytes.push(carry & 255); carry >>= 8 }
    }
    let zeros = 0
    while(zeros < text.length && text[zeros] === '1'){ zeros++ }
    while(bytes.length > 1 && bytes[bytes.length - 1] === 0){ bytes.pop() }
    let full = new Uint8Array(zeros + bytes.length)
    for(let i = 0; i < bytes.length; i++){ full[full.length - 1 - i] = bytes[i] }
    if(full.length !== 25 || typeof CryptoJS === 'undefined' || !CryptoJS.SHA256){ return null }
    let payload = full.slice(0, 21), checksum = full.slice(21)
    let hex = Array.from(payload, b => b.toString(16).padStart(2, '0')).join('')
    let expected = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hex)).toString()
    expected = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(expected)).toString().slice(0, 8)
    let actual = Array.from(checksum, b => b.toString(16).padStart(2, '0')).join('')
    return expected === actual ? payload : null
}
, mnx_contract_deploy_address = (main, nonce) => {
    try {
        let rawMain = mnx_base58check_decode(main)
        let n = BigInt(String(nonce))
        if(!rawMain || rawMain[0] > 255 || n < 0n || n > 0xffffffffn || typeof CryptoJS === 'undefined' || !CryptoJS.RIPEMD160){ return null }
        let preimage = new Uint8Array(25)
        preimage.set(rawMain, 0)
        preimage[21] = Number((n >> 24n) & 255n)
        preimage[22] = Number((n >> 16n) & 255n)
        preimage[23] = Number((n >> 8n) & 255n)
        preimage[24] = Number(n & 255n)
        let hash = mnx_sha3_256_bytes(preimage)
        let hashHex = Array.from(hash, b => b.toString(16).padStart(2, '0')).join('')
        let digest = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(hashHex)).toString()
        let address = mnx_hex_to_bytes('01' + digest)
        return mnx_base58check_encode(address)
    } catch(e){ return null }
}
, mnx_contract_deployment_facts = (act, main) => {
    if(!act || Number(act.kind) !== 40){ return null }
    let json = mnx_act_json(act)
    if(!json){ return null }
    let nonce = mnx_act_uint(json.nonce, 4294967295)
    let address = nonce == null ? null : mnx_contract_deploy_address(main, nonce)
    return { nonce, address }
}

// HACD mint (kind 4): name / number / receiver, and custom-message presence
// is a display note only (the message hash itself stays in canonical JSON).
, mnx_act_diamond_mint = function(act) {
    if(!act || Number(act.kind) !== 4){ return null }
    let json = mnx_act_json(act)
    let d = json && json.d
    if(!d){ return null }
    return {
        diamond: String(d.diamond || '').trim(),
        number: mnx_act_uint(d.number, Number.MAX_SAFE_INTEGER),
        address: typeof d.address === 'string' ? d.address : null,
        customMessage: d.custom_message != null && d.custom_message !== '0x' + '0'.repeat(64),
    }
}

;
