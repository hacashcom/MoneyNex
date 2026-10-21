/**
 * MoneyNex action display model (presentation plan §7 "共享展示模型").
 *
 * Builds an ActionPresentation tree from one SDK Review, using exactly three
 * base modes — verbatim / decorate / structured — selected by an explicit
 * registry keyed on the SDK action name (never on description wording):
 *
 *   verbatim   — the SDK description rendered as plain tokens (unknown or
 *                unregistered kinds fall back here; nothing is hidden).
 *   decorate   — the SDK plain text tokenized, with address/amount styling
 *                attached only where a candidate provably matches a protocol
 *                fact (SDK address table / tx main / this action's fields).
 *   structured — the summary is rebuilt from SDK typed facts, then the
 *                SDK-decoded canonical JSON, covering the same behavior
 *                facts as the description; complex fields go to `fields`.
 *
 * The model is data, not HTML: tokens carry raw values, the renderer decides
 * links/abbreviations, and a plainText serializer exists for DApp callbacks
 * and transaction logs (full values, no HTML entity, no code panels).
 *
 * Enhancements (height estimates, asset metadata text, msglayout blocks,
 * maincall code) attach as independent sections/steps owned by the callers;
 * this module never blocks on them and never mutates the review.
 */

// mode registry: SDK action name -> {mode, adapter}. Unlisted names (and
// unknown kinds) fall back to verbatim — a missing adapter is a display
// limitation, never a hidden action.
var MNX_ACTION_MODES = {
    transfer_hac_to:            { mode: 'structured', adapter: 'transfer' },
    transfer_hac_from:          { mode: 'structured', adapter: 'transfer' },
    transfer_hac_from_to:       { mode: 'structured', adapter: 'transfer' },
    transfer_sat_to:            { mode: 'structured', adapter: 'transfer' },
    transfer_sat_from:          { mode: 'structured', adapter: 'transfer' },
    transfer_sat_from_to:       { mode: 'structured', adapter: 'transfer' },
    transfer_hacd_single_to:    { mode: 'structured', adapter: 'transfer' },
    transfer_hacd_from_to:      { mode: 'structured', adapter: 'transfer' },
    transfer_hacd_to:           { mode: 'structured', adapter: 'transfer' },
    transfer_hacd_from:         { mode: 'structured', adapter: 'transfer' },
    transfer_asset_to:          { mode: 'structured', adapter: 'transfer' },
    transfer_asset_from:        { mode: 'structured', adapter: 'transfer' },
    transfer_asset_from_to:     { mode: 'structured', adapter: 'transfer' },
    channel_open:               { mode: 'structured', adapter: 'channel' },
    channel_close:              { mode: 'decorate' },
    hacd_mint:                  { mode: 'decorate' },
    asset_create:               { mode: 'structured', adapter: 'asset_create' },
    tex_cell_execute:           { mode: 'structured', adapter: 'tex' },
    ast_select:                 { mode: 'structured', adapter: 'ast' },
    ast_if:                     { mode: 'structured', adapter: 'ast' },
    hacd_insc_push:             { mode: 'structured', adapter: 'inscription' },
    hacd_insc_clean:            { mode: 'structured', adapter: 'inscription' },
    hacd_insc_edit:             { mode: 'structured', adapter: 'inscription' },
    hacd_insc_move:             { mode: 'structured', adapter: 'inscription' },
    hacd_insc_drop:             { mode: 'structured', adapter: 'inscription' },
    contract_deploy:            { mode: 'structured', adapter: 'contract' },
    contract_update:            { mode: 'structured', adapter: 'contract' },
    // verbatim base summary; the code panel is an independent enrichment,
    // not a fourth mode
    contract_main_call:         { mode: 'verbatim', enrich: 'code' },
    p2sh_script_prove:          { mode: 'verbatim', enrich: 'code' },
    message:                    { mode: 'structured', adapter: 'payload' },
    blob:                       { mode: 'structured', adapter: 'payload' },
    chain_allow:                { mode: 'structured', adapter: 'guard' },
    height_scope:               { mode: 'structured', adapter: 'guard' },
    balance_floor:              { mode: 'structured', adapter: 'guard' },
    required_signers:           { mode: 'structured', adapter: 'guard' },
}

