/**
 * MoneyNex tx view/flow layer (split out of popup/login/login.js; code moved verbatim).
 *
 * Everything between the storage layer (login.js sto*) and the page controllers:
 * fullnode RPC for tx flow (fee suggestion / query / submit), local SDK
 * review+sign pipeline, tx-json -> ActionSpec rebuild (raisefee), DApp result
 * compatibility layer, VM decompile, and the signing-page description renderer.
 *
 * Bundle position (build.js pppjslibs): after facade/msglayout/assetamt/importkey,
 * before the popup pages. All cross-file references (login.js storage vars,
 * html.js helpers) resolve at call time — nothing here runs at load time.
 */
// Decoded diamonds come as a comma string (multi-name) or a single-name diamond
// field (or an array); normalize to a trimmed non-empty name array. Shared by
// txjson_to_spec / parseTxDesc / the actionview renderer / the transfer page.
var mnx_split_diamond_names = (v) => {
    if(v == null){ return [] }
    let arr = typeof v === 'string' ? v.split(',') : v
    return arr.map(s=>(s+'').trim()).filter(s=>s.length>0)
}

var reqFeasibleFee = async (txsz, opts) => {
    let url = (await mnx_get_fullnode_url())+"/query/fee/average?unit=mei"
    if(txsz > 0){
        url += `&consumption=${txsz}`
    }
    opts = opts || {}
    if(opts.extra9){
        url += '&extra9=true'
    }
    if(opts.tx_type != null){
        url += `&tx_type=${encodeURIComponent(opts.tx_type)}`
    }
    return do_fetch_get(url)
}
, jsdttyhdr = {
    "Content-Type": "application/json"
}
, proxyFullnodeApiPost = async (path, bodydata, params) => {
    let url = (await mnx_get_fullnode_url())+path+"?";
    params = params || {}
    for(let k in params){
        url += `${k}=${params[k]}&`
    }
    return do_fetch_post(url, bodydata, jsdttyhdr)
}
, queryTransaction = async (txhash) => {
    let url = (await mnx_get_fullnode_url())+"/query/transaction?unit=mei&body=true&&hash=" + txhash
    return do_fetch_get(url)
}
, submitTransaction = async (txbody) => {
    return proxyFullnodeApiPost(
        "/submit/transaction", hexToBytes(txbody)
    )
}
// ---- SDK local transaction flow (replaces remote /create/transaction and /util/transaction/*) ----

