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
// mnx_split_diamond_names moved to the fact layer (jslib/actionfacts.js).

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
// Height-scope facts moved to the fact layer (jslib/actionfacts.js); this
// alias keeps the historical name used by the height clock tests.
, mnx_height_scope_facts = act => mnx_act_height_scope(act)
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
// Height rendering (est. time titles) moved to the shared renderer
// (jslib/actionrender.js: mnx_height_scope_html / mnx_height_estimated_time).
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
// Field types: SAT and Asset u64 values stay decimal strings so a lossless
// canonical JSON integer is never rounded through JavaScript Number.
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
        try { j = mnx_json_parse_lossless(a.json) } catch(e) { throw new Error('action json invalid at index '+a.index) }
        let kd = parseInt(a.kind, 10) // tx.decode returns kind as a string; convert to number for branching
        let sp = nil
        if(kd == 1){ // HAC to
            sp = { kind: kindname[kd], to: j.to, hacash: (j.hacash==null?'0':j.hacash)+'' }
        }else if(kd == 13){ // HAC from
            sp = { kind: kindname[kd], from: j.from, hacash: (j.hacash==null?'0':j.hacash)+'' }
        }else if(kd == 14){ // HAC fromto
            sp = { kind: kindname[kd], from: j.from, to: j.to, hacash: (j.hacash==null?'0':j.hacash)+'' }
        }else if(kd == 10 || kd == 11 || kd == 12){ // SAT
            if(typeof j.satoshi === 'number' && !Number.isSafeInteger(j.satoshi)){
                throw new Error('Cannot safely rebuild the raise-fee request: SAT amount is not a safe integer.')
            }
            let satoshi = mnx_u64_string(j.satoshi)
            if(!satoshi){ throw new Error('Cannot safely rebuild the raise-fee request: SAT amount is invalid.') }
            sp = { kind: kindname[kd], satoshi }
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

// Registration/deployment facts and the contract-address derivation moved to
// the fact layer (jslib/actionfacts.js): mnx_asset_registration_facts,
// mnx_contract_deployment_facts, mnx_contract_deploy_address.

// DApp callback compatibility layer: restore the fields promised by sdk.md
// (transfer: ret/success/txbody/txhash/txhashfee/txfee/description;
//  signtx: sign_hash/hash/hash_with_fee/body/fee/address/need_sign_address/description/ret)
// async: Asset amounts in the description need on-chain metadata for their decimals,
// so callers must await. The description array comes from the shared display
// model's plainText serializer — full addresses, no HTML entities, no code
// panels, never HTML-stripped after the fact.
, mnx_dapp_result = async (review, sigp, request, signer) => {
    await mnx_asset_meta_ensure((review && review.asset_serials) || [])
    let nsa = {}
    for(let i in (review.required_signers || [])){
        let s = review.required_signers[i]
        nsa[s] = (sigp.missing_signers||[]).indexOf(s) >= 0
    }
    let desc = mnx_txdesc_plain(review)
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
        let j = typeof mnx_json_parse_lossless === 'function' ? mnx_json_parse_lossless(act.json) : JSON_parse(act.json)
        let codes = j.codes == null ? j.lockbox : j.codes
        return ((codes == null ? '' : codes)+'').replace(/^0x/i, '')
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
    // Keep supplementary code notes and source labels available without expanding
    // the signing review by default. The decompiled code remains visible below.
    if(mode === 'sign' && facts){ facts = `<details class="code-notes"><summary>${diagnostic || notes.length ? 'Code notes' : 'Source labels'}</summary>${facts}</details>` }
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

// Sign-page action lines: the shared display model (jslib/actiondisplay.js)
// builds an ActionPresentation tree per review; the shared renderer
// (jslib/actionrender.js) turns tokens into the one-line HTML the signtx
// template v-html's. Message layout blocks append as an independent inline
// section; code panels stay with mnx_txdesc_attach_code (enrichment, not a
// base mode).
, mnx_tx_display_ctx = (review, displayContext) => ({
    review,
    height_clock: displayContext && displayContext.height_clock || null,
    asset_text: (atoms, serial) => mnx_asset_amount_text(atoms, serial),
})
, parseTxDesc = (review, displayContext) => {
    if(!review || !review.actions){ return [] }
    let nodes = mnx_review_presentations(review, mnx_tx_display_ctx(review, displayContext))
    let tables = (mnx_msglayout_state && mnx_msglayout_state.tables) || mnx_msglayout_normalize(null)
    let bind = mnx_msglayout_bind(review.actions, tables)
    if(mnx_msglayout_state){
        mnx_msglayout_state.display_err = (bind.errors || []).join(' ')
    }
    let opts = { abbrev_main: true, main: review.main, height_clock: displayContext && displayContext.height_clock }
    let txdesc = []
    for(let i = 0; i < nodes.length; i++){
        let line = mnx_action_line_html(nodes[i], i, opts)
        let act = review.actions[i]
        if(mnx_is_tx_message_action(act)){
            // Keep the inline message layout compact in the narrow signing window.
            line += mnx_msglayout_block_html(act, bind.byArrayIndex[i], 'inline')
        }
        txdesc.push(line)
    }
    return txdesc
}

// Plain-text descriptions from the same model for DApp callbacks and the
// transaction log: one string per top-level action, full addresses, no HTML,
// no code panels. Callers warm the asset metadata cache first (mnx_dapp_result
// already awaits mnx_asset_meta_ensure before this runs).
, mnx_txdesc_plain = (review) => {
    if(!review || !review.actions){ return [] }
    let nodes = mnx_review_presentations(review, mnx_tx_display_ctx(review, null))
    return nodes.map(node => mnx_action_plain_text(node))
}

// A signature slot is complete only when the SDK has verified it. Presence is
// still useful forensic information, but never upgrades an invalid/unverified
// signature to "Signed" in either wallet review surface.
, mnx_tx_signer_status = function(review, address) {
    let has = key => Array.isArray(review && review[key]) && review[key].indexOf(address) >= 0
    if(has('valid_signers')){ return 'valid' }
    if(has('invalid_signers')){ return 'invalid' }
    if(has('present_signers')){ return 'unverified' }
    return 'missing'
}


;