, MNX_ACTION_DESC_SCHEMA = 'hacash.sdk/action-desc@3'
, MNX_TRANSFER_DESC_SCHEMA = 'hacash.sdk/transfer-desc@1'

// kind fallback: names are the stable identity, but review snapshots from
// older SDK versions (and unit fixtures) may carry only the numeric kind.
, MNX_ACTION_MODES_BY_KIND = {
    1: MNX_ACTION_MODES.transfer_hac_to,
    2: MNX_ACTION_MODES.channel_open,
    3: MNX_ACTION_MODES.channel_close,
    4: MNX_ACTION_MODES.hacd_mint,
    5: MNX_ACTION_MODES.transfer_hacd_single_to,
    6: MNX_ACTION_MODES.transfer_hacd_from_to,
    7: MNX_ACTION_MODES.transfer_hacd_to,
    8: MNX_ACTION_MODES.transfer_hacd_from,
    10: MNX_ACTION_MODES.transfer_sat_to,
    11: MNX_ACTION_MODES.transfer_sat_from,
    12: MNX_ACTION_MODES.transfer_sat_from_to,
    13: MNX_ACTION_MODES.transfer_hac_from,
    14: MNX_ACTION_MODES.transfer_hac_from_to,
    16: MNX_ACTION_MODES.asset_create,
    17: MNX_ACTION_MODES.transfer_asset_to,
    18: MNX_ACTION_MODES.transfer_asset_from,
    19: MNX_ACTION_MODES.transfer_asset_from_to,
    22: MNX_ACTION_MODES.tex_cell_execute,
    25: MNX_ACTION_MODES.ast_select,
    26: MNX_ACTION_MODES.ast_if,
    32: MNX_ACTION_MODES.hacd_insc_push,
    33: MNX_ACTION_MODES.hacd_insc_clean,
    34: MNX_ACTION_MODES.hacd_insc_edit,
    35: MNX_ACTION_MODES.hacd_insc_move,
    36: MNX_ACTION_MODES.hacd_insc_drop,
    40: MNX_ACTION_MODES.contract_deploy,
    41: MNX_ACTION_MODES.contract_update,
    44: MNX_ACTION_MODES.contract_main_call,
    46: MNX_ACTION_MODES.p2sh_script_prove,
    1025: MNX_ACTION_MODES.message,
    1026: MNX_ACTION_MODES.blob,
    1041: MNX_ACTION_MODES.chain_allow,
    1042: MNX_ACTION_MODES.height_scope,
    1043: MNX_ACTION_MODES.balance_floor,
    1044: MNX_ACTION_MODES.required_signers,
}

// token constructors — the model keeps raw values; formatting is the renderer's
, mnx_tok_text = v => ({ t: 'text', v: String(v) })
, mnx_tok_address = v => ({ t: 'address', v: String(v) })
, mnx_tok_amount = (v, unit, extra) => ({ t: 'amount', v: String(v), unit: unit || '', ...(extra || {}) })
, mnx_tok_height = v => ({ t: 'height', v: String(v) })
, mnx_tok_identifier = v => ({ t: 'identifier', v: String(v) })
, mnx_tok_payload = v => ({ t: 'payload', v: String(v) })