, queryLatestHeight = async () => {
    let res = await do_fetch_get(await mnx_get_fullnode_url()+"/query/latest")
    return (res && res.height !== undefined) ? res.height : nil
}
, mnx_display_uint = (value, max) => {
    if((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))){ return null }
    let number = Number(value)
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null
}
, mnx_height_scope_facts = act => {
    if(!act || Number(act.kind) !== 1042){ return null }
    try {
        let fields = JSON_parse(act.json)
        let start = mnx_display_uint(fields.start, 1099511627775)
        let end = mnx_display_uint(fields.end, 1099511627775)
        return start == null || end == null ? null : { start, end }
    } catch(e){ return null }
}
, mnx_review_has_height_scope = actions => {
    for(let act of (actions || [])){
        if(mnx_height_scope_facts(act) || mnx_review_has_height_scope(act.children)){ return true }
    }
    return false
}
, mnx_height_clock_load = async (review, selectedChain) => {
    if(!mnx_review_has_height_scope(review.actions)){ return null }
    let controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
    let result = { available: false }
    try {
        let chain = selectedChain || await stoReadCurrentChain()
        let chainId = mnx_display_uint(chain.id, 4294967295)
        // Time estimates belong to the selected chain, not a global RPC override.
        let rpc = String(chain.rpc || '').replace(/\/+$/, '')
        if(chainId == null || !/^https?:\/\//.test(rpc)){ throw new Error('Selected chain RPC is unavailable') }
        result.chain_id = chainId
        result.rpc = rpc
        let get = async path => {
            let response = await fetch(rpc + path, { method: 'GET', cache: 'no-store', signal: controller.signal })
            if(!response.ok){ throw new Error('RPC HTTP ' + response.status) }
            let data = await response.json()
            if(!data || data.err || data.error || (data.ret != null && Number(data.ret) !== 0)){ throw new Error('RPC query failed') }
            return data
        }
        let status = null
        try { status = await get('/status') } catch(e) { if(controller.signal.aborted){ throw e } }
        let reportedId = status && mnx_display_uint(status.chain_id, 4294967295)
        if(status && status.chain_id != null && reportedId !== chainId){ throw new Error('RPC chain ID does not match the selected chain') }
        let interval = status && mnx_display_uint(status.block_target_seconds, Number.MAX_SAFE_INTEGER)
        if(status && status.block_target_seconds != null && !(interval > 0)){ throw new Error('RPC target block interval is invalid') }
        let intervalSource = 'rpc'
        if(!(interval > 0)){
            if(chainId !== 0){ throw new Error('RPC does not report the target block interval') }
            interval = 300
            intervalSource = 'mainnet-protocol'
        }
        let latest = await get('/query/latest')
        let height = mnx_display_uint(latest.height, 1099511627775)
        if(height == null){ throw new Error('Latest block height is invalid') }
        let block = await get(height === 0 ? '/query/block/intro?hash=0' : '/query/block/intro?height=' + height)
        let timestamp = mnx_display_uint(block.timestamp, 1099511627775)
        if(mnx_display_uint(block.height, 1099511627775) !== height || !(timestamp > 0)){ throw new Error('Latest block timestamp is invalid or mismatched') }
        return { ...result, available: true, height, timestamp, block_target_seconds: interval, interval_source: intervalSource, chain_id_verified: reportedId === chainId }
    } catch(e) {
        result.reason = controller.signal.aborted ? 'RPC time query timed out' : String(e.message || e)
        return result
    } finally { clearTimeout(timer) }
}
, mnx_height_estimated_time = (height, clock) => {
    if(!clock || !clock.available){ return null }
    let seconds = clock.timestamp + (height - clock.height) * clock.block_target_seconds
    if(!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 8640000000000){ return null }
    return new Date(seconds * 1000).toISOString().replace(/:\d{2}\.\d{3}Z$/, ' UTC').replace('T', ' ')
}
, mnx_height_scope_html = (act, clock) => {
    let fields = mnx_height_scope_facts(act)
    if(!fields){ return null }
    let esc = mnx_esc_html
    let endpoint = height => {
        let time = mnx_height_estimated_time(height, clock)
        // No clock → no estimate: show the bare height instead of a "time
        // unavailable" note (the title basis only exists when there is one).
        if(!time){ return `${height}` }
        let basis = clock && clock.available
            ? `Linear estimate from chain ${clock.chain_id} block ${clock.height} at ${clock.timestamp}, target ${clock.block_target_seconds}s/block (${clock.interval_source}). ${clock.chain_id_verified ? 'Reported chain ID matches.' : 'RPC did not report its chain ID.'} Not a guaranteed arrival time or a historical timestamp.`
            : (clock && clock.reason) || 'Latest block time is unavailable'
        return `${height} <small class="height-time" title="${esc(basis)}">(est. ${esc(time)})</small>`
    }
    return `Height scope ${endpoint(fields.start)} to ${fields.end === 0 ? 'Unlimited' : endpoint(fields.end)}`
}
, mnx_chain_context = async () => {
    // Strict window: current_height from RPC; on failure return has_height=false (page degrades to report with a notice)
    let height = await queryLatestHeight()
    return { current_height: height || 0, expected_chain_id: mnx_chain_id, has_height: !!height }
}
, mnx_sdk_err_user = (msg) => {
    // SDK validator errors leak module jargon ('[norm] amount semantic zero is
    // not canonical') straight into request pages; map the known families to
    // user language, keep the raw text as a parenthetical for support.
    let m = String(msg || '')
    let known = [
        [/amount semantic zero is not canonical/i, 'This transaction carries a zero amount, or an amount written in a non-standard form, so it cannot be signed.'],
        [/height.*window|valid_height/i, 'This transaction is only valid within a block-height window that the current network does not satisfy, so it cannot be signed.'],
        [/chain.*allow|expected_chain/i, 'This transaction is not allowed on the currently selected network, so it cannot be signed.'],
    ]
    for (let i in known) { if (known[i][0].test(m)) return known[i][1] + ' (' + m + ')' }
    if (/^\s*\[[\w-]+\]/.test(m)) return 'This transaction failed local validation, so it cannot be signed. (' + m + ')'
    return m
}
, mnx_local_review = async (body, signer) => {
    // Prefer strict inspect (HeightScope/ChainAllow window). Height available and strict fails -> block signing explicitly;
    // height unavailable (offline / RPC down) -> degrade to inspect_report noting the window is unverified, handled by the confirm flow.
    let ctx = await mnx_chain_context()
    if(ctx.has_height){
        try {
            let review = await sdk_tx_inspect(body, signer, {
                current_height: ctx.current_height, expected_chain_id: ctx.expected_chain_id,
            })
            return { review }
        } catch(e) {
            return { err: mnx_sdk_err_user(mnx_err_message(e)) }
        }
    }
    try {
        let review = await sdk_tx_inspect_report(body, signer)
        review._strict_note = 'height unavailable'
        return { review }
    } catch(e) { return mnx_err(e) }
}
, stoCurAccLocalSignTx = async (body, signer, review, origin) => {
    // prepare_signature -> vault sign -> attach_signature (full approval chain, local)
    let privkey = await stoUnlockAccount()
    if(!privkey) { return {err:'Account unlocking failed'} }
    try {
        let req = await sdk_tx_prepare_signature(body, signer, { review, origin })
        let proof = mnx_signing_proof(req, privkey)
        let attach = await sdk_tx_attach_signature(body, proof, review, req)
        return { result: attach, request: req }
    } catch(e) { return mnx_err(e) }
}

// TransactionJson.actions[] (canonical json) -> ActionSpec[] (rebuild via tx.build, used by raisefee)
// ActionSpec.kind takes registry schema names (the SDK also accepts numeric kinds; names follow the selection registry —
// note 1025=message / 1026=blob / 1044=required_signers, not the VM syscalls tx_message etc.).
// Field types: SAT's satoshi is a JSON number; Asset serial/amount must stay decimal
// strings (never Number()) so Fold64 values above MAX_SAFE_INTEGER keep their precision.
// BytesW fields use the SDK JSON binary format: preserve/normalize their 0x or b64: prefix.
, mnx_binary_action_spec = value => {
    let s = value == null ? '' : String(value)
    return /^(?:0x|b64:)/i.test(s) ? s : '0x' + s
}
, mnx_txjson_to_spec = (txjson) => {
    let num = (v, dft) => {
        let n = Number(v)
        return isFinite(n) ? n : (dft || 0)
    }
    // Wire-format kind -> registry schema name
    , kindname = {
        1: 'transfer_hac_to', 13: 'transfer_hac_from', 14: 'transfer_hac_from_to',
        10: 'transfer_sat_to', 11: 'transfer_sat_from', 12: 'transfer_sat_from_to',
        5: 'transfer_hacd_single_to', 6: 'transfer_hacd_from_to', 7: 'transfer_hacd_to', 8: 'transfer_hacd_from',
        17: 'transfer_asset_to', 18: 'transfer_asset_from', 19: 'transfer_asset_from_to',
        32: 'hacd_insc_push', 33: 'hacd_insc_clean', 34: 'hacd_insc_edit', 35: 'hacd_insc_move', 36: 'hacd_insc_drop',
        44: 'contract_main_call',
        1025: 'message', 1026: 'blob',
        1041: 'chain_allow', 1042: 'height_scope', 1044: 'required_signers',
    }
    let out = []
    for(let i in (txjson.actions || [])){
        let a = txjson.actions[i]
        let j
        try { j = JSON_parse(a.json) } catch(e) { throw new Error('action json invalid at index '+a.index) }
        let kd = parseInt(a.kind, 10) // tx.decode returns kind as a string; convert to number for branching
        let sp = nil
        if(kd == 1){ // HAC to
            sp = { kind: kindname[kd], to: j.to, hacash: (j.hacash==null?'0':j.hacash)+'' }
        }else if(kd == 13){ // HAC from
            sp = { kind: kindname[kd], from: j.from, hacash: (j.hacash==null?'0':j.hacash)+'' }
        }else if(kd == 14){ // HAC fromto
            sp = { kind: kindname[kd], from: j.from, to: j.to, hacash: (j.hacash==null?'0':j.hacash)+'' }
        }else if(kd == 10 || kd == 11 || kd == 12){ // SAT
            sp = { kind: kindname[kd], satoshi: num(j.satoshi) }
            if(kd==10){ sp.to = j.to }else if(kd==12){ sp.from = j.from, sp.to = j.to }else{ sp.from = j.from }
        }else if(kd == 5){ // HACD single
            sp = { kind: kindname[kd], diamond: (j.diamond+'').trim(), to: j.to }
        }else if(kd == 6 || kd == 7 || kd == 8){ // HACD from_to / to / from
            let names = mnx_split_diamond_names(j.diamond).concat(mnx_split_diamond_names(j.diamonds))
            // kind 6=DiaFromToTrs 7=DiaToTrs 8=DiaFromTrs (rebuild keeps the wire format)
            sp = { kind: kindname[kd], diamonds: names }
            if(kd==6){ sp.from = j.from, sp.to = j.to }else if(kd==7){ sp.to = j.to }else{ sp.from = j.from }
        }else if(kd == 17 || kd == 18 || kd == 19){ // Asset (serial/amount stay decimal strings)
            let ast = j.asset || {}
            sp = {
                kind: kindname[kd],
                asset: { serial: mnx_u64_string(ast.serial), amount: mnx_u64_string(ast.amount) },
            }
            if(kd==17){ sp.to = j.to }else if(kd==19){ sp.from = j.from, sp.to = j.to }else{ sp.from = j.from }
        }else if(kd == 1041){ // chain_allow (0x0411)
            sp = { kind: kindname[kd], chains: j.chains }
        }else if(kd == 1042){ // height_scope (0x0412)
            sp = { kind: kindname[kd], start: j.start, end: j.end }
        }else if(kd == 1044){ // required_signers (0x0414)
            sp = { kind: kindname[kd], signers: j.signers }
        }else if(kd == 1025){ // message (tx_message)
            sp = { kind: kindname[kd], data: mnx_binary_action_spec(j.data) }
        }else if(kd == 1026){ // blob (tx_blob)
            sp = { kind: kindname[kd], data: mnx_binary_action_spec(j.data) }
        }else if(kd == 32){ // hacd_insc_push
            sp = {
                kind: kindname[kd],
                diamonds: mnx_split_diamond_names(j.diamonds),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
                engraved_type: j.engraved_type == null ? 0 : j.engraved_type,
                engraved_content: mnx_binary_action_spec(j.engraved_content),
            }
        }else if(kd == 33){ // hacd_insc_clean
            sp = {
                kind: kindname[kd],
                diamonds: mnx_split_diamond_names(j.diamonds),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
            }
        }else if(kd == 34){ // hacd_insc_edit
            sp = {
                kind: kindname[kd],
                diamond: j.diamond+'',
                index: num(j.index),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
                engraved_type: j.engraved_type == null ? 0 : j.engraved_type,
                engraved_content: mnx_binary_action_spec(j.engraved_content),
            }
        }else if(kd == 35){ // hacd_insc_move
            sp = {
                kind: kindname[kd],
                from_diamond: j.from_diamond+'',
                to_diamond: j.to_diamond+'',
                index: num(j.index),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
            }
        }else if(kd == 36){ // hacd_insc_drop
            sp = {
                kind: kindname[kd],
                diamond: j.diamond+'',
                index: num(j.index),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
            }
        }else if(kd == 44){ // contract_main_call: rebuild marks + codeconf + codes field by field (bridge deposit / contract call)
            // Fixed3 and BytesW fields both use prefixed hex in the SDK JSON format.
            sp = {
                kind: kindname[kd],
                marks: '0x' + (j.marks==null?'000000':String(j.marks)).replace(/^0x/i,''),
                codeconf: num(j.codeconf),
                codes: mnx_binary_action_spec(j.codes),
            }
        }else{
            // 1043 = balance_floor (rebuild needs extended fields like assets, not supported yet), contract deploy/update, P2SH, AST/TEX, etc.
            throw new Error(`Cannot rebuild the raise-fee request in wallet: the transaction contains ${a.name||('kind '+kd)} (kind ${kd}). Please ask the originator to re-initiate.`)
        }
        out.push(sp)
    }
    return out
}

// Open the read-only All Actions review page: body+review passed via
// chrome.storage.session (key = review_binding), no re-fetching/modifying the
// tx. Shared by the signtx/transfer request pages (their openactv methods).
// mnx_open_actionview lives in each page's bundled login.js; chrome_storage_session
// in html.js — both resolve at call time (see file header).
, mnx_open_actionview_for = async (body, txres, displayContext) => {
    let nonce = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2)
    let key = 'actv_' + nonce
    await chrome_storage_session.set({ [key]: {
        body: body,
        // Drop Vue proxies so arrays (actions / signers) survive session storage
        review: JSON.parse(JSON.stringify(mnx_sdk_review_clean(txres))),
        msgparse: (mnx_msglayout_state && mnx_msglayout_state.extra) || null,
        display: {
            height_clock: JSON.parse(JSON.stringify(displayContext && displayContext.height_clock || null)),
            sourcemaps: (mnx_msglayout_state && mnx_msglayout_state.sourcemaps) || [],
            legacy_sourcemap: (mnx_msglayout_state && mnx_msglayout_state.extra && mnx_msglayout_state.extra.sourcemap) || null,
            address_table: txres.address_table || [],
        },
    } })
    mnx_open_actionview(key)
}

