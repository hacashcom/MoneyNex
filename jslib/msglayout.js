/**
 * TxMessage / TxBlob display parsing: wallet-predefined protocol-level extractors; layout is data.
 *
 * Item forms (name is an untrusted annotation; "" same as omitted):
 *   [field_id]
 *   [field_id, "name"]
 *   [field_id, "", len]
 * Variable-length fields also accept [field_id, "name", len].
 *
 * Sequential split must cover the data exactly; on failure show only the error + raw HEX, never half-parsed pretty fields.
 */
var MNX_MSG_KIND_MESSAGE = 1025
, MNX_MSG_KIND_BLOB = 1026
, MNX_HACD_NAME_CHARS = 'WTYUIAHXVMEKBSZN'
, MNX_MSG_NAME_MAX = 24
, MNX_MSG_FIELD = {
    hacash_addr21: { size: 21, label: 'Hacash Address' },
    evm_addr20:    { size: 20, label: 'EVM Address' },
    u8:            { size: 1,  label: 'U8' },
    u16be:         { size: 2,  label: 'U16' },
    u32be:         { size: 4,  label: 'U32' },
    u64be:         { size: 8,  label: 'U64' },
    magic4:        { size: 4,  label: 'Magic' },
    hex4:          { size: 4,  label: 'HEX' },
    hacd_name:     { size: 6,  label: 'HACD' },
    hac_zhu:       { size: 0,  label: 'HAC (message)', variable: true },
    hacd_names:    { size: 0,  label: 'HACD', variable: true },
    asset_serial_amt: { size: 0, label: 'Asset', variable: true },
    ascii:         { size: 0,  label: 'Text', variable: true },
    hex:           { size: 0,  label: 'HEX', variable: true },
}
, MNX_MSG_FIELD_ALIAS = {
    addr: 'hacash_addr21', hacash: 'hacash_addr21', address: 'hacash_addr21',
    evm: 'evm_addr20', evm20: 'evm_addr20',
    u16: 'u16be', u32: 'u32be', u64: 'u64be',
    ascii4: 'magic4',
    hac: 'hac_zhu', amount: 'hac_zhu',
    hacd: 'hacd_name', hacds: 'hacd_names',
    asset: 'asset_serial_amt',
    text: 'ascii', bytes: 'hex',
}

, mnx_esc_html = function(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

, mnx_bytes_to_hex = function(u8) {
    let s = ''
    for(let i = 0; i < u8.length; i++){
        s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16)
    }
    return s
}

, mnx_hex_to_bytes = function(hex) {
    hex = String(hex || '').replace(/^0x/i, '')
    if(hex.length % 2){ return null }
    if(hex.length && !/^[0-9a-fA-F]+$/.test(hex)){ return null }
    let out = new Uint8Array(hex.length / 2)
    for(let i = 0; i < hex.length; i += 2){
        out[i / 2] = parseInt(hex.substr(i, 2), 16)
    }
    return out
}

, mnx_read_uint_be = function(u8) {
    let v = 0n
    for(let i = 0; i < u8.length; i++){
        v = (v << 8n) | BigInt(u8[i])
    }
    return v.toString()
}

, mnx_is_printable_ascii = function(u8) {
    for(let i = 0; i < u8.length; i++){
        if(u8[i] < 0x20 || u8[i] > 0x7e){ return false }
    }
    return true
}

, mnx_bytes_to_ascii = function(u8) {
    let s = ''
    for(let i = 0; i < u8.length; i++){ s += String.fromCharCode(u8[i]) }
    return s
}

// Render as text only when it is valid UTF-8 without control characters; otherwise
// return null (the caller falls back to the hexadecimal source data — bad bytes are
// never rendered as text; fields like magic can carry arbitrary payload)
, mnx_utf8_text = function(u8) {
    if(typeof TextDecoder === 'undefined'){ return null }
    let s
    try {
        s = new TextDecoder('utf-8', { fatal: true }).decode(u8)
    } catch(e) {
        return null
    }
    for(let i = 0; i < s.length; i++){
        let c = s.charCodeAt(i)
        if(c < 0x20 || c === 0x7f){ return null }
    }
    return s
}