// endpoint {kind} -> tokens; pointers stay visibly pointers, resolved value
// (from the SDK address table) rides along as data
, mnx_endpoint_tokens = endpoint => {
    if(!endpoint){ return [] }
    if(endpoint.kind === 'address'){ return [mnx_tok_address(endpoint.value)] }
    if(endpoint.kind === 'pointer'){
        let tok = mnx_tok_text(`<address pointer ${endpoint.index}>`)
        tok.pointer = endpoint.index
        tok.resolved = endpoint.resolved || null
        return [tok]
    }
    if(endpoint.kind === 'invalid-reference'){
        let tok = mnx_tok_text(`<invalid address reference: ${endpoint.value}>`)
        tok.warning = true
        return [tok]
    }
    return [mnx_tok_text('the transaction main address')]
}
, mnx_endpoint_plain = endpoint => {
    if(!endpoint){ return 'the transaction main address' }
    if(endpoint.kind === 'address'){ return endpoint.value }
    if(endpoint.kind === 'pointer'){ return endpoint.resolved || `<address pointer ${endpoint.index}>` }
    if(endpoint.kind === 'invalid-reference'){ return `<invalid address reference: ${endpoint.value}>` }
    return 'the transaction main address'
}

// The set of addresses a decorate scan may prove: tx main, the SDK address
// table, and any concrete address fields of this action's canonical JSON.
, mnx_decorate_known_addresses = function(act, review) {
    let known = {}
    if(review && typeof review.main === 'string' && review.main){ known[review.main] = true }
    for(let a of ((review && review.address_table) || [])){
        if(typeof a === 'string' && a){ known[a] = true }
    }
    let json = mnx_act_json(act) || {}
    let collect = (value, depth) => {
        if(depth > 8 || value == null){ return }
        if(typeof value === 'string' && /^[a-km-zA-HJ-NP-Z1-9]{28,34}$/.test(value)){ known[value] = true }
        else if(Array.isArray(value)){ for(let item of value){ collect(item, depth + 1) } }
        else if(typeof value === 'object'){ for(let key in value){ collect(value[key], depth + 1) } }
    }
    collect(json, 0)
    return known
}

// Only canonical AddrOrPtr fields of identity-checked transfer schemas can
// authorize replacement of the SDK's pointer placeholder in its description.
, mnx_decorate_pointer_refs = function(act, review) {
    let kinds = {
        1: ['to'], 13: ['from'], 14: ['from','to'],
        10: ['to'], 11: ['from'], 12: ['from','to'],
        5: ['to'], 6: ['from','to'], 7: ['to'], 8: ['from'],
        17: ['to'], 18: ['from'], 19: ['from','to'],
    }
    let fields = kinds[Number(act && act.kind)]
    let kind = Number(act && act.kind)
    if(kind === 1043){ fields = ['addr'] }
    if(!fields && kind !== 1044 || act.schema != null && act.schema !== MNX_ACTION_DESC_SCHEMA ||
        act.transfer && act.transfer.schema != null && act.transfer.schema !== MNX_TRANSFER_DESC_SCHEMA){ return {} }
    let known = MNX_ACTION_MODES[act.name]
    let expectedAdapter = kind === 1043 || kind === 1044 ? 'guard' : 'transfer'
    if(act.name && (!known || known.adapter !== expectedAdapter || MNX_ACTION_MODES_BY_KIND[kind] !== known)){ return {} }
    let json = mnx_act_json(act)
    if(!json){ return {} }
    let refs = {}
    for(let field of (fields || [])){
        let endpoint = mnx_act_endpoint(act, field, review)
        if(endpoint && endpoint.kind === 'pointer'){ refs[endpoint.index] = endpoint }
    }
    if(kind === 1044 && Array.isArray(json.signers)){
        for(let raw of json.signers){
            let index = mnx_act_uint(raw, 235)
            if(index == null){ continue }
            let table = review && review.address_table
            refs[index] = { kind: 'pointer', index, resolved: Array.isArray(table) && typeof table[index] === 'string' ? table[index] : null }
        }
    }
    return refs
}