// ContractDeploy address = version byte + RIPEMD160(SHA3-256(main raw bytes || nonce BE)).
// Keep this as a display-only wallet fact; the SDK action JSON remains the exact wire fields.
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
, mnx_asset_registration_facts = act => {
    if(!act || Number(act.kind) !== 16){ return null }
    try {
        let data = JSON_parse(act.json), meta = data && data.metadata
        if(!meta){ return null }
        let decode = value => {
            if(typeof value !== 'string' || !/^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(value)){ return null }
            let decoded = mnx_hex_to_utf8(value)
            return decoded && !/[\u0000-\u001f\u007f]/.test(decoded) ? decoded : null
        }
        return {
            serial: mnx_display_uint(meta.serial, Number.MAX_SAFE_INTEGER),
            ticket: decode(meta.ticket),
            name: decode(meta.name),
            issuer: typeof meta.issuer === 'string' ? meta.issuer : null,
        }
    } catch(e){ return null }
}
, mnx_contract_deployment_facts = (act, main) => {
    if(!act || Number(act.kind) !== 40){ return null }
    try {
        let fields = JSON_parse(act.json)
        let nonce = mnx_display_uint(fields.nonce, 4294967295)
        let address = nonce == null ? null : mnx_contract_deploy_address(main, nonce)
        return { nonce, address }
    } catch(e){ return null }
}

