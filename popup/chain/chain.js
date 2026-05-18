var MAIN_CHAIN_ID = 0
, CHAIN_ALLOW_KIND = 0x0411
, mainnet_explorer_url = 'https://explorer.hacash.org'
, mainnet_fullnode_url = 'http://wallet.hacash.com/fullnode'
, explorer_url = mainnet_explorer_url
, fullnode_url = mainnet_fullnode_url
, chain_configs_key = 'chain_configs'
, current_chain_id_key = 'current_chain_id'
, current_chain = nil
, default_chain_configs = {
    0: {
        id: 0,
        name: 'Mainnet',
        rpc: mainnet_fullnode_url,
        explorer: mainnet_explorer_url,
        remark: 'Hacash main chain',
        builtin: true,
    }
}
, chainAutoName = id => id ? `Chain ID ${id}` : 'Mainnet'
, chainName = cfg => {
    cfg = cfg || current_chain || default_chain_configs[MAIN_CHAIN_ID]
    let id = parseInt((cfg||{}).id || cfg.chain_id || cfg || 0) || 0
    , name = ((typeof cfg == 'object' ? cfg.name : '') || '').trim()
    return name || chainAutoName(id)
}
, chainNormalize = cfg => {
    cfg = cfg || {}
    let id = parseInt(cfg.id || cfg.chain_id || 0) || 0
    return {
        id,
        name: chainName({id, name: cfg.name}),
        rpc: (cfg.rpc || cfg.fullnode || (id ? '' : mainnet_fullnode_url)) + '',
        explorer: (cfg.explorer || (id ? '' : mainnet_explorer_url)) + '',
        remark: (cfg.remark || cfg.description || '') + '',
        builtin: !!cfg.builtin || isMainChainId(id),
    }
}
, chainIdOf = cfg => parseInt((cfg||{}).id || cfg || 0) || 0
, isMainChainId = id => chainIdOf(id) === MAIN_CHAIN_ID
, stoReadChainConfigs = async () => {
    let cfgs = await stoLocalRead(chain_configs_key, {})
    , changed = no
    for(let k in default_chain_configs) {
        if(!cfgs[k]) {
            cfgs[k] = default_chain_configs[k]
            changed = yes
        }
    }
    for(let k in cfgs) {
        cfgs[k] = chainNormalize(cfgs[k])
    }
    if(changed) {
        await stoLocalSave(chain_configs_key, cfgs)
    }
    return cfgs
}
, stoSaveChainConfigs = async cfgs => {
    cfgs = cfgs || {}
    cfgs[MAIN_CHAIN_ID] = chainNormalize(Object.assign({}, default_chain_configs[MAIN_CHAIN_ID], cfgs[MAIN_CHAIN_ID] || {}))
    return await stoLocalSave(chain_configs_key, cfgs)
}
, stoSaveCurrentChainId = async id => {
    id = parseInt(id || 0) || 0
    await stoLocalSave(current_chain_id_key, id)
    return await stoReadCurrentChain()
}
, stoReadCurrentChain = async () => {
    let cfgs = await stoReadChainConfigs()
    , id = parseInt(await stoLocalRead(current_chain_id_key, 0) || 0) || 0
    , cfg = cfgs[id] || cfgs[MAIN_CHAIN_ID] || default_chain_configs[MAIN_CHAIN_ID]
    if(!cfgs[id]) {
        await stoSaveCurrentChainId(MAIN_CHAIN_ID)
        cfg = cfgs[MAIN_CHAIN_ID]
    }
    current_chain = chainNormalize(cfg)
    fullnode_url = current_chain.rpc || mainnet_fullnode_url
    explorer_url = current_chain.explorer || mainnet_explorer_url
    return current_chain
}
, getCurrentChain = async () => current_chain || await stoReadCurrentChain()
, chainTip = cfg => {
    cfg = cfg || current_chain || default_chain_configs[MAIN_CHAIN_ID]
    let id = chainIdOf(cfg)
    if(isMainChainId(id)) {
        return chainName(cfg)
    }
    let name = chainName(cfg)
    , idtip = name == `Chain ID ${id}` ? '' : ` | ID ${id}`
    return `${name}${idtip}${cfg.remark ? ' | '+cfg.remark : ''}`
}
, chainRemark = cfg => ((cfg || {}).remark || '') + ''
, chainRpcText = cfg => ((cfg || {}).rpc || '').replace(/^https?:\/\//i, '')
, stoUpsertChainConfig = async cfg => {
    cfg = chainNormalize(cfg)
    if(!cfg.rpc) {
        return {err: 'RPC URL is required'}
    }
    let cfgs = await stoReadChainConfigs()
    cfgs[cfg.id] = Object.assign({}, cfgs[cfg.id] || {}, cfg)
    await stoSaveChainConfigs(cfgs)
    return cfg
}
, stoRemoveChainConfig = async id => {
    id = parseInt(id || 0) || 0
    if(isMainChainId(id)) {
        return {err: 'Mainnet cannot be removed'}
    }
    let cfgs = await stoReadChainConfigs()
    delete cfgs[id]
    await stoSaveChainConfigs(cfgs)
    if(chainIdOf(await getCurrentChain()) === id) {
        await stoSaveCurrentChainId(MAIN_CHAIN_ID)
    }
    return {}
}
, chainConfigFromUrlQuery = () => chainNormalize({
    id: urlquery.chain_id || urlquery.id,
    name: urlquery.name,
    rpc: urlquery.rpc,
    explorer: urlquery.explorer,
    remark: urlquery.remark,
})
, requestChainId = defaultMainnet => {
    if(urlquery.chain_id === undefined || urlquery.chain_id === '') {
        return defaultMainnet ? MAIN_CHAIN_ID : nil
    }
    return parseInt(urlquery.chain_id) || 0
}
, ensureWalletOnRequestedChain = async defaultMainnet => {
    let reqid = requestChainId(defaultMainnet)
    if(reqid === nil) {
        return nil
    }
    let cur = await stoReadCurrentChain()
    , curid = chainIdOf(cur)
    if(reqid !== curid) {
        return {
            err: `Network mismatch: current ${chainTip(cur)}, requested #${reqid}. Switch networks first.`,
            current_chain_id: curid,
            request_chain_id: reqid,
        }
    }
    return nil
}
, assertUrlRequestChain = ensureWalletOnRequestedChain
, makeChainAllowAction = id => ({kind: CHAIN_ALLOW_KIND, chains: [parseInt(id || 0) || 0]})
, findChainAllowAction = actions => {
    actions = actions || []
    for(let i in actions) {
        if(parseInt(actions[i].kind) === CHAIN_ALLOW_KIND) {
            return actions[i]
        }
    }
    return nil
}
, actionAllowsChain = (act, id) => {
    if(!act) return no
    id = parseInt(id || 0) || 0
    let cs = act.chains || []
    for(let i in cs) {
        if((parseInt(cs[i]) || 0) === id) {
            return yes
        }
    }
    return no
}
, attachCurrentChainAllowAction = async txobj => {
    txobj = txobj || {}
    txobj.actions = txobj.actions || []
    let cur = await stoReadCurrentChain()
    , cid = chainIdOf(cur)
    , ca = findChainAllowAction(txobj.actions)
    if(isMainChainId(cid)) {
        if(ca) {
            return {err: 'Mainnet tx cannot include ChainAllow action'}
        }
        return txobj
    }
    if(ca) {
        if(!actionAllowsChain(ca, cid)) {
            return {err: `ChainAllow action does not match ${chainTip(cur)}`}
        }
        return txobj
    }
    txobj.actions.unshift(makeChainAllowAction(cid))
    return txobj
}
, applyCurrentChainToTxobj = attachCurrentChainAllowAction
, ensureTxAllowedOnCurrentChain = async (txres, defaultMainnet) => {
    let reqerr = await ensureWalletOnRequestedChain(defaultMainnet)
    if(reqerr) return reqerr
    let cur = await stoReadCurrentChain()
    , cid = chainIdOf(cur)
    , acts = txres.actions || []
    , ca = findChainAllowAction(acts)
    if(isMainChainId(cid)) {
        if(ca) {
            return {err: 'Mainnet tx contains ChainAllow action'}
        }
        return nil
    }
    if(!ca) {
        return {err: `Current ${chainTip(cur)} requires ChainAllow action`}
    }
    if(!actionAllowsChain(ca, cid)) {
        return {err: `ChainAllow does not include current ${chainTip(cur)}`}
    }
    return nil
}
, assertCheckedBodyChain = ensureTxAllowedOnCurrentChain
;