// decorate: scan the ORIGINAL plain text; an address candidate becomes an
// address token only when it provably matches a known protocol fact. Amount
// styling matches already-decimal SDK wording only — no unit conversion, no
// guessing whether a number is an amount (that is structured's job).
, mnx_decorate_text = function(text, act, review) {
    let known = mnx_decorate_known_addresses(act, review)
    let pointers = mnx_decorate_pointer_refs(act, review)
    let tokens = []
    let rest = String(text == null ? '' : text)
    let pattern = /<address pointer (\d+)>|([a-km-zA-HJ-NP-Z1-9]{28,34})|((?:\d{1,24})(?:\.\d{1,24})? (?:HAC|SAT|HACD)\b)/g
    let match, last = 0
    while((match = pattern.exec(rest)) !== null){
        if(match.index > last){ tokens.push(mnx_tok_text(rest.slice(last, match.index))) }
        if(match[1]){
            let ref = pointers[Number(match[1])]
            if(ref){ tokens = tokens.concat(mnx_endpoint_tokens(ref)) }
            else{ tokens.push(mnx_tok_text(match[0])) }
        }else if(match[2]){
            if(known[match[2]]){ tokens.push(mnx_tok_address(match[2])) }
            else{ tokens.push(mnx_tok_text(match[2])) }
        }else{
            let space = match[3].lastIndexOf(' ')
            tokens.push(mnx_tok_amount(match[3].slice(0, space), match[3].slice(space + 1)))
        }
        last = match.index + match[0].length
    }
    if(last < rest.length){ tokens.push(mnx_tok_text(rest.slice(last))) }
    return tokens.length ? tokens : [mnx_tok_text(rest)]
}

// ---------------------------- structured adapters ----------------------------
// Each adapter returns {summary: tokens, fields: [{k, tokens}], sections: []}
// or null (adapter miss -> decorate/verbatim fallback with a diagnostic).

, mnx_adapter_transfer = function(act, ctx) {
    let facts = mnx_transfer_facts(act, ctx.review)
    if(!facts || !facts.payload){ return null }
    let p = facts.payload
    let tokens = [mnx_tok_text('Transfer ')]
    let fields = []
    if(p.type === 'hac'){
        tokens.push(mnx_tok_amount(p.amount, 'HAC'))
    }else if(p.type === 'satoshi'){
        tokens.push(mnx_tok_amount(p.atoms, 'SAT'))
    }else if(p.type === 'hacd'){
        tokens.push(mnx_tok_amount(p.count != null ? p.count : p.names.length, 'HACD'))
        if(p.names.length){ tokens.push(mnx_tok_text(` (${p.names.join(',')})`)) }
    }else if(p.type === 'asset'){
        let amt = ctx.asset_text(p.atoms, p.serial)
        let amount = mnx_tok_amount(amt.text, amt.unit || '')
        if(!amt.known){ amount.unknown_unit = true }
        tokens.push(amount)
        tokens.push(mnx_tok_text(` (Asset #${p.serial})`))
        if(!amt.known){
            tokens.push(mnx_tok_text(' '))
            let warn = mnx_tok_text('Decimals unknown: raw atoms, not token units')
            warn.warning = true
            tokens.push(warn)
        }
    }
    tokens.push(mnx_tok_text(' from '))
    tokens = tokens.concat(mnx_endpoint_tokens(facts.from))
    tokens.push(mnx_tok_text(' to '))
    tokens = tokens.concat(mnx_endpoint_tokens(facts.to))
    return { summary: tokens, fields, sections: [] }
}