, mnx_sanitize_note = function(name) {
    if(name == null){ return '' }
    let s = String(name)
    let out = ''
    for(let i = 0; i < s.length && out.length < MNX_MSG_NAME_MAX; i++){
        let c = s.charCodeAt(i)
        if(c >= 0x20 && c <= 0x7e && c != 0x3c && c != 0x3e){ out += s.charAt(i) }
    }
    return out.trim()
}

, mnx_resolve_field_id = function(id) {
    id = String(id || '').trim()
    if(MNX_MSG_FIELD[id]){ return id }
    if(MNX_MSG_FIELD_ALIAS[id]){ return MNX_MSG_FIELD_ALIAS[id] }
    return null
}

, mnx_sha256_hex = function(hex) {
    if(typeof CryptoJS !== 'undefined' && CryptoJS.SHA256){
        return CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hex)).toString()
    }
    return null
}

, mnx_base58check_encode = function(payload) {
    let hex = mnx_bytes_to_hex(payload)
    let h1 = mnx_sha256_hex(hex)
    if(!h1){ return null }
    let h2 = mnx_sha256_hex(h1)
    if(!h2){ return null }
    let chk = h2.substr(0, 8)
    let full = hex + chk
    const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let bytes = mnx_hex_to_bytes(full)
    let zeros = 0
    while(zeros < bytes.length && bytes[zeros] === 0){ zeros++ }
    let digits = [0]
    for(let i = zeros; i < bytes.length; i++){
        let carry = bytes[i]
        for(let j = 0; j < digits.length; j++){
            let x = digits[j] * 256 + carry
            digits[j] = x % 58
            carry = (x / 58) | 0
        }
        while(carry > 0){
            digits.push(carry % 58)
            carry = (carry / 58) | 0
        }
    }
    let s = ''
    for(let i = 0; i < zeros; i++){ s += '1' }
    for(let i = digits.length - 1; i >= 0; i--){ s += ALPH.charAt(digits[i]) }
    return s
}

, mnx_hacash_addr21 = function(u8) {
    if(u8.length !== 21){ return { err: 'hacash address must be 21 bytes' } }
    let ver = u8[0]
    if(ver !== 0 && ver !== 1 && ver !== 5){
        return { err: 'unsupported hacash address version '+ver }
    }
    let readable = mnx_base58check_encode(u8)
    return { text: readable || ('0x'+mnx_bytes_to_hex(u8)), cls: 'maddr' }
}

, mnx_fold64_decode = function(buf) {
    if(!buf.length){ return { err: 'buffer too short for Fold64' } }
    let n = buf[0] >> 5
    if(buf.length < 1 + n){ return { err: 'Fold64 truncated' } }
    let value = BigInt(buf[0] & 0x1f)
    for(let i = 0; i < n; i++){
        value = (value << 8n) | BigInt(buf[1 + i])
    }
    if(value > 0x1fffffffffffffffn){ return { err: 'Fold64 exceeds max' } }
    let expect
    if(value < 32n){ expect = 1 }
    else {
        let bits = value.toString(2).length
        let extra = bits > 5 ? bits - 5 : 0
        expect = 1 + Math.ceil(extra / 8)
    }
    if(expect !== 1 + n){ return { err: 'Fold64 non-canonical' } }
    return { value: value.toString(), used: 1 + n }
}

, mnx_amount_decode = function(buf) {
    if(buf.length < 2){ return { err: 'amount truncated' } }
    let unit = buf[0]
    let dist_u = buf[1]
    if(dist_u === 128){ return { err: 'amount dist invalid' } }
    let dist = dist_u > 127 ? dist_u - 256 : dist_u
    let n = dist < 0 ? -dist : dist
    if(buf.length !== 2 + n){ return { err: 'amount length mismatch' } }
    let mant = buf.subarray(2, 2 + n)
    if(n > 1){
        let allz = true
        for(let i = 0; i < n; i++){ if(mant[i]){ allz = false; break } }
        if(allz){ return { err: 'multi-byte amount cannot be all zero' } }
        if(mant[0] === 0){ return { err: 'amount leading zero' } }
    }
    let allz = true
    for(let i = 0; i < n; i++){ if(mant[i]){ allz = false; break } }
    if(allz && (unit !== 0 || dist !== 0 || n !== 0)){
        return { err: 'amount zero not canonical' }
    }
    let mag = n ? mnx_read_uint_be(mant) : '0'
    let xu = (dist < 0 ? '-' : '') + mag + ':' + unit
    let dec = (typeof mnx_fin_to_decimal === 'function') ? mnx_fin_to_decimal(xu) : xu
    return { text: dec + ' HAC', cls: 'amt', xu: xu }
}

