/**
 * Asset amount helpers. Fold64 / atoms stay decimal strings; never Number() large protocol ints.
 * Fold64 payload is 5 + 7*8 = 61 value bits, so MAX = 2^61 - 1.
 */
var MNX_ASSET_FOLD64_MAX = (1n << 61n) - 1n

, mnx_u64_string = function(v) {
    if(v == null || v === ''){ return '' }
    if(typeof v === 'bigint'){
        if(v < 0n){ return '' }
        return v.toString()
    }
    if(typeof v === 'number'){
        if(!isFinite(v) || v < 0){ return '' }
        return Math.trunc(v).toString()
    }
    let s = String(v).trim()
    if(!/^[0-9]+$/.test(s)){ return '' }
    try {
        return BigInt(s).toString()
    } catch(e) {
        return ''
    }
}

, mnx_decstr_eq = function(a, b) {
    try {
        return BigInt(String(a)) === BigInt(String(b))
    } catch(e) {
        return false
    }
}

, formatAssetAtoms = function(atoms, decimal) {
    let raw = atoms == null ? '' : String(atoms).trim()
    if(decimal == null || decimal === ''){
        return raw
    }
    let d = decimal
    if(typeof d !== 'number'){
        if(!/^[0-9]+$/.test(String(d))){ return raw }
        d = parseInt(String(d), 10)
    }
    if(!(d >= 0 && d <= 16)){ return raw }
    let s = mnx_u64_string(raw)
    if(s === ''){ return raw }
    if(d === 0){ return s }
    if(s.length <= d){
        s = s.padStart(d + 1, '0')
    }
    let ip = s.slice(0, s.length - d)
    let fp = s.slice(s.length - d).replace(/0+$/, '')
    ip = ip.replace(/^0+(?=\d)/, '')
    if(!fp){ return ip }
    return ip + '.' + fp
}

, parseAssetAmount = function(input, decimal, maxAtoms) {
    let src = input == null ? '' : String(input)
    let s = src.trim()
    if(s !== src.replace(/^\s+|\s+$/g, '') || /[ \t,]/.test(s)){
        return { err: 'Invalid amount' }
    }
    if(!s){ return { err: 'Invalid amount' } }
    if(/[eE+\-]/.test(s)){ return { err: 'Invalid amount' } }
    let d = decimal
    if(typeof d !== 'number'){
        if(!/^[0-9]+$/.test(String(d))){ return { err: 'Invalid amount' } }
        d = parseInt(String(d), 10)
    }
    if(!(d >= 0 && d <= 16)){ return { err: 'Invalid amount' } }
    if(d === 0){
        if(s.indexOf('.') >= 0){ return { err: 'Integer amounts only' } }
        if(!/^[0-9]+$/.test(s)){ return { err: 'Invalid amount' } }
    }else{
        if(!/^[0-9]+(\.[0-9]+)?$/.test(s)){ return { err: 'Invalid amount' } }
    }
    let parts = s.split('.')
    let ip = parts[0]
    let fp = parts[1] || ''
    if(!ip.length){ return { err: 'Invalid amount' } }
    if(fp.length > d){ return { err: 'Too many decimal places' } }
    if(d > 0){ fp = fp.padEnd(d, '0') }
    let atoms
    try {
        atoms = BigInt(ip + fp)
    } catch(e) {
        return { err: 'Invalid amount' }
    }
    if(atoms <= 0n){ return { err: 'Amount must be greater than 0' } }
    if(atoms > MNX_ASSET_FOLD64_MAX){ return { err: 'Amount exceeds maximum' } }
    if(maxAtoms != null && maxAtoms !== ''){
        let mx = mnx_u64_string(maxAtoms)
        if(mx === ''){ return { err: 'Invalid amount' } }
        if(atoms > BigInt(mx)){ return { err: 'Insufficient balance' } }
    }
    return { atoms: atoms.toString() }
}

