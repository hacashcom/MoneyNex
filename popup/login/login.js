
var MAIN_CHAIN_ID = 0
, CHAIN_ALLOW_KIND = 0x0411
, mainnet_explorer_url = 'https://explorer.hacash.org'
, mainnet_fullnode_url = 'http://wallet.hacash.com/fullnode'
, explorer_url = mainnet_explorer_url
, fullnode_url = mainnet_fullnode_url
;

// local test
// explorer_url = 'http://127.0.0.1:8002'
// fullnode_url = 'http://127.0.0.1:8009/fullnode'
// fullnode_url = 'http://127.0.0.1:18081'

// test end

var randomString = ctime(yes)+''
, recordRandomString = s=>{
    randomString += s
    // console.log(randomString)
    // console.log(s)
    if(randomString.length > 1024) {
        randomString = SHA256(randomString)
        // console.log("SHA256", randomString)
    }
    return randomString
}
, acccurkey = 'current_account'
, accstokey = 'accounts'
, accpasswd = 'password'
, accpsskey = 'crptpskey'
, randomkey = 'randomkey'
, salthcxwlt = 'salthcxwlt'
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
, stoSavePassword = async (passwd) => {
    let pmd5 = MD5(passwd)
    , psk = MD5(passwd+salthcxwlt)
    , sv = {}
    // read
    , spsk = await stoReadPasskey()
    if(spsk && spsk!=psk) {
        return nil // password error
    }
    if(!spsk){
        await stoSavePasskey(passwd) // save
    }
    sv[accpasswd] = {
        md5: pmd5,
        time: ctime(),
    }
    await chrome_storage_session.set(sv)
    return pmd5
}
, stoReadPassword = async (ex) => {
    let ps = await chrome_storage_session.get(accpasswd)
    , tar = ps[accpasswd] || {}
    return ex ? tar : tar.md5
}
, stoDoLock = async () => {
    await chrome_storage_session.remove(accpasswd)
}
, stoSavePasskey = async (passwd) => {
    let pmd5 = MD5(passwd+salthcxwlt)
    , sv = {}
    sv[accpsskey] = pmd5
    await chrome_storage_sync.set(sv)
    return pmd5
}
, stoReadPasskey = async () => {
    let ps = await chrome_storage_sync.get(accpsskey)
    return ps[accpsskey]
}
, stoSaveAccount = async (acc, passwd) => {
    // await chrome_storage_sync.clear()
    let pmd5
    if(passwd) {
        pmd5 = await stoSavePassword(passwd)
    }else{
        pmd5 = await stoReadPassword()
    }
    let accs = await chrome_storage_sync.get(accstokey)
    accs = accs[accstokey] || {}
    accs[acc.address] = {
        cryptkey: AES_encrypt(acc.private_key, pmd5)
    }
    let sv = {}
    sv[accstokey] = accs
    await chrome_storage_sync.set(sv)
    // console.log(sv)
}
, stoReadAccount = async (addr) => {
    let ary = await chrome_storage_sync.get(accstokey)
    , tar = ary[accstokey] || {}
    return addr ? tar[addr] : tar
}
, stoSaveCurrentAccount = async (addr) => {
    let sv = {}
    sv[acccurkey] = addr
    await chrome_storage_sync.set(sv)
}
, stoReadCurrentAccount = async () => {
    let obj = await chrome_storage_sync.get(acccurkey)
    return obj[acccurkey]
}
, stoRemoveCurrentAccount = async () => {
    let cur = await stoReadCurrentAccount()
    let accs = await stoReadAccount()
    if(!accs[cur]){
        return no // not find
    }
    let next = nil
    for(let k in accs){
        if(k!=cur){
            next = k
            break
        }
    }
    if(!next){
        return no
    }
    // remove and set current
    delete accs[cur]
    let sv = {}
    sv[accstokey] = accs
    await chrome_storage_sync.set(sv)
    await stoSaveCurrentAccount(next)
    return next // remove success
}
, stoUnlockAccount = async (accsv) => {
    let pmd5 = await stoReadPassword()
    if(!pmd5){
        return nil
    }
    if(!accsv) {
        let adr = await stoReadCurrentAccount()
        accsv = await stoReadAccount(adr)
    }
    return AES_decrypt(accsv.cryptkey, pmd5)
}
, stoSaveRandomKey = async (stuff) => {
    // console.log('stoSaveRandomKey: ', stuff)
    let sv = {}
    , kk = SHA256(stuff)
    sv[randomkey] = kk
    await chrome_storage_local.set(sv)
    return kk
}
, stoReadRandomKey = async () => {
    let obj = await chrome_storage_local.get(randomkey)
    , tar = obj[randomkey]
    return tar
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
        builtin: !!cfg.builtin || id === MAIN_CHAIN_ID,
    }
}
, chainIdOf = cfg => parseInt((cfg||{}).id || cfg || 0) || 0
, stoReadChainConfigs = async () => {
    let obj = await chrome_storage_local.get(chain_configs_key)
    , cfgs = obj[chain_configs_key] || {}
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
        let sv = {}
        sv[chain_configs_key] = cfgs
        await chrome_storage_local.set(sv)
    }
    return cfgs
}
, stoSaveChainConfigs = async cfgs => {
    cfgs = cfgs || {}
    cfgs[MAIN_CHAIN_ID] = chainNormalize(Object.assign({}, default_chain_configs[MAIN_CHAIN_ID], cfgs[MAIN_CHAIN_ID] || {}))
    let sv = {}
    sv[chain_configs_key] = cfgs
    await chrome_storage_local.set(sv)
    return cfgs
}
, stoSaveCurrentChainId = async id => {
    id = parseInt(id || 0) || 0
    let sv = {}
    sv[current_chain_id_key] = id
    await chrome_storage_local.set(sv)
    return await stoReadCurrentChain()
}
, stoReadCurrentChain = async () => {
    let cfgs = await stoReadChainConfigs()
    , obj = await chrome_storage_local.get(current_chain_id_key)
    , id = parseInt(obj[current_chain_id_key] || 0) || 0
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
    if(!id) {
        return chainName(cfg)
    }
    let name = chainName(cfg)
    , idtip = name == `Chain ID ${id}` ? '' : ` | ID ${id}`
    return `${name}${idtip}${cfg.remark ? ' | '+cfg.remark : ''}`
}
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
    if(id === MAIN_CHAIN_ID) {
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
, assertUrlRequestChain = async defaultMainnet => {
    let reqid = requestChainId(defaultMainnet)
    if(reqid === nil) {
        return nil
    }
    let cur = await stoReadCurrentChain()
    , curid = chainIdOf(cur)
    if(reqid !== curid) {
        return {
            err: `Wallet chain mismatch: current ${chainTip(cur)}, request chain #${reqid}. Please switch chain manually first.`,
            current_chain_id: curid,
            request_chain_id: reqid,
        }
    }
    return nil
}
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
, applyCurrentChainToTxobj = async txobj => {
    txobj = txobj || {}
    txobj.actions = txobj.actions || []
    let cur = await stoReadCurrentChain()
    , cid = chainIdOf(cur)
    , ca = findChainAllowAction(txobj.actions)
    if(cid === MAIN_CHAIN_ID) {
        if(ca) {
            return {err: 'Mainnet transaction must not include ChainAllow action'}
        }
        return txobj
    }
    if(ca) {
        if(!actionAllowsChain(ca, cid)) {
            return {err: `ChainAllow action does not match current ${chainTip(cur)}`}
        }
        return txobj
    }
    txobj.actions.unshift(makeChainAllowAction(cid))
    return txobj
}
, assertCheckedBodyChain = async (txres, defaultMainnet) => {
    let reqerr = await assertUrlRequestChain(defaultMainnet)
    if(reqerr) return reqerr
    let cur = await stoReadCurrentChain()
    , cid = chainIdOf(cur)
    , acts = txres.actions || []
    , ca = findChainAllowAction(acts)
    if(cid === MAIN_CHAIN_ID) {
        if(ca) {
            return {err: 'Current chain is Mainnet, but transaction contains ChainAllow action'}
        }
        return nil
    }
    if(!ca) {
        return {err: `Current ${chainTip(cur)} requires ChainAllow action in the transaction`}
    }
    if(!actionAllowsChain(ca, cid)) {
        return {err: `Transaction ChainAllow does not include current ${chainTip(cur)}`}
    }
    return nil
}
, stoCurAccDoSign = async msg => {
    let privkey = await stoUnlockAccount()
    if(!privkey) {
        return {err:'Account unlocking failed'} // error
    }
    let res = hacash_api.sign(privkey, msg)
    try{
        let obj = JSON_parse(res)
        return obj
    }catch(e){
        return {err: res} // err
    }
}
;


var getAmtTip = (obj) => {
    let dc = obj.diamond_count
    , ds = obj.diamonds
    , amt = obj.amount
    if(dc > 0) {
        let dns = dc > 2 ? `${ds.substring(0,13)}...` : ds
        return `${dc} HACD (${dns})`
    }
    if(amt.indexOf('SAT')>0){
        return amt
    }
    // hac
    return hac_show_mei_unit(amt)
}
, trslogkey = 'trslogs'
, readTransactionLogs = async () => {
    let logs = await chrome_storage_local.get(trslogkey)
    ;
    logs = logs ? logs[trslogkey] : []
    return logs || []
}
, updateTransactionLogs = async (logs) => {
    let sv = {}
    sv[trslogkey] = logs
    await chrome_storage_local.set(sv)
}
, saveTransactionLog = async (tx) => {
    console.log('saveTransactionLog', tx)
    let chain = await stoReadCurrentChain()
    let type = 'MUL'
    , svdata = {
        from: tx.payment_address,
        time: tx.timestamp,
        hash: tx.tx_hash,
        body: tx.tx_body,
        desc: tx.desc || tx.diamonds || '',
        chain_id: chainIdOf(chain),
        chain_name: chain.name,
        chain_remark: chain.remark,
        rpc: chain.rpc,
        stat: 0, // 0:pendding  1:ok  2:fail  
    }
    if(tx.collection_address){
        let ast = getAmtTip(tx)
        svdata.to = tx.collection_address
        svdata.asset = ast
        let t1 = 'HAC'
        , t2 = 'HACD'
        , t3 = 'SAT'
        ;
        if(ast.indexOf(t1)>0){
            type = t1
        }else if(ast.indexOf(t2)>0){
            type = t2
        }else if(ast.indexOf(t3)>0){
            type = t3
        }
    }else{
        // MUL
    }
    svdata.type = type;
    // do save
    let logs = await readTransactionLogs()
    logs.unshift(svdata)
    if(logs.length>500) {
        logs.pop() // max 200
    }
    let sv = {}
    sv[trslogkey] = logs
    await chrome_storage_local.set(sv)
    // ok
}

/////////

, addrOmitted = a => a.substring(0, 9)+'...'+a.slice(-8)           

/////////

, stokey_connect_domains = 'connect_domains'
, stoAppendConnectDomains = async dmu => {
    dmu = dmu || 'hacash.com'
    let dms = await chrome_storage_local.get(stokey_connect_domains)
    dms = dms[stokey_connect_domains] || []
    if (dms.indexOf(dmu) == -1) {
        dms.unshift(dmu)
        let sto = {}
        sto[stokey_connect_domains] = dms
        await chrome_storage_local.set(sto)
    }
    return dms
}
, stoGetConnectDomains = stoAppendConnectDomains

/////////

, reqFeasibleFee = async (txsz) => {
    let url = fullnode_url+"/query/fee/average?unit=mei"
    if(txsz > 0){
        url += `&consumption=${txsz}`
    }
    return do_fetch_get(url)
}
, jsdttyhdr = {
    "Content-Type": "application/json"
}
, proxyFullnodeApiPost = (path, bodydata, params) => {
    let url = fullnode_url+path+"?";
    params = params || {}
    for(let k in params){
        url += `${k}=${params[k]}&`
    }
    return do_fetch_post(url, bodydata, jsdttyhdr)
}
, queryTransaction = async (txhash) => {
    let url = fullnode_url+"/query/transaction?unit=mei&body=true&&hash=" + txhash
    return do_fetch_get(url)
}
, submitTransaction = async (txbody) => {
    return proxyFullnodeApiPost(
        "/submit/transaction", hexToBytes(txbody)
    )
}
, createTransaction = async (txjson) => {
    return proxyFullnodeApiPost(
        "/create/transaction", JSON_stringify(txjson), {unit: 'mei', action: true, description: true, signature: true}
    )
}
, checkTransaction = async (txbody, params) => {
    return proxyFullnodeApiPost(
        "/util/transaction/check", hexToBytes(txbody), params
    )
}

, signTransaction = async (txbody, params) => {
    return proxyFullnodeApiPost(
        "/util/transaction/sign", hexToBytes(txbody), params
    )
}

, parseTxDesc = tx => {
    let txdesc = []
    if(!tx || !tx.description){
        return []
    }
    // parse 1[a-km-zA-HJ-NP-Z0-9]{26,33}
    let parse = (i, v) => {
        let li = v.replace(/(\s[0-9\.]+)HAC\s/g, ` <b class="amt">$1</b> HAC `)
            .replace(/([a-km-zA-HJ-NP-Z1-9]{28,34})/g, ` <a class="addr" href="${explorer_url}/address/$1" target="_blank" title="$1">$1</a> `)
        return `<span>${1+i}</span> ${li}`
    }
    txdesc.push(parse(0, tx.description)) // main addr

    for(let i in tx.actions){
        let li = tx.actions[i]
        txdesc.push(parse(parseInt(i)+1, li.description))
    }
    return txdesc
}

;




/////////



var cti = ctime(yes)
, btlgboot = $id('boot')
, btlginit = $id('init')
, btlglogok = $id('logok')
, loginSwitchCloseAll  = ()=>{
    let ct = ctime(yes)
    , bcl = btlgboot.classList
    , rct = 0 - (ct - cti)
    rct = rct<0 ? 0 : rct
    // console.log("rct ", rct)
    _setTimeout(()=>{
        bcl.add(clsname_hide)
    }, rct)
} 
, loginSwitchToInit = async (force)=>{
    await stoReadCurrentChain()
    await routePageInit(loginSwitchCloseAll, force)
    // vue
    $display_block(btlginit)
}





// load show
_setTimeout(loginSwitchToInit, 10);