, mnx_extract_field = function(fid, slice) {
    if(fid === 'hacash_addr21'){ return mnx_hacash_addr21(slice) }
    if(fid === 'evm_addr20'){
        return { text: '0x' + mnx_bytes_to_hex(slice), cls: 'evm' }
    }
    if(fid === 'u8' || fid === 'u16be' || fid === 'u32be' || fid === 'u64be'){
        // main value in decimal; the hexadecimal goes into a separate gray source-data (src)
// row instead of being stuffed into the main value's parentheses
        return { text: mnx_read_uint_be(slice), cls: 'uint', src: '0x' + mnx_bytes_to_hex(slice) }
    }
    if(fid === 'magic4'){
        // quoted text only for valid UTF-8; the gray 0x source data is attached **whether or not** it is valid
        let txt = mnx_utf8_text(slice)
        return {
            text: txt == null ? '' : '"' + txt + '"',
            cls: 'magic',
            src: '0x' + mnx_bytes_to_hex(slice),
        }
    }
    if(fid === 'hex4' || fid === 'hex'){
        // values that are HEX already: shown in white monospace, no gray source data (they ARE the source)
        return { text: '0x' + mnx_bytes_to_hex(slice), cls: 'hex', hex: true }
    }
    if(fid === 'hacd_name'){
        if(!mnx_is_printable_ascii(slice)){ return { err: 'hacd name not ascii' } }
        let name = mnx_bytes_to_ascii(slice)
        for(let i = 0; i < name.length; i++){
            if(MNX_HACD_NAME_CHARS.indexOf(name.charAt(i)) < 0){
                return { err: 'invalid hacd name char' }
            }
        }
        return { text: name, cls: 'hacd' }
    }
    if(fid === 'hacd_names'){
        if(slice.length % 6){ return { err: 'hacd_names length must be 6n' } }
        let names = []
        for(let i = 0; i < slice.length; i += 6){
            let one = mnx_extract_field('hacd_name', slice.subarray(i, i + 6))
            if(one.err){ return one }
            names.push(one.text)
        }
        return { text: names.join(', '), cls: 'hacd' }
    }
    if(fid === 'hac_zhu'){
        return mnx_amount_decode(slice)
    }
    if(fid === 'asset_serial_amt'){
        let a = mnx_fold64_decode(slice)
        if(a.err){ return a }
        if(a.value === '0'){ return { err: 'asset serial cannot be zero' } }
        let rest = slice.subarray(a.used)
        let b = mnx_fold64_decode(rest)
        if(b.err){ return b }
        if(a.used + b.used !== slice.length){ return { err: 'asset field leftover' } }
        return { text: 'Asset#' + a.value + ' ' + b.value, cls: 'asset' }
    }
    if(fid === 'ascii'){
        if(!mnx_is_printable_ascii(slice)){ return { err: 'text is not printable ascii' } }
        return { text: mnx_bytes_to_ascii(slice), cls: 'text' }
    }
    return { err: 'unknown field_id' }
}

, mnx_parse_layout_item = function(item) {
    if(typeof item === 'string'){ item = [item] }
    if(!Array.isArray(item) || !item.length){ return { err: 'layout item must be an array' } }
    let fid = mnx_resolve_field_id(item[0])
    if(!fid){ return { err: 'unknown field_id '+item[0] } }
    let spec = MNX_MSG_FIELD[fid]
    let note = ''
    let len = null
    if(item.length >= 2){
        if(typeof item[1] === 'number'){
            len = item[1]
        }else{
            note = mnx_sanitize_note(item[1])
        }
    }
    if(item.length >= 3){
        if(typeof item[2] !== 'number' || !isFinite(item[2]) || item[2] < 0 || (item[2]|0) !== item[2]){
            return { err: 'len must be a non-negative integer' }
        }
        len = item[2]
    }
    if(spec.variable){
        if(len == null){ return { err: fid+' requires len' } }
        if(len < 1){ return { err: fid+' len must be > 0' } }
    }else{
        if(len == null){ len = spec.size }
        else if(len !== spec.size){ return { err: fid+' length must be '+spec.size } }
    }
    return { fid: fid, note: note, len: len, spec: spec }
}

