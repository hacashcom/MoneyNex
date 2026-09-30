// const API = 12

function dealAccountApi() {


messageHandler['wallet'] = async function(req, sender, ok){
    // Origin must come from sender.url; replies and the connect popup must bind to
    // sender.tab.id, not the "active tab" (a background/other-window DApp would get
    // its reply delivered to the wrong page).
    // Unauthorized origins go to the connect page (did/tid kept; callback contract
    // unchanged: on approval, connect replies {address} to this wallet request)
    let origin = ''
    , tabid = 0
    try {
        if(sender && sender.url){
            origin = new URL(sender.url).origin
        }
        if(sender && sender.tab && sender.tab.id){
            tabid = sender.tab.id
        }
    } catch(e){}
    if(!origin){
        ok({err: 'unknown request origin'})
        return
    }
    let authorized = await isConnectAuthorized(origin)
    if(!authorized){
        req.dmu = origin
        req.action = optkey_connect_account
        // P3-2: reclaim any stale pending connect window for this origin first
        await openConnectApproval(req, tabid)
        ok({})
        return
    }
    let address = await stoReadCurrentAccount()
    if(!tabid){
        // No source tab (not from a content script): reply can't be delivered — fail loudly instead of hanging silently
        ok({err: 'wallet request has no source tab'})
        return
    }
    await sendMessageToTabContent(tabid, req, {address});
    ok({})
}


// Chain status api: reply chain config status to the requesting tab directly
// (non-sensitive; no connect gate — matches the remote design). Hardened reply
// path: bind to sender's tab, never the "active tab".
messageHandler['chain'] = async function(req, sender, ok){
    let tabid = 0
    try {
        if(sender && sender.tab && sender.tab.id){
            tabid = sender.tab.id
        }
    } catch(e){}
    let res = await getChainApiStatus(req)
    if(tabid){
        await sendMessageToTabContent(tabid, req, res)
    }
    ok({})
}


// ---- chain config store (merged from remote; bg_ prefix avoids clashing with
// the popup-side chain.js service helpers in page bundles) ----

const bg_MAIN_CHAIN_ID = 0
, bg_mainnet_explorer_url = 'https://explorer.hacash.org'
, bg_mainnet_fullnode_url = 'http://wallet.hacash.com/fullnode'
, bg_chain_configs_key = 'chain_configs'
, bg_current_chain_id_key = 'current_chain_id'
, bg_default_chain_configs = {
    0: {
        id: 0,
        name: 'Mainnet',
        rpc: bg_mainnet_fullnode_url,
        explorer: bg_mainnet_explorer_url,
        remark: 'Hacash main chain',
        builtin: true,
    }
}
, bgChainIdOf = cfg => parseInt((cfg||{}).id || cfg.chain_id || cfg || 0) || 0
, bgIsMainChainId = id => bgChainIdOf(id) === bg_MAIN_CHAIN_ID
, bgChainAutoName = id => id ? `Chain ID ${id}` : 'Mainnet'
, bgChainNormalize = cfg => {
    cfg = cfg || {}
    let id = parseInt(cfg.id || cfg.chain_id || 0) || 0
    , name = ((cfg.name || '') + '').trim() || bgChainAutoName(id)
    return {
        id,
        name,
        rpc: (cfg.rpc || cfg.fullnode || (id ? '' : bg_mainnet_fullnode_url)) + '',
        explorer: (cfg.explorer || (id ? '' : bg_mainnet_explorer_url)) + '',
        remark: (cfg.remark || cfg.description || '') + '',
        builtin: !!cfg.builtin || bgIsMainChainId(id),
    }
}
, bgStoLocalRead = async (key, defv) => {
    let obj = await chrome_storage_local.get(key)
    return obj[key] || defv
}
, bgStoReadChainConfigs = async () => {
    let cfgs = await bgStoLocalRead(bg_chain_configs_key, {})
    for(let k in bg_default_chain_configs) {
        if(!cfgs[k]) {
            cfgs[k] = bg_default_chain_configs[k]
        }
    }
    for(let k in cfgs) {
        cfgs[k] = bgChainNormalize(cfgs[k])
    }
    return cfgs
}
, bgStoReadCurrentChain = async () => {
    let cfgs = await bgStoReadChainConfigs()
    , id = parseInt(await bgStoLocalRead(bg_current_chain_id_key, 0) || 0) || 0
    return cfgs[id] || cfgs[bg_MAIN_CHAIN_ID] || bg_default_chain_configs[bg_MAIN_CHAIN_ID]
}
, bgRequestedChainConfig = req => bgChainNormalize({
    id: req.chain_id || req.id,
    name: req.name,
    rpc: req.rpc,
    explorer: req.explorer,
    remark: req.remark,
})
, bgHasRequestedChainDiff = (saved, req) => {
    if(!saved) return false
    let fields = ['name', 'rpc', 'explorer', 'remark']
    for(let i in fields) {
        let k = fields[i]
        if(req[k] !== undefined && req[k] !== '' && (req[k] + '') !== ((saved[k] || '') + '')) {
            return true
        }
    }
    return false
}
, getChainApiStatus = async req => {
    req = req || {}
    let current = bgChainNormalize(await bgStoReadCurrentChain())
    , currentId = bgChainIdOf(current)
    , cfgs = await bgStoReadChainConfigs()
    , targetId = req.chain_id === undefined && req.id === undefined ? currentId : (parseInt(req.chain_id || req.id || 0) || 0)
    , saved = cfgs[targetId] ? bgChainNormalize(cfgs[targetId]) : null
    , request = bgRequestedChainConfig(Object.assign({}, req, {chain_id: targetId}))
    , diff = !!(saved && bgHasRequestedChainDiff(saved, req))
    , matched = currentId === targetId
    return {
        current_chain_id: currentId,
        current_chain: current,
        target_chain_id: targetId,
        target_chain: saved,
        request_chain: request,
        configured: !!saved,
        matched,
        need_add: !saved,
        need_switch: !matched,
        diff,
    }
}




}