, mnx_normalize_asset_item = function(raw) {
    if(!raw || typeof raw !== 'object'){ return null }
    let serial = mnx_u64_string(raw.serial)
    if(!serial || serial === '0'){ return null }
    let atoms = mnx_u64_string(raw.amount != null ? raw.amount : raw.atoms)
    if(atoms === ''){ atoms = '0' }
    let name = (raw.name == null ? '' : String(raw.name)).trim()
    let ticket = (raw.ticket == null ? '' : String(raw.ticket)).trim()
    let decimal = raw.decimal
    let metaOk = raw.metadata !== false
    if(decimal == null || decimal === ''){
        metaOk = false
    }else{
        let dn = typeof decimal === 'number' ? decimal : parseInt(String(decimal), 10)
        if(!(dn >= 0 && dn <= 16) || dn !== dn){ metaOk = false }
        else { decimal = dn }
    }
    if(!metaOk){
        return {
            serial: serial,
            atoms: atoms,
            decimal: null,
            name: name || ('Asset #' + serial),
            ticket: ticket,
            displayAmount: atoms,
            metadata: false,
        }
    }
    return {
        serial: serial,
        atoms: atoms,
        decimal: decimal,
        name: name || ('Asset #' + serial),
        ticket: ticket,
        displayAmount: formatAssetAtoms(atoms, decimal),
        metadata: true,
    }
}

, mnx_normalize_asset_list = function(assets) {
    if(assets == null){ return { list: [] } }
    if(!Array.isArray(assets)){ return { err: 'Invalid assets response' } }
    let list = []
    for(let i = 0; i < assets.length; i++){
        let one = mnx_normalize_asset_item(assets[i])
        if(one){ list.push(one) }
    }
    return { list: list }
}

, mnx_asset_log_amount = function(atoms, decimal, name) {
    let amt = (decimal == null || decimal === '') ? (atoms == null ? '' : String(atoms)) : formatAssetAtoms(atoms, decimal)
    return (amt ? amt + ' ' : '') + (name || 'Asset')
}

, mnx_review_asset_match = function(review, serial, atoms, to) {
    let acts = (review && review.actions) || []
    for(let i = 0; i < acts.length; i++){
        let act = acts[i]
        let p = act.transfer && act.transfer.payload
        if(!p || p.type != 'asset'){ continue }
        let gotSerial = p.serial
        let gotAtoms = p.atoms
        if(gotAtoms != null && String(gotAtoms).indexOf(':') >= 0){
            gotAtoms = String(gotAtoms).split(':')[0]
        }
        if(!mnx_decstr_eq(gotSerial, serial)){
            return { err: 'Review serial does not match the Asset being sent' }
        }
        if(!mnx_decstr_eq(gotAtoms, atoms)){
            return { err: 'Review amount does not match the Asset being sent' }
        }
        if(to && act.transfer.to && act.transfer.to !== to){
            return { err: 'Review destination does not match the recipient' }
        }
        return { ok: true }
    }
    return { err: 'Review does not contain the expected Asset transfer' }
}

, mnx_tx_log_icon_file = function(type) {
    if(type == 'HAC'){ return 'hac.svg' }
    if(type == 'HACD'){ return 'hacd.svg' }
    if(type == 'SAT'){ return 'btc.svg' }
    if(type == 'ASSET'){ return 'asset.svg' }
    if(type == 'MUL'){ return 'ftag.svg' }
    return 'trade.svg'
}

