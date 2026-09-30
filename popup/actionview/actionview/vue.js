
// Read-only "full action review" page: shows all SDK Review fields (no VM execution, no re-fetching/modifying the tx)
// Data passed from the signtx/transfer popup via chrome.storage.session (key = review_binding)

// 地址渲染：Hacash 可读地址给 explorer 链接，其它原样转义（全部经 mnx_esc_html）
function mnx_actv_addr_html(a) {
    let esc = mnx_esc_html
    let s = a == null ? '' : String(a)
    if(!s){ return '' }
    if(/^[a-km-zA-HJ-NP-Z1-9]{28,34}$/.test(s)){
        return `<a class="avaddr" href="${explorer_url}/address/${encodeURIComponent(s)}" target="_blank" title="${esc(s)}">${esc(s)}</a>`
    }
    return `<span class="avaddr">${esc(s)}</span>`
}

// 单个 action -> 卡片块（div）。depth 用 CSS 缩进，不再用 &nbsp; 拼版。
function mnx_actv_render_action(act, depth, prints, layoutCtx) {
    // Action json content (HACD names, engraved content, etc.) is attacker-controlled; must escape before embedding in HTML
    let esc = mnx_esc_html
    let out = []
    let cls = 'avact' + (depth > 0 ? ' avd' + Math.min(depth, 4) : '')
    let name = mnx_is_tx_message_action(act) ? 'Message' : (act.name || ('kind '+act.kind))
    let head = `<span class="avpath">[${esc(act.path)}]</span><b class="avname">${esc(name)}</b>`
    // 载荷字节数并入标题（虚线框内只留字段）
    if(mnx_is_tx_message_action(act)){ head += `<span class="avbytes">· ${mnx_msg_bytes_text(act)}</span>` }
    head += `<span class="avtag">${esc(act.scope)}</span>`
    if(act.auditability && act.auditability != 'full'){ head += `<span class="avtag warn">audit:${esc(act.auditability)}</span>` }
    // Payload carriers (tx_message / tx_blob) constrain nothing — the payload itself is shown
    // verbatim below — so a guard finding on them is not a defect of the operation being signed.
    // Show the blob fact instead of `invalid`; every finding still appears as a `note` row below,
    // and the review-level `protocol_valid` stays visible in the meta block.
    if(act.blob){ head += `<span class="avtag">payload</span>` }
    else if(!act.protocol_valid){ head += `<span class="avtag err">invalid</span>` }
    out.push(`<div class="${cls}"><div class="avhd">${head}</div>`)

    if(act.transfer){
        let p = act.transfer.payload
        let amt = ''
        if(p.type == 'hac'){ amt = `<b class="amt">${esc(mnx_fin_to_decimal(p.amount))}</b> HAC` }
        else if(p.type == 'satoshi'){ amt = `<b class="amt">${esc(p.atoms)}</b> SAT` }
        else if(p.type == 'hacd'){
            let names = p.names || []
            if(!names.length){
                try {
                    let j = JSON_parse(act.json)
                    let dn = (v) => {
                        if(v == null){ return [] }
                        let arr = typeof v === 'string' ? v.split(',') : v
                        return arr.map(s=>(s+'').trim()).filter(s=>s.length>0)
                    }
                    names = dn(j.diamond).concat(dn(j.diamonds))
                } catch(e){}
            }
            amt = `<b class="amt">${esc(names.length || p.count)}</b> HACD <span class="avsub">(${esc(names.join(', '))})</span>`
        }
        else if(p.type == 'asset'){
            // 与签名页同一口径：小数位来自链上 AssetSmelt（本页 load() 已预热缓存）
            let a = mnx_asset_amount_text(p.atoms, p.serial)
            amt = `<b class="amt">${esc(a.text)}</b>${a.unit ? ' ' + esc(a.unit) : ''}`
            amt += `<span class="avtag">Asset #${esc(p.serial)}</span>`
            if(!a.known){ amt += `<span class="avtag err">decimal unknown — raw atoms</span>` }
        }
        let path = ''
        if(act.transfer.from){ path += `${mnx_actv_addr_html(act.transfer.from)}<span class="avarrow">→</span>` }
        path += mnx_actv_addr_html(act.transfer.to)
        out.push(`<div class="avrow"><span class="avk">transfer</span><span class="avv">${amt}<span class="avarrow">→</span>${path}</span></div>`)
    }

    if(mnx_is_tx_message_action(act)){
        let layout = null
        if(depth === 0 && layoutCtx && layoutCtx.byArrayIndex){
            layout = layoutCtx.byArrayIndex[layoutCtx.arrayIndex]
        }
        // 不套 avrow/avk：左边不再留 'message' 标签，虚线框与卡片左边对齐；
        // table 布局让 label/值 两列在各字段间对齐
        out.push(`<div class="avmsg">${mnx_msglayout_block_html(act, layout, 'table')}</div>`)
    }

    if(act.code){
        let marks = mnx_act_marks_hex(act)
        let marks_ok = !marks || /^0+$/.test(marks)
        out.push(`<div class="avrow"><span class="avk">marks</span><span class="avv"><code class="avmono">${esc(marks || '000000')}</code>${marks_ok ? '' : ' <span class="avtag err">nonzero</span>'}</span></div>`)
        out.push(`<div class="avrow"><span class="avk">code</span><span class="avv">${esc(act.code.code_type_name)}${act.code.codes_len != null ? ' ' + esc(act.code.codes_len) + 'B' : ''} <span class="avsub">conf ${esc(act.code.codeconf)} · hash</span> <code class="avmono">${esc(act.code.codes_hash)}</code></span></div>`)
        let printed = prints && prints[act.path]
        if(printed){ out.push(`<div class="avcode">${printed}</div>`) }
    }

    for(let i in (act.audit_notes||[])){
        out.push(`<div class="avrow"><span class="avk">note</span><span class="avv">${esc(act.audit_notes[i])}</span></div>`)
    }

    // canonical json / raw bytes 默认折叠：审核页要保真但不必一屏全是字节流
    let pretty = ''
    try { pretty = JSON.stringify(JSON_parse(act.json), null, 2) } catch(e){ pretty = act.json }
    out.push(`<details class="avdet"><summary>canonical json</summary><pre class="avpre">${esc(pretty)}</pre></details>`)
    out.push(`<details class="avdet"><summary>raw bytes</summary><pre class="avpre">${esc(act.raw)}</pre></details>`)
    out.push('</div>')

    for(let i in (act.children||[])){
        out = out.concat(mnx_actv_render_action(act.children[i], depth + 1, prints, layoutCtx))
    }
    return out
}