/**
 * Sequentially split bytes; must cover exactly. Returns {ok:1, fields:[...]} on success, {ok:0, err} on failure.
 */
, mnx_msglayout_parse = function(bytes, layout) {
    if(!bytes){ return { ok: 0, err: 'empty message' } }
    if(!Array.isArray(layout) || !layout.length){ return { ok: 0, err: 'empty layout' } }
    let off = 0
    let fields = []
    for(let i = 0; i < layout.length; i++){
        let it = mnx_parse_layout_item(layout[i])
        if(it.err){ return { ok: 0, err: 'item '+i+': '+it.err } }
        if(off + it.len > bytes.length){
            return { ok: 0, err: 'item '+i+' ('+it.fid+') overruns message' }
        }
        let slice = bytes.subarray(off, off + it.len)
        let got = mnx_extract_field(it.fid, slice)
        if(got.err){ return { ok: 0, err: 'item '+i+' ('+it.fid+'): '+got.err } }
        fields.push({
            fid: it.fid,
            label: it.spec.label,
            note: it.note,
            text: got.text,
            src: got.src || '',
            cls: got.cls || '',
            hex: !!got.hex || it.fid === 'hex' || it.fid === 'hex4',
            rawhex: mnx_bytes_to_hex(slice),
        })
        off += it.len
    }
    if(off !== bytes.length){
        return { ok: 0, err: 'layout covered '+off+' of '+bytes.length+' bytes' }
    }
    return { ok: 1, fields: fields }
}

, mnx_msglayout_normalize = function(extra) {
    extra = extra || {}
    let tables = { byMsgIndex: {}, byActionIndex: {}, single: null }
    let put = function(layout, meta) {
        if(!Array.isArray(layout)){ return }
        meta = meta || {}
        let hasId = meta.id != null && meta.id !== ''
        let hasAct = meta.action != null && meta.action !== ''
        if(hasAct){
            let ai = parseInt(meta.action, 10)
            if(!isNaN(ai)){ tables.byActionIndex[ai] = layout }
        }
        if(hasId){
            let mi = parseInt(meta.id, 10)
            if(!isNaN(mi)){ tables.byMsgIndex[mi] = layout }
        }
        if(!hasId && !hasAct){ tables.single = layout }
    }
    let addEntry = function(ent) {
        if(!ent){ return }
        if(Array.isArray(ent)){ put(ent, {}); return }
        if(typeof ent !== 'object'){ return }
        let layout = ent.layout || ent.msglayout || ent.fields
        let id = ent.id != null ? ent.id : (ent.msgid != null ? ent.msgid : ent.msg_id)
        let action = ent.action_id != null ? ent.action_id : ent.action
        put(layout, { id: id, action: action })
    }
    let many = extra.msglayouts || extra.msg_layouts
    if(Array.isArray(many)){
        for(let i = 0; i < many.length; i++){ addEntry(many[i]) }
    }else if(many && typeof many === 'object'){
        for(let k in many){
            if(!Object.prototype.hasOwnProperty.call(many, k)){ continue }
            let v = many[k]
            if(Array.isArray(v)){ put(v, { id: k }) }
            else { addEntry(Object.assign({ id: k }, v)) }
        }
    }
    let one = extra.msglayout || extra.msg_layout
    if(one){
        let msgid = extra.msgid != null ? extra.msgid : (extra.msg_id != null ? extra.msg_id : extra.message_id)
        let action_id = extra.action_id != null ? extra.action_id : extra.action
        put(one, { id: msgid, action: action_id })
    }
    return tables
}

, mnx_is_tx_message_action = function(act) {
    if(!act){ return false }
    let kd = act.kind
    if(kd == MNX_MSG_KIND_MESSAGE || kd == MNX_MSG_KIND_BLOB){ return true }
    let n = act.name || ''
    return n === 'tx_message' || n === 'tx_blob'
}