// ---------- asset metadata cache (serial -> {decimal, name, ticket}) ----------
// Why this lives in the wallet and not the SDK: the SDK is an offline/stateless fact
// provider that only sees review.asset_serials and raw atoms; decimal/name/ticket come
// from on-chain AssetSmelt (needs chain state), so only the wallet can query them.
// An issued asset's decimal/name/ticket are immutable (only supply changes, which the
// display never uses), so the cache never expires; only successful lookups are cached,
// misses retry next time. atoms stay strings throughout (Fold64 can exceed 2^53).
, mnx_asset_meta_storage_key = 'asset_meta_cache'
, mnx_asset_meta_mem = null
, mnx_asset_meta_norm = function(raw) {
    if(!raw || typeof raw !== 'object' || raw.metadata === false){ return null }
    let decimal = raw.decimal
    if(decimal == null || decimal === ''){ return null }
    let d = typeof decimal === 'number' ? decimal : parseInt(String(decimal), 10)
    if(!(d >= 0 && d <= 16)){ return null }
    return {
        decimal: d,
        name: (raw.name == null ? '' : String(raw.name)).trim(),
        ticket: (raw.ticket == null ? '' : String(raw.ticket)).trim(),
    }
}
, mnx_asset_meta_load = async function(force) {
    if(mnx_asset_meta_mem && !force){ return mnx_asset_meta_mem }
    let mem = {}
    try {
        let got = await chrome.storage.local.get(mnx_asset_meta_storage_key)
        let saved = got && got[mnx_asset_meta_storage_key]
        if(saved && typeof saved === 'object'){
            for(let k in saved){
                let one = mnx_asset_meta_norm(saved[k])
                if(one){ mem[k] = one }
            }
        }
    } catch(e) {}
    mnx_asset_meta_mem = mem
    return mem
}
// Synchronous read (for render functions): await mnx_asset_meta_ensure(serials) first
, mnx_asset_meta_get = function(serial) {
    if(!mnx_asset_meta_mem){ return null }
    let s = mnx_u64_string(serial)
    return s ? (mnx_asset_meta_mem[s] || null) : null
}
, mnx_asset_meta_save = async function(mem) {
    mnx_asset_meta_mem = mem
    try {
        let sv = {}
        sv[mnx_asset_meta_storage_key] = mem
        await chrome.storage.local.set(sv)
    } catch(e) {}
}
// Batch fill: memory -> storage -> fullnode /query/asset?serial=N (address-independent;
// queryable even when the signer does not hold the asset)
, mnx_asset_meta_ensure = async function(serials) {
    let want = []
    for(let i in (serials || [])){
        let s = mnx_u64_string(serials[i])
        if(s && want.indexOf(s) < 0){ want.push(s) }
    }
    if(!want.length){ return await mnx_asset_meta_load() }
    let mem = await mnx_asset_meta_load()
    let miss = want.filter(s => !mem[s])
    if(miss.length){
        mem = await mnx_asset_meta_load(true) // other pages may have just written; re-read storage first
        miss = want.filter(s => !mem[s])
    }
    if(!miss.length){ return mem }
    let base = fullnode_url
    try { base = (typeof mnx_get_fullnode_url === 'function') ? await mnx_get_fullnode_url() : fullnode_url } catch(e) {}
    let changed = false
    for(let i in miss){
        let serial = miss[i]
        let res = await do_fetch_get(base + '/query/asset?serial=' + encodeURIComponent(serial))
        let one = mnx_asset_meta_norm(res && res.asset)
        if(one){ mem[serial] = one; changed = true }
    }
    if(changed){ await mnx_asset_meta_save(mem) }
    return mem
}
// The home page's /query/balance?assets=true&asset_meta=true result merges into the same
// cache, so signing pages need no extra request
, mnx_asset_meta_put_list = async function(list) {
    let mem = await mnx_asset_meta_load()
    let changed = false
    for(let i in (list || [])){
        let one = list[i]
        let serial = mnx_u64_string(one && one.serial)
        let norm = mnx_asset_meta_norm(one)
        if(serial && norm && !mem[serial]){ mem[serial] = norm; changed = true }
    }
    if(changed){ await mnx_asset_meta_save(mem) }
    return mem
}
// Display text: unknown metadata returns raw atoms with known=false — never guess decimals
, mnx_asset_amount_text = function(atoms, serial) {
    let raw = atoms == null ? '' : String(atoms).trim()
    let meta = mnx_asset_meta_get(serial)
    if(!meta){
        return { text: raw, unit: '', known: false }
    }
    return {
        text: formatAssetAtoms(raw, meta.decimal),
        unit: meta.ticket || meta.name || '',
        known: true,
    }
}

;