// DApp callback compatibility layer: restore the fields promised by sdk.md
// (transfer: ret/success/txbody/txhash/txhashfee/txfee/description;
//  signtx: sign_hash/hash/hash_with_fee/body/fee/address/need_sign_address/description/ret)
// async: Asset amounts in the description need on-chain metadata for their decimals,
// so callers must await.
, mnx_dapp_result = async (review, sigp, request, signer) => {
    await mnx_asset_meta_ensure((review && review.asset_serials) || [])
    let nsa = {}
    for(let i in (review.required_signers || [])){
        let s = review.required_signers[i]
        nsa[s] = (sigp.missing_signers||[]).indexOf(s) >= 0
    }
    let desc = parseTxDesc(review).map(s => s.replace(/<[^>]*>/g, ''))
    return {
        ret: 0,
        success: true,
        body: sigp.body,
        txbody: sigp.body,
        sign_hash: request.digest,
        hash: request.digest,
        hash_with_fee: review.hash_with_fee,
        txhash: review.tx_hash,
        txhashfee: review.hash_with_fee,
        txfee: review.fee,
        fee: mnx_fin_to_decimal(review.fee),
        address: signer,
        need_sign_address: nsa,
        description: desc,
        complete: sigp.complete,
        missing_signers: sigp.missing_signers,
        submit: sigp.submit || false,
    }
}

