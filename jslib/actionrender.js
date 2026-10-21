/**
 * MoneyNex action renderer (presentation plan §7.2 "统一 renderer/serializer").
 *
 * One final renderer turns ActionPresentation nodes into safe HTML for the
 * Sign page lines (and the Details rows), and one plainText serializer
 * produces the DApp-callback / transaction-log text: full addresses, no HTML
 * entities, no code panels, no loading states. Tokens keep raw values; this
 * module never re-parses natural language and never chooses protocol
 * semantics. Height-estimate rendering moved here from moneynx_txview.js
 * (same output, now shared by Sign and Details through the same model).
 */

// linear time-estimate for a height from a loaded clock snapshot
var mnx_height_estimated_time = (height, clock) => {
    if(!clock || !clock.available){ return null }
    let seconds = clock.timestamp + (height - clock.height) * clock.block_target_seconds
    if(!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 8640000000000){ return null }
    return new Date(seconds * 1000).toISOString().replace(/:\d{2}\.\d{3}Z$/, ' UTC').replace('T', ' ')
}

// height scope html — the height-token renderer with the (optional) clock
// enrichment; without a clock it shows bare heights only
, mnx_height_scope_html = (act, clock) => {
    let fields = mnx_act_height_scope(act)
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

// height token with estimate title (single height, e.g. for field rows)
, mnx_height_token_html = (token, clock) => {
    let time = mnx_height_estimated_time(Number(token.v), clock)
    if(!time){ return mnx_esc_html(token.v) }
    let basis = `Linear estimate from the loaded chain snapshot; not a guaranteed arrival time.`
    return `${mnx_esc_html(token.v)} <small class="height-time" title="${mnx_esc_html(basis)}">(est. ${mnx_esc_html(time)})</small>`
}

// one address -> explorer link; the tx main address abbreviates to 7 chars on
// the Sign page (display-only — href and title keep the full value)
, mnx_address_html = (address, opts) => {
    let esc = mnx_esc_html
    opts = opts || {}
    let display = opts.abbrev_main && opts.main && address === opts.main ? address.slice(0, 7) + '...' : address
    let explorer = String(explorer_url || '')
    if(!/^https?:\/\//i.test(explorer)){ return esc(address) }
    return `<a class="${opts.cls || 'addr'}" href="${esc(explorer)}/address/${esc(address)}" target="_blank" rel="noopener noreferrer" title="${esc(address)}">${esc(display)}</a>`
}

// tokens -> HTML (everything escaped here; nothing downstream re-replaces)
, mnx_tokens_html = (tokens, opts) => {
    let esc = mnx_esc_html
    let out = []
    for(let token of (tokens || [])){
        if(!token){ continue }
        if(token.t === 'address'){
            out.push(mnx_address_html(token.v, opts))
        }else if(token.pointer != null){
            // Keep the readable address primary while retaining the exact
            // pointer identity as a tooltip and accessible label.
            let ref = `address pointer ${token.pointer}`
            if(token.resolved){
                out.push(`<span class="addrref" title="${esc(ref)}">${mnx_address_html(token.resolved, opts)}</span>`)
            }else{
                out.push(`<span class="addrref unresolved" title="${esc(ref)}">&lt;${esc(ref)}: unresolved&gt;</span>`)
            }
        }else if(token.t === 'amount'){
            let cls = 'amt' + (token.unknown_unit ? ' asset-unit-unknown' : '')
            out.push(`<b class="${cls}">${esc(token.v)}</b>`)
            if(token.unit){ out.push(' ' + esc(token.unit)) }
        }else if(token.t === 'height'){
            out.push(mnx_height_token_html(token, opts.height_clock))
        }else if(token.t === 'identifier'){
            out.push(`<code class="actid">${esc(token.v)}</code>`)
        }else if(token.t === 'payload'){
            out.push(`<code class="actpayload">${esc(token.v)}</code>`)
        }else{
            if(token.warning){
                out.push(`<strong class="asset-unit-warning" role="note">${esc(token.v)}</strong>`)
            }else{
                out.push(esc(token.v))
            }
        }
    }
    return out.join('')
}

// node -> one Sign-page line (with the 1-based number prefix kept by the
// existing callers); message layout blocks append as an independent section
, mnx_action_line_html = (node, index, opts) => {
    opts = opts || {}
    let line = `${index == null ? '' : `<span class="actnum">${index + 1}</span> `}${mnx_tokens_html(node.summary, opts)}`
    for(let field of (node.fields || [])){
        line += ` <span class="actfield">· ${mnx_esc_html(field.k)}: ${mnx_tokens_html(field.tokens, opts)}</span>`
    }
    for(let section of (node.sections || [])){
        if(section.html){ line += section.html }
    }
    let childLine = child => {
        let out = `<div class="height-scope-note">[${mnx_esc_html(child.path)}]${child.branch ? ` <b>${mnx_esc_html(child.branch)}</b>` : ''} ${mnx_tokens_html(child.summary, opts)}`
        for(let field of (child.fields || [])){
            out += ` · ${mnx_esc_html(field.k)}: ${mnx_tokens_html(field.tokens, opts)}`
        }
        out += '</div>'
        for(let nested of (child.children || [])){ out += childLine(nested) }
        return out
    }
    if(opts.include_children !== false){
        for(let child of (node.children || [])){ line += childLine(child) }
    }
    return line
}

// node -> plain text: full values, no HTML entities, no links, no panels.
// Children flatten into the parent line (the DApp contract is one string per
// top-level action).
, mnx_action_plain_text = (node) => {
    let part = (tokens) => (tokens || []).map(token => {
        if(token.t === 'address'){ return token.v }
        if(token.t === 'amount'){ return token.v + (token.unit ? ' ' + token.unit : '') }
        if(token.pointer != null){ return `<address pointer ${token.pointer}>${token.resolved ? ' = ' + token.resolved : ''}` }
        return token.v
    }).join('')
    let line = part(node.summary)
    for(let field of (node.fields || [])){
        line += ` · ${field.k}: ${part(field.tokens)}`
    }
    for(let child of (node.children || [])){
        line += ` [${child.path}]${child.branch ? ` ${child.branch}` : ''} ${mnx_action_plain_text(child)}`
    }
    return line
}

;