, mnx_adapter_guard = function(act, ctx) {
    let kind = Number(act && act.kind)
    if(kind === 1042){
        let facts = mnx_act_height_scope(act)
        if(!facts){ return null }
        return {
            summary: [mnx_tok_text('Height scope '), mnx_tok_height(facts.start), mnx_tok_text(' to '),
                facts.end === 0 ? mnx_tok_text('Unlimited') : mnx_tok_height(facts.end)],
            fields: [], sections: [],
        }
    }
    if(kind === 1041){
        let facts = mnx_act_chain_allow(act)
        if(!facts){ return null }
        let tokens = [mnx_tok_text('Allowed networks (chain IDs): ')]
        facts.chains.forEach((id, i) => {
            if(i){ tokens.push(mnx_tok_text(', ')) }
            tokens.push(mnx_tok_identifier(id))
        })
        return { summary: tokens, fields: [], sections: [] }
    }
    if(kind === 1043){
        let facts = mnx_act_balance_floor(act, ctx.review)
        if(!facts){ return null }
        let tokens = [mnx_tok_text('Balance floor · ')]
        tokens = tokens.concat(mnx_endpoint_tokens(facts.addr))
        let parts = []
        for(let part of facts.parts){
            if(part.type === 'hac'){ parts.push(`≥ ${part.amount} HAC`) }
            else if(part.type === 'satoshi'){ parts.push(`≥ ${part.atoms} SAT`) }
            else if(part.type === 'hacd'){ parts.push(`≥ ${part.count} HACD`) }
            else{ parts.push(`≥ Asset #${part.serial} ${part.atoms} atoms`) }
        }
        tokens.push(mnx_tok_text(parts.length ? ' · ' + parts.join(' · ') : ' (empty floor)'))
        return { summary: tokens, fields: [], sections: [] }
    }
    if(kind === 1044){
        let facts = mnx_act_required_signers(act, ctx.review)
        if(!facts){ return null }
        let tokens = [mnx_tok_text('Extra signatures required from ')]
        facts.signers.forEach((s, i) => {
            if(i){ tokens.push(mnx_tok_text(', ')) }
            tokens = tokens.concat(mnx_endpoint_tokens(s))
        })
        return { summary: tokens, fields: [], sections: [] }
    }
    return null
}

, mnx_adapter_payload = function(act, ctx) {
    let facts = mnx_act_payload(act)
    if(!facts){ return null }
    let tokens = [mnx_tok_text(facts.kind === 1025 ? 'Message · ' : 'Blob · '), mnx_tok_amount(facts.bytes, 'bytes')]
    if(facts.text){ tokens.push(mnx_tok_text(' · '), mnx_tok_payload(facts.text)) }
    else if(facts.hex){
        let preview = facts.hex.slice(0, 128 * 2)
        tokens.push(mnx_tok_text(' · '), mnx_tok_payload('0x' + preview + (preview.length < facts.hex.length ? '…' : '')))
    }
    return { summary: tokens, fields: [], sections: [] }
}

, mnx_adapter_inscription = function(act, ctx) {
    let facts = mnx_act_inscription(act)
    if(!facts){ return null }
    let tokens = []
    if(facts.op === 'push'){
        tokens.push(mnx_tok_text(`Append inscription type ${facts.engraved_type} ${facts.content || ''} to ${facts.diamonds.length} HACD (${facts.diamonds.join(',')})`))
    }else if(facts.op === 'clean'){
        tokens.push(mnx_tok_text(`Remove all inscriptions from ${facts.diamonds.length} HACD (${facts.diamonds.join(',')})`))
    }else if(facts.op === 'edit'){
        tokens.push(mnx_tok_text(`Replace inscription at index ${facts.index} (0-based) of HACD ${facts.diamond} with type ${facts.engraved_type} ${facts.content || ''}`))
    }else if(facts.op === 'move'){
        tokens.push(mnx_tok_text(`Move inscription at index ${facts.index} (0-based) from HACD ${facts.from} to HACD ${facts.to}`))
    }else{
        tokens.push(mnx_tok_text(`Delete inscription at index ${facts.index} (0-based) from HACD ${facts.diamond}`))
    }
    let fields = []
    if(facts.cost != null){ fields.push({ k: 'protocol fee', tokens: [mnx_tok_amount(facts.cost, 'HAC')] }) }
    return { summary: tokens, fields, sections: [] }
}