// VM code print for maincall (and other act.code payloads). Offline, display-only
// — never part of review_binding. Bytecode -> Form 2 assembly; ir_node -> FitSH,
// falling back to Form 2 ircode assembly when FitSH cannot reconstruct.
, mnx_act_codes_hex = function(act) {
    try {
        let j = JSON_parse(act.json)
        return ((j.codes == null ? '' : j.codes)+'').replace(/^0x/i, '')
    } catch(e) { return '' }
}
, mnx_act_marks_hex = function(act) {
    try {
        let j = JSON_parse(act.json)
        return (j.marks == null ? '000000' : String(j.marks)).replace(/^0x/i, '')
    } catch(e) { return '' }
}
, mnx_act_code_type = function(act) {
    if(act && act.code && act.code.code_type != null){
        return Number(act.code.code_type)
    }
    try {
        let j = JSON_parse(act.json)
        if(j.codeconf != null){ return Number(j.codeconf) & 3 }
    } catch(e) {}
    return 0
}
, mnx_is_maincall_action = function(act) {
    return !!(act && (act.kind == 44 || act.name === 'contract_main_call'))
}
, mnx_review_maincalls = function(actions) {
    let out = []
    let walk = (list) => {
        for(let i = 0; i < (list || []).length; i++){
            let act = list[i]
            if(!act){ continue }
            if(mnx_is_maincall_action(act)){ out.push(act) }
            if(act.children){ walk(Array.isArray(act.children) ? act.children : Object.values(act.children)) }
        }
    }
    walk(actions)
    return out
}
, mnx_review_sourcemap_bind = function(actions, entries, legacy) {
    let mains = mnx_review_maincalls(actions)
    let known = {}
    for(let i = 0; i < mains.length; i++){ known[mains[i].path] = mains[i] }
    let grouped = {}, diagnostics = {}
    if(legacy != null){ diagnostics['*'] = 'Single sourcemap is unsupported; use sourcemaps with absolute action_path values.' }
    for(let i = 0; i < (entries || []).length; i++){
        let entry = entries[i] || {}, path = entry.action_path
        if(typeof path !== 'string' || !/^(0|[1-9][0-9]*)(\/(0|[1-9][0-9]*))*$/.test(path)){
            diagnostics['*'] = 'A sourcemap has a non-canonical action_path and was ignored.'
            continue
        }
        if(!known[path]){ diagnostics['*'] = `Unknown sourcemap action_path ${path}; entry ignored.`; continue }
        ;(grouped[path] || (grouped[path] = [])).push(entry)
    }
    let byPath = {}
    for(let path in grouped){
        if(grouped[path].length > 1){ diagnostics[path] = 'Conflicting sourcemaps for this action_path were all ignored.' }
        else if(grouped[path][0].sourcemap && typeof grouped[path][0].sourcemap === 'object'){
            byPath[path] = grouped[path][0].sourcemap
        }else{ diagnostics[path] = 'Malformed sourcemap was ignored.' }
    }
    return { mains, byPath, diagnostics }
}
, mnx_vm_decompile = async function(act, mode, sourcemap, isCurrent) {
    let codes = mnx_act_codes_hex(act)
    if(!codes){ return { err: 'no codes in action json' } }
    let ctype = mnx_act_code_type(act)
    // Sign page: named decompilation first — the SDK applies dApp sourcemap
    // names only after signature validation (validated identifiers, lib alias
    // names with addresses dropped), maximizing readability. Falls back to the
    // constrained review text. Detail/actionview pages: review text only, so
    // the numeric truth (real selectors, ext(index), literals) stays visible
    // there and the two views can be compared for audit.
    let fmts = ctype == 1 ? (mode === 'sign' ? ['fitsh', 'fitsh_review', 'assembly'] : ['fitsh_review', 'assembly']) : ['assembly']
    let last = 'decompile failed'
    for(let i = 0; i < fmts.length; i++){
        let fmt = fmts[i]
        try {
            // The map rides every text attempt: named mode uses it for names,
            // review mode for the validated labels line.
            let sm = sourcemap
            let res = await sdk_vm_code(codes, ctype, fmt, sm, 8000, 0)
            let first = res, text = res.text || '', offset = res.next_offset
            if(res.truncated && offset == null){ return { err: 'vm.code page omitted next_offset' } }
            while(res.truncated && offset != null && Number(offset) > Number(res.offset) && Number(offset) < 512 * 1024){
                if(isCurrent && !isCurrent()){ return { err: 'review superseded' } }
                await new Promise(resolve => setTimeout(resolve, 0))
                let previousOffset = Number(offset)
                res = await sdk_vm_code(codes, ctype, fmt, sm, 8000, previousOffset)
                if(!res.text || res.next_offset != null && Number(res.next_offset) <= previousOffset){
                    return { err: 'invalid or non-advancing vm.code page' }
                }
                text += res.text || ''
                offset = res.next_offset
            }
            return {
                text,
                format: res.format || fmt,
                truncated: !!res.truncated && offset != null,
                lines: res.lines || 0,
                warnings: first.warnings || [],
                sourcemap_status: first.sourcemap_status || 'absent',
                sourcemap_labels: first.sourcemap_labels || [],
                address_table: [],
            }
        } catch(e) {
            last = mnx_err_message(e)
        }
    }
    return { err: last }
}
, mnx_vm_decompile_html = async function(act, mode, sourcemap, diagnostic, addressTable, isCurrent) {
    let r = await mnx_vm_decompile(act, mode, sourcemap, isCurrent)
    if(r.err){
        return `<pre class="codeprint err">decompile failed: ${mnx_esc_html(r.err)}</pre>`
    }
    let extra = r.truncated ? '\n…(additional output exceeds the local 512 KiB review limit)' : ''
    let cls = mode === 'sign' ? 'codeprint sign' : 'avpre avcode'
    // mnx_esc_html also escapes quotes; inside <pre> that renders identically
    let notes = r.warnings.filter(w => mode !== 'sign' || w !== 'dApp labels are annotations; numeric slots and selectors remain authoritative')
    let facts = (diagnostic ? `<div class="codehint">${mnx_esc_html(diagnostic)}</div>` : '')
        + (r.sourcemap_labels && r.sourcemap_labels.length ? `<div class="codehint">${mode === 'sign' ? 'dApp labels' : 'dApp source labels (function selectors are matched)'}: ${r.sourcemap_labels.map(mnx_esc_html).join(' · ')}</div>` : '')
        + (notes.length ? `<div class="codehint">${notes.map(mnx_esc_html).join('<br>')}</div>` : '')
    if(mode !== 'sign' && addressTable && addressTable.length){ facts += `<div class="codehint">Address table: ${addressTable.map((a,i)=>`${i}: ${mnx_esc_html(a)}`).join(' · ')}</div>` }
    // Sign mode: open by default — the labels line is the only place a maincall's
    // dApp-provided names appear, and a collapsed <details> hides it from innerText
    // and from users who won't know to click. Content stays annotation-only (the
    // code above keeps real selectors/slots).
    if(mode === 'sign' && facts){ facts = `<details class="code-notes" open><summary>${diagnostic || notes.length ? 'Code notes' : 'Source labels'}</summary>${facts}</details>` }
    let code = `<pre class="${cls}">${mnx_esc_html(r.text)}${extra}</pre>`
    if(r.text.length > 8000){ code = `<details class="codefull"><summary>Full decompilation (${r.text.length} characters)</summary>${code}</details>` }
    return facts + code
}
, mnx_txdesc_attach_code = async function(review, txdesc, isCurrent, onProgress) {
    if(!review || !review.actions || !txdesc){ return txdesc }
    let binding = mnx_review_sourcemap_bind(review.actions, mnx_msglayout_state.sourcemaps, mnx_msglayout_state.extra && mnx_msglayout_state.extra.sourcemap)
    let pending = {}
    for(let i = 0; i < binding.mains.length; i++){
        let path = binding.mains[i].path, idx = Number(String(path).split('/')[0])
        if(txdesc[idx] != null){
            pending[path] = `<div class="codehint" data-code-path="${mnx_esc_html(path)}">Code review · action_path ${mnx_esc_html(path)} · pending</div>`
            txdesc[idx] += pending[path]
        }
    }
    for(let i = 0; i < binding.mains.length; i++){
        if(isCurrent && !isCurrent()){ return txdesc }
        await new Promise(resolve => setTimeout(resolve, 0))
        let act = binding.mains[i]
        let html = await mnx_vm_decompile_html(act, 'sign', binding.byPath[act.path], binding.diagnostics[act.path] || binding.diagnostics['*'], review.address_table, isCurrent)
        if(isCurrent && !isCurrent()){ return txdesc }
        let idx = Number(String(act.path).split('/')[0])
        if(txdesc[idx] != null){ txdesc[idx] = txdesc[idx].replace(pending[act.path], `<div data-code-path="${mnx_esc_html(act.path)}">${html}</div>`) }
        if(onProgress){ onProgress(act.path, i + 1, binding.mains.length) }
    }
    return txdesc
}

