
// Read-only "full action review" page: shows all SDK Review fields (no VM execution, no re-fetching/modifying the tx)
// Data passed from the signtx/transfer popup via chrome.storage.session (key = review_binding)

// address rendering: readable Hacash addresses get an explorer link, anything else is escaped as-is (all through mnx_esc_html)
function mnx_actv_addr_html(a) {
    let esc = mnx_esc_html
    let s = a == null ? '' : String(a)
    if(!s){ return '' }
    if(/^[a-km-zA-HJ-NP-Z1-9]{28,34}$/.test(s)){
        let explorer = String(explorer_url || '')
        if(!/^https?:\/\//i.test(explorer)){ return `<span class="avaddr">${esc(s)}</span>` }
        return `<a class="avaddr" href="${esc(explorer)}/address/${encodeURIComponent(s)}" target="_blank" title="${esc(s)}">${esc(s)}</a>`
    }
    return `<span class="avaddr">${esc(s)}</span>`
}

// one action -> a card block (div). depth indents via CSS, no more &nbsp; padding.
function mnx_actv_render_action(act, depth, prints, layoutCtx, presentation) {
    // Action json content (HACD names, engraved content, etc.) is attacker-controlled; must escape before embedding in HTML
    let esc = mnx_esc_html
    let out = []
    let cls = 'avact' + (depth > 0 ? ' avd' + Math.min(depth, 4) : '')
    let name = mnx_is_tx_message_action(act) ? 'Message' : (act.name || ('kind '+act.kind))
    let head = `<span class="avpath">[${esc(act.path)}]</span><b class="avname">${esc(name)}</b>`
    if(presentation && presentation.branch){ head += `<span class="avtag">${esc(presentation.branch)}</span>` }
    // payload byte count folds into the title (the dashed box keeps fields only)
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
    if(presentation){
        out.push(`<div class="avrow"><span class="avk">Action</span><span class="avv">${mnx_action_line_html(presentation, null, { main: layoutCtx && layoutCtx.review && layoutCtx.review.main, height_clock: layoutCtx && layoutCtx.height_clock, include_children: false })}</span></div>`)
    }
    if(mnx_is_tx_message_action(act)){
        let layout = null
        if(depth === 0 && layoutCtx && layoutCtx.byArrayIndex){
            layout = layoutCtx.byArrayIndex[layoutCtx.arrayIndex]
        }
        // no avrow/avk wrapper: no 'message' label on the left, and the dashed box aligns with the card edge;
        // the table layout keeps the label/value columns aligned across fields
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

    let sdkDescription = presentation && presentation.sdkDescription != null
        ? presentation.sdkDescription : act.description
    if(sdkDescription != null && sdkDescription !== ''){
        out.push(`<details class="avdet"><summary>SDK description</summary><pre class="avpre">${esc(sdkDescription)}</pre></details>`)
    }
    // Canonical JSON / raw bytes are separate audit views, not inputs to the wallet summary.
    // Keep SDK canonical JSON as text so large bare integers remain exact.
    out.push(`<details class="avdet"><summary>canonical json</summary><pre class="avpre">${esc(act.json)}</pre></details>`)
    out.push(`<details class="avdet"><summary>raw bytes</summary><pre class="avpre">${esc(act.raw)}</pre></details>`)
    out.push('</div>')

    // Each v-html entry must be a complete element, not an open/close fragment.
    let lines = [out.join('')]
    for(let i in (act.children||[])){
        lines = lines.concat(mnx_actv_render_action(act.children[i], depth + 1, prints, layoutCtx, presentation && presentation.children && presentation.children[i]))
    }
    return lines
}

var routePageActionView = (adr, clbk) => {

    let {app} = VueCreateApp('actv', vue_tpl_actionview, {
        icfp: icfpath,
        adr: adr,
        sadr: addrOmitted(adr),
        end: no,
        err: nil,
        txs: nil,   // review
        meta: '',   // top transaction summary (key/value grid)
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
            // Keep this window's snapshot across reloads; closing the tab clears it.
            try {
                if(data){ sessionStorage.setItem(key, JSON.stringify(data)) }
                else { data = JSON.parse(sessionStorage.getItem(key) || 'null') }
            } catch(e) {}
            if(!data || !data.review){
                t.err = 'review not found in session storage'
                return
            }
            let review = data.review
            let cancelled = false
            // Cleanup after use: remove session data on page hide (multiple opens allowed before unload)
            try{
                window.addEventListener('pagehide', ()=>{ cancelled = true; chrome_storage_session.remove(key) })
            }catch(e){}
            // maximize the window when canonical json / raw expands (user directive 2026-10-06): at window-open
            // login.js already tried state:'maximized', but environments without a window manager (CI/sandbox)
            // ignore it — reassert when the wide JSON expands. toggle does not bubble, so a capturing listener
            // catches the <details class="avdet"> generated dynamically inside v-html. Fails silently — a pure
            // viewing enhancement that never affects any pass/fail outcome.
            try{
                document.addEventListener('toggle', (ev) => {
                    let el = ev.target
                    if(el && el.tagName === 'DETAILS' && el.open && el.classList.contains('avdet')){
                        try{
                            let upd = chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { state: 'maximized' })
                            if(upd && upd.catch){ upd.catch(()=>{}) }
                        }catch(e){}
                    }
                }, true)
            }catch(e){}
            t.txs = review
            t.bind = review.review_binding || ''
            // Asset amount display needs on-chain decimals: warm the metadata from review.asset_serials first (failure never blocks the review)
            await mnx_asset_meta_ensure(review.asset_serials || [])
            // top summary: key/value grid (long hashes wrap in monospace instead of squeezing onto one line)
            let esc = mnx_esc_html
            let mrow = (k, v, mono) => `<div class="avmrow"><span class="avk">${esc(k)}</span><span class="avv${mono ? ' avmono' : ''}">${v}</span></div>`
            let meta = []
            // Human-readable labels/timestamps (§7.4 finding): raw snake_case keys
            // and unix seconds read as debug output to users.
            let tsfmt = (ts) => {
                let n = Number(ts)
                if (!isFinite(n) || n <= 0) return esc(ts)
                if (n < 1e12) n *= 1000
                let d = new Date(n)
                return esc(d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC')
            }
            let yesno = (v) => (v === true || v === 'true') ? 'yes' : ((v === false || v === 'false') ? 'no' : esc(v))
            meta.push(mrow('Main account', `<span class="avmono">${esc(review.main)}</span>`))
            if(Array.isArray(review.address_table) && review.address_table.length){
                let rows = review.address_table.map((address, index) => `<li><span class="av-address-index">${index}:</span>${mnx_actv_addr_html(address)}${index === 0 ? ' <b>primary / fee payer</b>' : ''}</li>`).join('')
                meta.push(mrow('Address table', `<ol class="av-address-table">${rows}</ol>`))
            }
            meta.push(mrow('Transaction', `Type-${esc(review.tx_type)} <span class="avsub">· created</span> ${tsfmt(review.timestamp)}`))
            let feeRows = [
                `<div><dt>Transaction fee</dt><dd><b>${esc(mnx_fin_to_decimal(review.fee))} HAC</b></dd></div>`,
                `<div><dt>Maximum gas charge</dt><dd>${review.gas_max_charge == null ? 'Unavailable' : esc(mnx_fin_to_decimal(review.gas_max_charge)) + ' HAC'}</dd></div>`,
                `<div><dt>Gas max byte</dt><dd>${review.gas_max == null ? 'Not set' : esc(review.gas_max)}</dd></div>`,
                `<div><dt>Decoded gas budget</dt><dd>${review.gas_budget == null ? 'Not set' : esc(review.gas_budget)}</dd></div>`,
                `<div><dt>Fee purity</dt><dd>${review.fee_purity == null ? 'Unavailable' : esc(review.fee_purity) + ' u' + esc(review.fee_purity_unit) + ' / byte'}</dd></div>`,
                `<div><dt>Purity floor</dt><dd>${review.fee_purity_floor == null ? 'Unavailable' : esc(review.fee_purity_floor) + ' u' + esc(review.fee_purity_unit) + ' / byte'}</dd></div>`,
                `<div><dt>Billing size</dt><dd>${review.billing_size == null ? 'Unavailable' : esc(review.billing_size) + ' bytes'}</dd></div>`,
            ]
            if(review.gas_estimate_height != null){ feeRows.push(`<div><dt>Estimate height</dt><dd>${esc(review.gas_estimate_height)}</dd></div>`) }
            meta.push(mrow('Fee and gas', `<details class="av-fee"><summary>View fee and gas facts</summary><dl>${feeRows.join('')}</dl></details>`))
            if(review.valid_height_range){
                meta.push(mrow('Valid block range', `<b>${esc(review.valid_height_range.start)} - ${esc(review.valid_height_range.end)}</b>${review._strict_note ? ` <span class="avtag err">not verified (${esc(review._strict_note)})</span>` : ''}`))
            }
            if(review.chain_ids_allowed && review.chain_ids_allowed.length){
                meta.push(mrow('Networks allowed', `<b>${esc(review.chain_ids_allowed.join(', '))}</b>`))
            }
            // §7.4: self-referential echoes like 'signable: signable' read as debug output. The enum domains come from
            // the fullnode's sdk/src/audit.rs (full|structured|branching|opaque) and
            // inspect.rs (signability is currently always 'signable'); unknown values pass through as-is, never invented.
            let audmap = {
                full: 'full — every field is readable',
                structured: 'structured — complex actions are readable field-by-field',
                branching: 'branching — the outcome depends on chain state',
                opaque: 'opaque — part of the payload cannot be read',
            }
            let aud = audmap[review.auditability] || 'coverage: ' + esc(review.auditability)
            let pv = (review.protocol_valid === true || review.protocol_valid === 'true')
            let uc = (review.requires_user_confirmation === true || review.requires_user_confirmation === 'true')
            meta.push(mrow('Review status', `Audit coverage: ${aud} · Ready to sign: <b>${review.signability === 'signable' ? 'yes' : esc(review.signability)}</b> · Protocol checks: ${pv ? 'pass' : 'failed'} · Extra confirmation: ${uc ? 'required' : 'not required'}`))
            meta.push(mrow('Transaction hash', esc(review.tx_hash), true))
            meta.push(mrow('Hash with fee', esc(review.hash_with_fee), true))
            meta.push(mrow('Unsigned body hash', esc(review.unsigned_body_hash), true))
            if(review.review_binding){ meta.push(mrow('Review binding', esc(review.review_binding), true)) }
            meta.push(mrow('Codec profile hash', esc(review.codec_profile_hash), true))
            t.meta = meta.join('')
            let display = data.display || {}
            let acts = Array.isArray(review.actions) ? review.actions : Object.values(review.actions || {})
            let presentations = mnx_review_presentations(review, {
                height_clock: display.height_clock,
                asset_text: (atoms, serial) => mnx_asset_amount_text(atoms, serial),
            })
            // Decompile code-carrying actions first, then render into each card
            // (failures only affect display, never the signing decision).
            let sourceBinding = mnx_review_sourcemap_bind(acts, display.sourcemaps || [], display.legacy_sourcemap)
            let prints = {}, tasks = {}
            let collect = (list) => {
                for(let i = 0; i < (list || []).length; i++){
                    let act = list[i]
                    if(act && act.code){
                        tasks[act.path] = act
                        prints[act.path] = `<div class="codehint">Code review · action_path ${mnx_esc_html(act.path)} · pending</div>`
                    }
                    if(act && act.children){ collect(Array.isArray(act.children) ? act.children : Object.values(act.children || {})) }
                }
            }
            collect(acts)
            let tables = mnx_msglayout_normalize(data.msgparse || data.msglayouts || null)
            let bind = mnx_msglayout_bind(acts, tables)
            t.layouterr = (bind.errors || []).join(' ')
            let renderLines = () => {
                let out = [], layoutCtx = { byArrayIndex: bind.byArrayIndex, arrayIndex: 0, height_clock: display.height_clock, review }
                for(let i = 0; i < acts.length; i++){
                    layoutCtx.arrayIndex = i
                    out = out.concat(mnx_actv_render_action(acts[i], 0, prints, layoutCtx, presentations[i]))
                }
                t.lines = out
            }
            renderLines()
            for(let p in prints){
                if(cancelled){ break }
                await new Promise(resolve => setTimeout(resolve, 0))
                try {
                    prints[p] = await mnx_vm_decompile_html(tasks[p], 'detail', sourceBinding.byPath[p], sourceBinding.diagnostics[p] || sourceBinding.diagnostics['*'], display.address_table || review.address_table || [], () => !cancelled)
                } catch(e) {
                    prints[p] = `<pre class="codeprint err">decompile failed: ${mnx_esc_html(mnx_err_message(e))}</pre>`
                }
                if(cancelled){ break }
                renderLines()
            }
            // Signers
            let sg = {}
            let required = Array.isArray(review.required_signers) ? review.required_signers : Object.values(review.required_signers || {})
            for(let i = 0; i < required.length; i++){
                let s = required[i]
                let status = mnx_tx_signer_status(review, s)
                sg[s] = { address: s, status, complete: status === 'valid' }
            }
            t.signers = sg
        }
    }, async(t)=>{
        clbk && clbk()
        await t.load()
    });

}