, mnx_msglayout_bind = function(actions, tables) {
    actions = actions || []
    tables = tables || mnx_msglayout_normalize(null)
    let errors = []
    let byArrayIndex = {}
    let slots = []
    for(let i = 0; i < actions.length; i++){
        if(mnx_is_tx_message_action(actions[i])){
            slots.push({ i: i, act: actions[i], id: slots.length })
        }
    }
    for(let k in tables.byActionIndex){
        if(!Object.prototype.hasOwnProperty.call(tables.byActionIndex, k)){ continue }
        let ai = parseInt(k, 10)
        if(isNaN(ai) || ai < 0 || ai >= actions.length){
            errors.push('action_id '+k+' is out of range')
            continue
        }
        if(!mnx_is_tx_message_action(actions[ai])){
            errors.push('action_id '+ai+' is not a message/blob')
        }
    }
    for(let k in tables.byMsgIndex){
        if(!Object.prototype.hasOwnProperty.call(tables.byMsgIndex, k)){ continue }
        let id = parseInt(k, 10)
        if(isNaN(id) || id < 0 || id >= slots.length){
            errors.push('id '+k+' has no message/blob')
        }
    }
    let msgTotal = slots.length
    for(let s = 0; s < slots.length; s++){
        let slot = slots[s]
        let layout = null
        if(tables.byActionIndex[slot.i] != null){ layout = tables.byActionIndex[slot.i] }
        else if(tables.byMsgIndex[slot.id] != null){ layout = tables.byMsgIndex[slot.id] }
        else if(tables.single && msgTotal === 1){ layout = tables.single }
        byArrayIndex[slot.i] = layout
        if(!layout){ continue }
        let got = mnx_action_message_bytes(slot.act)
        if(got.err){
            errors.push('id '+slot.id+' data invalid: '+got.err)
            continue
        }
        let parsed = mnx_msglayout_parse(got.bytes, layout)
        if(!parsed.ok){
            errors.push('id '+slot.id+' layout failed: '+parsed.err)
        }
    }
    return { byArrayIndex: byArrayIndex, errors: errors, slots: slots }
}

, mnx_action_message_bytes = function(act) {
    let hex = ''
    try {
        let j = act.json
        if(typeof j === 'string'){ j = JSON.parse(j) }
        if(j && (j.data != null || j.bytes != null)){
            hex = String(j.data != null ? j.data : j.bytes)
        }
    } catch(e) {}
    hex = hex.replace(/^0x/i, '')
    let bytes = mnx_hex_to_bytes(hex)
    if(!bytes){ return { err: 'message data is not hex', hex: hex, bytes: null } }
    return { bytes: bytes, hex: mnx_bytes_to_hex(bytes) }
}

// Field rendering. mode:
//   'table'  — All Actions review page: two aligned columns (label+note left, value+gray source right)
//   'inline' — signing page: compact single rows, all left-aligned (saves popup width, no fixed columns)
// All-zero HEX fields drop the whole row (e.g. HBR1's extra8 must be 0 for non-HACD assets;
// keeping it would leave a noise row).
, mnx_msglayout_fields_html = function(fields, mode) {
    let table = mode === 'table'
    let html = ''
    for(let i = 0; i < fields.length; i++){
        let f = fields[i]
        if(f.hex && /^0*$/.test(f.rawhex)){ continue } // all-zero HEX value: drop the whole row
        let note = f.note ? `<i class="untrust">${mnx_esc_html(f.note)}</i> ` : ''
        // use code, not span: the signing page styles `#sgtx .tx li > span` as line-number badges;
        // the old `li span` selector squashed any span into a 16x16 block (text stacked vertically)
        let src = f.src ? `<code class="hexsrc">${mnx_esc_html(f.src)}</code>` : ''
        let val = f.hex
            ? mnx_hex_plain(f.rawhex, 'hexplain')
            : `<code class="${mnx_esc_html(f.cls || '')}">${mnx_esc_html(f.text)}</code>`
        if(table){
            html += `<div class="mfrow"><div class="mfk"><b class="fid">${mnx_esc_html(f.label)}</b>${note}</div><div class="mfv">${val}${src}</div></div>`
        }else{
            html += `<div class="mf"><b class="fid">${mnx_esc_html(f.label)}</b>${note}${val}${src}</div>`
        }
    }
    return html
}