, parseTxDesc = (review, displayContext) => {
    // SDK descriptions are authoritative; the wallet only formats structured transfer facts
    // whose units need local chain metadata (Asset decimals).
    if(!review || !review.actions){ return [] }
    let esc = mnx_esc_html
    let txdesc = []
    let parse = (i, text) => {
        // Unit separated from the amount by a space ("100 HAC", not "100HAC").
        let li = (text||'').replace(/(-?\d+:\d+)\s*HAC\b/g, (_, amount) => mnx_fin_to_decimal(amount) + ' HAC')
            .replace(/(-?\d+(?:\.\d+)?)\s*HAC\b/g, '<b class="amt">$1</b> HAC')
            .replace(/\b([a-km-zA-HJ-NP-Z1-9]{28,34})\b/g, (_, address) => {
                let display = address === review.main ? address.slice(0, 7) + '...' : address
                return `<a class="addr" href="${explorer_url}/address/${address}" target="_blank" rel="noopener noreferrer" title="${address}">${display}</a>`
            })
        return `<span>${i+1}</span> ${li}`
    }
    let tables = (mnx_msglayout_state && mnx_msglayout_state.tables) || mnx_msglayout_normalize(null)
    let bind = mnx_msglayout_bind(review.actions, tables)
    if(mnx_msglayout_state){
        mnx_msglayout_state.display_err = (bind.errors || []).join(' ')
    }
    for(let i in review.actions){
        let act = review.actions[i]
        let ai = parseInt(i, 10)
        let line
        if(act.transfer && act.transfer.payload && act.transfer.payload.type === 'asset'){
            let p = act.transfer.payload
            // Asset atoms need chain metadata for decimals; endpoints and serial still come from SDK facts.
            let amt = mnx_asset_amount_text(p.atoms, p.serial)
            let desc = `Transfer <b class="amt${amt.known ? '' : ' asset-unit-unknown'}">${esc(amt.text)}</b>`
            if(amt.unit){ desc += ` ${esc(amt.unit)}` }
            desc += ` (Asset #${esc(p.serial)})`
            if(!amt.known){ desc += ` <strong class="asset-unit-warning" role="note">Decimals unknown: raw atoms, not token units</strong>` }
            if(act.transfer.from){ desc += ` from ${esc(act.transfer.from)}` }
            if(act.transfer.to){ desc += ` to ${esc(act.transfer.to)}` }
            line = parse(ai, desc)
        }else if(Number(act.kind) === 16){
            let facts = mnx_asset_registration_facts(act)
            if(facts && facts.serial != null && facts.ticket && facts.name && facts.issuer){
                line = parse(ai, `Register asset #${facts.serial} · ${esc(facts.ticket)} · ${esc(facts.name)} · issuer ${esc(facts.issuer)}`)
            }else{
                line = parse(ai, esc(act.description || act.name || `Action kind ${act.kind}`))
            }
        }else if(Number(act.kind) === 40){
            let facts = mnx_contract_deployment_facts(act, review.main)
            let desc = esc(act.description || act.name || `Action kind ${act.kind}`)
            if(facts && facts.address){ desc += ` · deployed address ${esc(facts.address)}` }
            line = parse(ai, desc)
        }else if(mnx_height_scope_facts(act)){
            line = parse(ai, mnx_height_scope_html(act, displayContext && displayContext.height_clock))
        }else if(mnx_is_tx_message_action(act)){
            line = parse(ai, `Message · ${esc(act.description || mnx_msg_bytes_text(act))}`)
        }else if(mnx_is_maincall_action(act)){
            line = parse(ai, esc(act.description || act.name || `Action kind ${act.kind}`))
        }else{
            line = parse(ai, esc(act.description || act.name || `Action kind ${act.kind}`))
        }
        if(mnx_is_tx_message_action(act)){
            // Keep the inline message layout compact in the narrow signing window.
            line += mnx_msglayout_block_html(act, bind.byArrayIndex[ai], 'inline')
        }
        let nestedScopes = list => {
            for(let child of (list || [])){
                let scope = mnx_height_scope_html(child, displayContext && displayContext.height_clock)
                if(scope){ line += `<div class="height-scope-note">[${esc(child.path)}] ${scope}</div>` }
                nestedScopes(child.children)
            }
        }
        nestedScopes(act.children)
        txdesc.push(line)
    }
    return txdesc
}


;