, mnx_adapter_channel = function(act, ctx) {
    let facts = mnx_act_channel(act)
    if(!facts){ return null }
    if(facts.close){
        return { summary: [mnx_tok_text('Close channel '), mnx_tok_identifier(facts.id)], fields: [], sections: [] }
    }
    let tokens = [mnx_tok_text('Open channel '), mnx_tok_identifier(facts.id), mnx_tok_text(': '),
        mnx_tok_address(facts.left.address), mnx_tok_text(' locks '), mnx_tok_amount(facts.left.amount || '0', 'HAC'),
        mnx_tok_text(', '), mnx_tok_address(facts.right.address), mnx_tok_text(' locks '), mnx_tok_amount(facts.right.amount || '0', 'HAC')]
    return { summary: tokens, fields: [], sections: [] }
}

, mnx_adapter_asset_create = function(act, ctx) {
    let facts = mnx_asset_registration_facts(act)
    if(!facts || facts.serial == null || !facts.ticket || !facts.name || !facts.issuer || facts.supply == null || facts.decimals == null || facts.protocol_cost == null){
        return null // metadata unreadable -> fallback to the SDK sentence
    }
    return {
        summary: [mnx_tok_text(`Register asset #${facts.serial} `), mnx_tok_payload(facts.ticket), mnx_tok_text(' · '), mnx_tok_payload(facts.name), mnx_tok_text(' · issuer '), mnx_tok_address(facts.issuer)],
        fields: [
            { k: 'supply', tokens: [mnx_tok_amount(facts.supply, 'atoms')] },
            { k: 'decimals', tokens: [mnx_tok_identifier(facts.decimals)] },
            ...(facts.protocol_cost && facts.protocol_cost !== '0:0' ? [{ k: 'protocol fee', tokens: [mnx_tok_amount(mnx_fin_to_decimal(facts.protocol_cost), 'HAC')] }] : []),
        ],
        sections: [],
    }
}

, mnx_adapter_contract = function(act, ctx) {
    let kind = Number(act && act.kind)
    if(kind === 40){
        let facts = mnx_contract_deployment_facts(act, ctx.review && ctx.review.main)
        let fields = []
        if(facts && facts.address){
            fields.push({ k: 'deployed address (wallet derived)', tokens: [mnx_tok_address(facts.address)] })
        }
        // summary is the SDK sentence (already the contract structure summary
        // under spec action-description@1)
        return { summary: mnx_decorate_text(act.description, act, ctx.review), fields, sections: [] }
    }
    if(kind === 41){
        return { summary: mnx_decorate_text(act.description, act, ctx.review), fields: [], sections: [] }
    }
    return null
}

, mnx_adapter_ast = function(act, ctx) {
    let json = mnx_act_json(act)
    if(Number(act.kind) === 25 && json){
        let actions = Array.isArray(json.actions) ? json.actions : null
        if(actions && Number.isInteger(Number(json.exe_min)) && Number.isInteger(Number(json.exe_max))){
            return { summary: [mnx_tok_text(`Execute between ${json.exe_min} and ${json.exe_max} of ${actions.length} listed actions in order; reverted actions are skipped`)], fields: [], sections: [] }
        }
    }
    if(Number(act.kind) === 26 && json && json.cond && json.br_if && json.br_else){
        let c = json.cond
        let select = value => value && Number.isInteger(Number(value.exe_min)) && Number.isInteger(Number(value.exe_max))
            ? `select ${value.exe_min} to ${value.exe_max} of ${(value.actions || []).length} actions`
            : null
        let cond = select(c)
        let yes = select(json.br_if), no = select(json.br_else)
        if(cond && yes && no){
            return {
                summary: [mnx_tok_text(`If condition ${cond} succeeds, execute the if-branch; otherwise execute the else-branch`)],
                fields: [
                    { k: 'condition select', tokens: [mnx_tok_text(cond)] },
                    { k: 'if-branch select', tokens: [mnx_tok_text(yes)] },
                    { k: 'else-branch select', tokens: [mnx_tok_text(no)] },
                ],
                sections: [],
            }
        }
    }
    return null
}