// single-line 0x HEX, **no background box**: cls='hexplain' = white value (fields that are
// HEX already) / 'hexgray' = gray source data (magic, the u8..u64 hex sources, and the whole
// payload text). Overlong values truncate and register for click-to-expand (event delegation,
// since MV3 CSP forbids inline handlers).
, mnx_hex_plain = function(rawhex, cls) {
    rawhex = String(rawhex || '').toLowerCase().replace(/[^0-9a-f]/g, '')
    if(!rawhex){ return '' }
    let full = '0x' + rawhex
    cls = cls || 'hexgray'
    if(full.length <= MNX_HEX_PREVIEW_HEAD + MNX_HEX_PREVIEW_TAIL + 4){
        return `<div class="${cls}">${mnx_esc_html(full)}</div>`
    }
    let id = ++mnx_hex_seq
    mnx_hex_registry[id] = full
    let short = full.slice(0, 2 + MNX_HEX_PREVIEW_HEAD) + '…' + full.slice(-MNX_HEX_PREVIEW_TAIL)
    return `<div class="${cls} clickable" data-hexid="${id}" title="Click to open the full HEX in a new page (${rawhex.length / 2} bytes)">${mnx_esc_html(short)}</div>`
}

// De-emphasized single-line HEX display: contiguous lowercase 0x; overlong values are truncated and
// registered in a global table, clicking the block opens the full HEX in a new tab (MV3 CSP forbids
// inline events, so use event delegation; if blob: won't open, fall back to copy).
, mnx_hex_registry = {}
, mnx_hex_seq = 0
, MNX_HEX_PREVIEW_HEAD = 96
, MNX_HEX_PREVIEW_TAIL = 16

, mnx_hex_listener_bound = false
, mnx_hex_bind_delegate = function() {
    if(mnx_hex_listener_bound || typeof document === 'undefined'){ return }
    mnx_hex_listener_bound = true
    document.addEventListener('click', function(ev){
        let el = ev.target && ev.target.closest ? ev.target.closest('.hexdump.clickable') : null
        if(!el){ return }
        let full = mnx_hex_registry[el.getAttribute('data-hexid')]
        if(!full){ return }
        try {
            let url = URL.createObjectURL(new Blob([full], { type: 'text/plain' }))
            if(window.open(url, '_blank')){ return }
        } catch(e) {}
        try { navigator.clipboard.writeText(full) } catch(e) {}
    })
}

, mnx_msglayout_block_html = function(act, layout, mode) {
    mnx_hex_bind_delegate()
    let got = mnx_action_message_bytes(act)
    let raw = got.hex || ''
    let body = ''
    if(!got.err && layout){
        let parsed = mnx_msglayout_parse(got.bytes, layout)
        if(parsed.ok){ body = mnx_msglayout_fields_html(parsed.fields, mode) }
    }
    // the dashed box holds **fields only**; the payload byte count moves up into the action
    // title (mnx_msg_bytes_text) and the source HEX moves outside the box with no background
    // (it is always the on-chain original, not part of the parsed result).
    let box = body ? `<div class="msgf ${mode === 'table' ? 'table' : 'inline'}">${body}</div>` : ''
    return box + mnx_hex_plain(raw, 'hexgray')
}

// payload byte-count text (concatenated into the action title instead of a dashed-box row)
, mnx_msg_bytes_text = function(act) {
    let got = mnx_action_message_bytes(act)
    return (got.bytes ? got.bytes.length : 0) + ' bytes'
}

, mnx_msglayout_state = { tables: null, extra: null, loaded: false, display_err: '' }

, mnx_msglayout_reset = function() {
    mnx_msglayout_state = { tables: null, extra: null, loaded: false, display_err: '' }
}

, mnx_msglayout_load = async function() {
    if(mnx_msglayout_state.loaded){ return mnx_msglayout_state }
    mnx_msglayout_state.loaded = true
    let extra = null
    try {
        if(typeof urlquery !== 'undefined' && urlquery.mlkey && typeof chrome_storage_session !== 'undefined'){
            let obj = await chrome_storage_session.get(urlquery.mlkey)
            extra = obj[urlquery.mlkey] || null
            // delete after use: ml_<tid>_<did> serves only this request (data is already in
            // memory; openactv keeps its own actv_ key) — do not leave it until the session ends
            await chrome_storage_session.remove(urlquery.mlkey)
        }
    } catch(e) {}
    mnx_msglayout_state.extra = extra
    mnx_msglayout_state.tables = mnx_msglayout_normalize(extra)
    mnx_msglayout_state.display_err = ''
    return mnx_msglayout_state
}
;
