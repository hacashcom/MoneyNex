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
, mnx_chain_context = async () => {
    // Strict window: current_height from RPC; on failure return has_height=false (page degrades to report with a notice)
    let height = await queryLatestHeight()
    return { current_height: height || 0, expected_chain_id: mnx_chain_id, has_height: !!height }
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
            return { err: 'Height/chain window check failed: '+mnx_err_message(e)+' (signing rejected)' }
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
// maincall's marks must carry the 0x prefix (codes/engraved_content must drop it).
, mnx_txjson_to_spec = (txjson) => {
    // Decoded diamonds come as a comma string (multi-name) or a single-name diamond field; normalize to array
    let dnames = (v) => {
        if(v == null){ return [] }
        let arr = typeof v === 'string' ? v.split(',') : v
        return arr.map(s=>(s+'').trim()).filter(s=>s.length>0)
    }
    , num = (v, dft) => {
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
            let names = dnames(j.diamond).concat(dnames(j.diamonds))
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
            sp = { kind: kindname[kd], data: (j.data||'').replace(/^0x/,'') }
        }else if(kd == 1026){ // blob (tx_blob)
            sp = { kind: kindname[kd], data: (j.data||'').replace(/^0x/,'') }
        }else if(kd == 32){ // hacd_insc_push
            sp = {
                kind: kindname[kd],
                diamonds: dnames(j.diamonds),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
                engraved_type: j.engraved_type == null ? 0 : j.engraved_type,
                engraved_content: (j.engraved_content||'').replace(/^0x/,''),
            }
        }else if(kd == 33){ // hacd_insc_clean
            sp = {
                kind: kindname[kd],
                diamonds: dnames(j.diamonds),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
            }
        }else if(kd == 34){ // hacd_insc_edit
            sp = {
                kind: kindname[kd],
                diamond: j.diamond+'',
                index: num(j.index),
                protocol_cost: (j.protocol_cost==null ? '0' : j.protocol_cost)+'',
                engraved_type: j.engraved_type == null ? 0 : j.engraved_type,
                engraved_content: (j.engraved_content||'').replace(/^0x/,''),
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
            // marks: SDK requires a 0x-prefixed hex string; codes: must drop the 0x
            sp = {
                kind: kindname[kd],
                marks: '0x' + (j.marks==null?'000000':String(j.marks)).replace(/^0x/,''),
                codeconf: num(j.codeconf),
                codes: (j.codes==null?'':String(j.codes)).replace(/^0x/,''),
            }
        }else{
            // 1043 = balance_floor (rebuild needs extended fields like assets, not supported yet), contract deploy/update, P2SH, AST/TEX, etc.
            throw new Error(`Cannot rebuild the raise-fee request in wallet: the transaction contains ${a.name||('kind '+kd)} (kind ${kd}). Please ask the originator to re-initiate.`)
        }
        out.push(sp)
    }
    return out
}

// DApp callback compatibility layer: restore the fields promised by sdk.md
// (transfer: ret/success/txbody/txhash/txhashfee/txfee/description;
//  signtx: sign_hash/hash/hash_with_fee/body/fee/address/need_sign_address/description/ret)
// async：description 里的 Asset 金额要先用链上 metadata 换算小数位，调用方需 await。
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
, mnx_esc_pre = function(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}
, mnx_vm_decompile = async function(act) {
    let codes = mnx_act_codes_hex(act)
    if(!codes){ return { err: 'no codes in action json' } }
    let ctype = mnx_act_code_type(act)
    let fmts = ctype == 1 ? ['fitsh', 'assembly'] : ['assembly']
    let last = 'decompile failed'
    for(let i = 0; i < fmts.length; i++){
        let fmt = fmts[i]
        try {
            let res = await sdk_vm_code(codes, ctype, fmt)
            return {
                text: res.text || '',
                format: res.format || fmt,
                truncated: !!res.truncated,
                lines: res.lines || 0,
            }
        } catch(e) {
            last = mnx_err_message(e)
        }
    }
    return { err: last }
}
, mnx_vm_decompile_html = async function(act, mode) {
    let r = await mnx_vm_decompile(act)
    if(r.err){
        return `<pre class="codeprint err">decompile failed: ${mnx_esc_html(r.err)}</pre>`
    }
    let extra = r.truncated ? '\n…(truncated)' : ''
    let cls = mode === 'sign' ? 'codeprint sign' : 'avpre avcode'
    return `<pre class="${cls}">${mnx_esc_pre(r.text)}${extra}</pre>`
}
, mnx_txdesc_attach_code = async function(review, txdesc) {
    if(!review || !review.actions || !txdesc){ return txdesc }
    for(let i = 0; i < review.actions.length; i++){
        let act = review.actions[i]
        if(!mnx_is_maincall_action(act)){ continue }
        let html = await mnx_vm_decompile_html(act, 'sign')
        let idx = i + 1
        if(txdesc[idx] != null){ txdesc[idx] += html }
    }
    return txdesc
}

, parseTxDesc = (review) => {
    // Local rendering: SDK Review.actions[] -> popup list (replaces the remote description text)
    // Note: action canonical json content (HACD names, engraved content, etc.) is attacker-controlled;
    // must esc() before inserting into v-html to prevent forged-UI injection in the signing review screen (CSP blocks scripts but not spoofing).
    if(!review || !review.actions){ return [] }
    let esc = mnx_esc_html
    let txdesc = []
    let parse = (i, text) => {
        let li = (text||'').replace(/(\s[0-9\.]+)HAC\s/g, ` <b class="amt">$1</b> HAC `)
            .replace(/([a-km-zA-HJ-NP-Z1-9]{28,34})/g, ` <a class="addr" href="${explorer_url}/address/$1" target="_blank" title="$1">$1</a> `)
        return `<span>${1+i}</span> ${li}`
    }
    // Decoded json diamonds may be a comma string or an array
    let dnames = (v) => {
        if(v == null){ return [] }
        let arr = typeof v === 'string' ? v.split(',') : v
        return arr.map(s=>(s+'').trim()).filter(s=>s.length>0)
    }
    // First line: fee / type / guard window / signing status (audit level no longer shown; full review lives in the All Actions page)
    let mainline = `${mnx_fin_to_decimal(review.fee)} HAC fee`
    if(review.tx_type){ mainline += ` · Type-${esc(review.tx_type)}` }
    if(review.valid_height_range){ mainline += ` · height ${esc(review.valid_height_range.start)}-${esc(review.valid_height_range.end)}` }
    if(review.chain_ids_allowed && review.chain_ids_allowed.length){ mainline += ` · chain ${esc(review.chain_ids_allowed.join(','))}` }
    if(review._strict_note){ mainline += ` · <span class="txhint" title="${esc(review._strict_note)}">height window unverified</span>` }
    txdesc.push(parse(0, mainline))
    let tables = (mnx_msglayout_state && mnx_msglayout_state.tables) || mnx_msglayout_normalize(null)
    let bind = mnx_msglayout_bind(review.actions, tables)
    if(mnx_msglayout_state){
        mnx_msglayout_state.display_err = (bind.errors || []).join(' ')
    }
    for(let i in review.actions){
        let act = review.actions[i]
        let ai = parseInt(i, 10)
        let li
        let line
        if(act.transfer){
            let p = act.transfer.payload
            if(p.type == 'hac'){ li = `Transfer <b class="amt">${mnx_fin_to_decimal(p.amount)}</b> HAC` }
            else if(p.type == 'satoshi'){ li = `Transfer <b class="amt">${esc(p.atoms)}</b> SAT` }
            else if(p.type == 'hacd'){
                // SDK audit.rs returns empty names for single-name / some wire formats; fall back to real names from the action canonical json
                let names = p.names || []
                if(!names.length){
                    try {
                        let j = JSON_parse(act.json)
                        names = dnames(j.diamond).concat(dnames(j.diamonds))
                    } catch(e){}
                }
                li = `Transfer ${names.length || p.count} HACD (${esc(names.join(','))})`
            }
            else if(p.type == 'asset'){
                // atoms 是原始最小单位（Fold64 字符串）；小数位来自链上 AssetSmelt，
                // 由 mnx_asset_meta_ensure(review.asset_serials) 预热后在此同步读取。
                let amt = mnx_asset_amount_text(p.atoms, p.serial)
                li = `Transfer Asset#${esc(p.serial)} <b class="amt">${esc(amt.text)}</b>`
                if(amt.unit){ li += ` ${esc(amt.unit)}` }
                if(!amt.known){ li += ` <span class="txhint">decimal unknown — raw atoms</span>` }
            }
            if(act.transfer.from){ li += ` from ${esc(act.transfer.from)}` }
            li += ` to ${esc(act.transfer.to)}`
            line = parse(ai+1, li)
        }else if(mnx_is_tx_message_action(act)){
            line = `<span>${ai+2}</span> Message · ${mnx_msg_bytes_text(act)}`
        }else if(act.kind == 1044 || act.name === 'req_sign_list'){
            // Federation multisig required addresses (humanized + full address list; skip parse()'s address regex to avoid double-wrapping)
            let signers = []
            try {
                let j = JSON_parse(act.json)
                let arr = j.signers || j.req_signers || []
                for(let si in arr){
                    let s = arr[si]
                    let one = typeof s === 'string' ? s : (s.addr || s.address || s.readable || '')
                    if(one){ signers.push(String(one)) }
                }
            } catch(e) {}
            let list = signers.map(s =>
                `<a class="addr" style="max-width:none" href="${explorer_url}/address/${encodeURIComponent(s)}" target="_blank" title="${mnx_esc_html(s)}">${mnx_esc_html(s)}</a>`
            ).join(', ')
            line = `<span>${ai+2}</span> Federation required signers (${signers.length || '?'} total, all must sign)${list ? ': ' + list : ''}`
        }else if(mnx_is_maincall_action(act)){
            // Sign page: title + decompiled code (attached async by mnx_txdesc_attach_code).
            // Full structured fields (marks / conf / hash / json) live on the Details page.
            li = 'Contract call (maincall)'
            if(act.code){
                li += ` · ${esc(act.code.code_type_name)}${act.code.codes_len != null ? ' ' + esc(act.code.codes_len) + 'B' : ''}`
            }
            line = `<span>${ai+2}</span> ${li}`
        }else{
            li = `${esc(act.name || ('kind '+act.kind))}`
            // Inscription actions: render a readable description from the canonical json
            if(act.name && act.name.indexOf('hacd_insc_') == 0){
                try {
                    let j = JSON_parse(act.json)
                    if(act.name == 'hacd_insc_push'){
                        li = `Inscript ${dnames(j.diamonds).length} HACD (${esc(dnames(j.diamonds).join(','))}) with "${esc(mnx_hex_to_utf8(j.engraved_content))}"`
                    }else if(act.name == 'hacd_insc_clean'){
                        li = `Clean inscript ${dnames(j.diamonds).length} HACD (${esc(dnames(j.diamonds).join(','))})`
                    }else if(act.name == 'hacd_insc_edit'){
                        li = `Edit inscription #${esc(j.index)} of HACD ${esc(j.diamond)} to "${esc(mnx_hex_to_utf8(j.engraved_content))}"`
                    }else if(act.name == 'hacd_insc_move'){
                        li = `Move inscription #${esc(j.index)} from HACD ${esc(j.from_diamond)} to HACD ${esc(j.to_diamond)}`
                    }else if(act.name == 'hacd_insc_drop'){
                        li = `Drop inscription #${esc(j.index)} of HACD ${esc(j.diamond)}`
                    }
                } catch(e){}
            }
            if(act.code){ li += ` · ${esc(act.code.code_type_name)} ${esc((act.code.codes_hash||'').substring(0, 10))}` }
            line = parse(ai+1, li)
        }
        if(mnx_is_tx_message_action(act)){
            // 签名页用 inline 布局：紧凑单行、字段全部左对齐（弹窗窄，不排表格列宽）
            line += mnx_msglayout_block_html(act, bind.byArrayIndex[ai], 'inline')
        }
        txdesc.push(line)
    }
    return txdesc
}


;