, mnx_adapter_tex = function(act, ctx) {
    let json = mnx_act_json(act)
    if(!json || typeof json.addr !== 'string' || !Array.isArray(json.cells)){ return null }
    let cellText = cell => {
        let id = Number(cell && cell.cellid)
        let val = key => cell && cell[key] != null ? String(cell[key]) : null
        let integer = value => value != null && /^\d+$/.test(String(value))
        let hac = value => {
            if(!integer(value)){ return null }
            let digits = String(value).padStart(9, '0')
            let whole = digits.slice(0, -8).replace(/^0+(?=\d)/, '')
            let fraction = digits.slice(-8).replace(/0+$/, '')
            return whole + (fraction ? '.' + fraction : '')
        }
        let n, unit, verb
        if(id === 1 || id === 2){ n = hac(val('haczhu')); unit = ' HAC'; verb = id === 1 ? 'pay' : 'get' }
        else if(id === 3 || id === 4){ n = val('satnum'); unit = ' SAT'; verb = id === 3 ? 'pay' : 'get' }
        else if(id === 5){ let names = mnx_split_diamond_names(cell.diamonds); return names.length && typeof cell.diamonds === 'string' ? `pay HACD (${names.join(',')}) into TEX escrow` : null }
        else if(id === 6){ return integer(val('dianum')) ? `get ${val('dianum')} HACD from TEX escrow` : null }
        else if(id === 7 || id === 8){ let asset = cell.asset; if(!asset || !integer(asset.amount) || !integer(asset.serial)){ return null } return `${id === 7 ? 'pay' : 'get'} ${asset.amount} atoms of Asset #${asset.serial} ${id === 7 ? 'into' : 'from'} TEX escrow` }
        else if(id >= 11 && id <= 22){
            let key = id <= 13 ? 'haczhu' : id <= 16 ? 'satoshi' : id <= 19 ? 'diamond' : 'asset'
            let cmp = ['at most','at least','equal to'][(id - 11) % 3]
            let unit = id <= 13 ? ' HAC balance' : id <= 16 ? ' SAT balance' : id <= 19 ? ' HACD balance' : ' asset balance'
            let v = cell[key]
            if(key === 'haczhu'){ if(!integer(v)){ return null }; v = hac(v) }
            if(key === 'asset' && v && integer(v.amount) && integer(v.serial)){ v = `${v.amount} atoms of Asset #${v.serial}` }
            if(v == null || key !== 'asset' && key !== 'haczhu' && !integer(v) || key === 'asset' && typeof v !== 'string'){ return null }
            return `require${unit} ${cmp} ${v}${id <= 13 ? ' HAC' : ''}`
        }else if(id === 23 || id === 24){ return integer(val('height')) ? `require block height ${id === 23 ? 'at most' : 'at least'} ${val('height')}` : null }
        else if(id === 25){ return integer(val('chainid')) ? `require chain ID equal to ${val('chainid')}` : null }
        else { return null }
        if(n == null || id > 2 && !integer(n)){ return null }
        return `${verb} ${n}${unit} ${verb === 'pay' ? 'into' : 'from'} TEX escrow`
    }
    let cells = json.cells.map(cellText)
    if(cells.some(v => v == null)){ return null }
    let fields = cells.map((cell, index) => ({ k: `cell ${index + 1}`, tokens: [mnx_tok_text(cell)] }))
    let tokens = [mnx_tok_text('Execute TEX cells signed by '), mnx_tok_address(json.addr)]
    return { summary: tokens, fields, sections: [] }
}

, MNX_ACTION_ADAPTERS = {
    transfer: mnx_adapter_transfer,
    guard: mnx_adapter_guard,
    payload: mnx_adapter_payload,
    inscription: mnx_adapter_inscription,
    channel: mnx_adapter_channel,
    asset_create: mnx_adapter_asset_create,
    contract: mnx_adapter_contract,
    ast: mnx_adapter_ast,
    tex: mnx_adapter_tex,
}

// ---------------------------- the model builder ----------------------------