var routePageActionView = (adr, clbk) => {

    let {app} = VueCreateApp('actv', vue_tpl_actionview, {
        icfp: icfpath,
        adr: adr,
        sadr: addrOmitted(adr),
        end: no,
        err: nil,
        txs: nil,   // review
        meta: '',   // 顶部交易摘要（key/value 网格）
        lines: [],
        bind: '',
        signers: {},
        layouterr: '',
    },{
        nop() {
            window.close()
        }
        , async load() {
            let t = this
            let key = urlquery.key || ''
            if(!key){
                t.err = 'no review key given'
                return
            }
            let obj = await chrome_storage_session.get(key)
            let data = obj[key]
            if(!data || !data.review){
                t.err = 'review not found in session storage'
                return
            }
            let review = data.review
            // Cleanup after use: remove session data on page hide (multiple opens allowed before unload)
            try{
                window.addEventListener('pagehide', ()=>{ chrome_storage_session.remove(key) })
            }catch(e){}
            t.txs = review
            t.bind = review.review_binding || ''
            // Asset 金额显示需要链上小数位：先按 review.asset_serials 补齐元数据（失败也不阻断查看）
            await mnx_asset_meta_ensure(review.asset_serials || [])
            // 顶部摘要：key/value 网格（长 hash 用等宽字体换行，不再挤成一行）
            let esc = mnx_esc_html
            let mrow = (k, v, mono) => `<div class="avmrow"><span class="avk">${esc(k)}</span><span class="avv${mono ? ' avmono' : ''}">${v}</span></div>`
            let meta = []
            meta.push(mrow('Main', `<span class="avmono">${esc(review.main)}</span>`))
            meta.push(mrow('Type', `Type-${esc(review.tx_type)} <span class="avsub">· fee</span> <b class="amt">${esc(mnx_fin_to_decimal(review.fee))}</b> HAC <span class="avsub">· timestamp</span> ${esc(review.timestamp)}`))
            if(review.valid_height_range){
                meta.push(mrow('Height window', `<b>${esc(review.valid_height_range.start)} - ${esc(review.valid_height_range.end)}</b>${review._strict_note ? ` <span class="avtag err">not verified (${esc(review._strict_note)})</span>` : ''}`))
            }
            if(review.chain_ids_allowed && review.chain_ids_allowed.length){
                meta.push(mrow('Chain ids allowed', `<b>${esc(review.chain_ids_allowed.join(', '))}</b>`))
            }
            meta.push(mrow('auditability / signability', `${esc(review.auditability)} · ${esc(review.signability)} · protocol_valid ${esc(review.protocol_valid)} · requires_user_confirmation ${esc(review.requires_user_confirmation)}`))
            meta.push(mrow('tx_hash', esc(review.tx_hash), true))
            meta.push(mrow('hash_with_fee', esc(review.hash_with_fee), true))
            meta.push(mrow('unsigned_body_hash', esc(review.unsigned_body_hash), true))
            meta.push(mrow('review_binding', esc(review.review_binding), true))
            meta.push(mrow('codec_profile_hash', esc(review.codec_profile_hash), true))
            t.meta = meta.join('')
            let acts = Array.isArray(review.actions) ? review.actions : Object.values(review.actions || {})
            let present = Array.isArray(review.present_signers) ? review.present_signers : []
            // Decompile code-carrying actions first, then render into each card
            // (failures only affect display, never the signing decision).
            let prints = {}
            let collect = (list) => {
                for(let i = 0; i < (list || []).length; i++){
                    let act = list[i]
                    if(act && act.code){ prints[act.path] = act }
                    if(act && act.children){ collect(Array.isArray(act.children) ? act.children : Object.values(act.children || {})) }
                }
            }
            collect(acts)
            for(let p in prints){
                try {
                    prints[p] = await mnx_vm_decompile_html(prints[p], 'detail')
                } catch(e) {
                    prints[p] = `<pre class="codeprint err">decompile failed: ${mnx_esc_html(mnx_err_message(e))}</pre>`
                }
            }
            // 动作列表
            let lines = []
            let tables = mnx_msglayout_normalize(data.msgparse || data.msglayouts || null)
            let bind = mnx_msglayout_bind(acts, tables)
            t.layouterr = (bind.errors || []).join(' ')
            let layoutCtx = { byArrayIndex: bind.byArrayIndex, arrayIndex: 0 }
            for(let i = 0; i < acts.length; i++){
                layoutCtx.arrayIndex = i
                lines = lines.concat(mnx_actv_render_action(acts[i], 0, prints, layoutCtx))
            }
            t.lines = lines
            // Signers
            let sg = {}
            let required = Array.isArray(review.required_signers) ? review.required_signers : Object.values(review.required_signers || {})
            for(let i = 0; i < required.length; i++){
                let s = required[i]
                sg[s] = { address: s, complete: present.indexOf(s) >= 0 }
            }
            t.signers = sg
        }
    }, async(t)=>{
        clbk && clbk()
        await t.load()
    });

}