// ctx: { review, height_clock, asset_text(atoms, serial) -> {text, unit, known} }
// Node: { path, kind, name, mode, sdkDescription, summary, fields, sections,
//         diagnostics, children }
, mnx_action_presentation = function(act, ctx, depth) {
    depth = depth || 0
    let diagnostics = []
    let name = act && typeof act.name === 'string' && act.name ? act.name : null
    let registry = name ? MNX_ACTION_MODES[name] : null
    if(!name && act && act.kind != null){
        registry = MNX_ACTION_MODES_BY_KIND[Number(act.kind)] || null
    }
    let mode = registry ? registry.mode : 'verbatim'
    if(name && registry && act && act.kind != null && MNX_ACTION_MODES_BY_KIND[Number(act.kind)] !== registry){
        registry = null
        mode = 'verbatim'
        diagnostics.push('action name/kind mismatch: showing the SDK description')
    }
    if(registry && act && ((act.schema != null && act.schema !== MNX_ACTION_DESC_SCHEMA) ||
        (act.transfer && act.transfer.schema != null && act.transfer.schema !== MNX_TRANSFER_DESC_SCHEMA))){
        registry = null
        mode = 'verbatim'
        diagnostics.push('unsupported action or typed-fact schema: showing the SDK description')
    }
    let sdkDescription = act && act.description != null ? String(act.description) : null
    let summary = null
    let fields = []
    let sections = []
    let adapterSucceeded = false

    if(mode === 'structured'){
        let adapter = registry && MNX_ACTION_ADAPTERS[registry.adapter]
        let built = null
        try { built = adapter ? adapter(act, ctx) : null } catch(e){ built = null }
        if(built && built.summary && built.summary.length){
            adapterSucceeded = true
            summary = built.summary
            fields = built.fields || []
            sections = built.sections || []
        }else{
            mode = sdkDescription ? 'decorate' : 'verbatim'
            diagnostics.push('structured adapter miss: showing the SDK description')
        }
    }
    if(mode === 'decorate'){
        summary = mnx_decorate_text(sdkDescription, act, ctx.review)
    }
    if(!summary){
        // verbatim / fallback: SDK description, else readable name/kind identity
        if(sdkDescription != null && sdkDescription !== ''){
            summary = [mnx_tok_text(sdkDescription)]
        }else{
            summary = [mnx_tok_text(name || `Action kind ${act && act.kind}`)]
            diagnostics.push('no SDK description: showing the action identity')
        }
    }

    let children = []
    for(let child of ((act && act.children) || [])){
        children.push(mnx_action_presentation(child, ctx, depth + 1))
    }
    if(adapterSucceeded && registry && registry.adapter === 'ast' && Number(act && act.kind) === 26 && act.path != null){
        let prefix = String(act.path) + '/'
        let markBranch = child => {
            let rest = child.path.startsWith(prefix) ? child.path.slice(prefix.length) : ''
            let branch = rest.split('/')[0]
            if(branch === '0' || branch === '1' || branch === '2'){
                child.branch = ['condition', 'if-branch', 'else-branch'][Number(branch)]
            }
            for(let nested of (child.children || [])){ markBranch(nested) }
        }
        for(let child of children){ markBranch(child) }
    }
    return {
        path: act && act.path != null ? String(act.path) : '',
        kind: act && act.kind != null ? Number(act.kind) : null,
        name,
        mode,
        sdkDescription,
        summary,
        fields,
        sections,
        diagnostics,
        children,
    }
}

// whole-tree builder for one review
, mnx_review_presentations = function(review, ctx) {
    let full = {
        review,
        height_clock: ctx && ctx.height_clock || null,
        asset_text: (ctx && ctx.asset_text) || (atoms => ({ text: String(atoms), unit: '', known: false })),
    }
    let out = []
    for(let act of ((review && review.actions) || [])){
        out.push(mnx_action_presentation(act, full, 0))
    }
    return out
}

;
