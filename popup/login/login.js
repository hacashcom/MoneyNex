
var explorer_url = 'https://explorer.hacash.org'
, fullnode_url = 'https://wallet.hacash.com/fullnode'
, mnx_chain_id = 0 // Hacash ChainId::MAINNET; test builds override via build.js --chain-id
// Runtime RPC config: chrome.storage.local overrides the build-time default node.
// Used for balance queries and broadcast only; the signing hash is always computed locally from the tx body — the node cannot choose what gets signed.
, rpccfgkey = 'mnx_fullnode_url'
, stoReadRpcUrl = async () => {
    let obj = await chrome_storage_local.get(rpccfgkey)
    let v = (obj[rpccfgkey]||'').trim()
    return v || nil
}
, stoSaveRpcUrl = async (uri) => {
    let sv = {}
    sv[rpccfgkey] = (uri||'').trim()
    await chrome_storage_local.set(sv)
}
, mnx_get_fullnode_url = async () => {
    // Priority: explicit RPC override (mnx_fullnode_url) > selected network's RPC
    // (chain_configs/current_chain_id, managed by the Networks page) > build default.
    let ov = await stoReadRpcUrl()
    if(ov){ return ov }
    try {
        if(typeof stoReadCurrentChain === 'function'){
            let c = await stoReadCurrentChain()
            if(c && c.rpc){ return c.rpc }
        }
    } catch(e) {}
    return fullnode_url
}

// How the All Actions review page opens: its content is large (multi-action / json / raw), so prefer a standalone full window,
// not the extension popup size. Environments without a window manager (CI/sandbox) ignore state:'maximized',
// so create the window at the screen's available size explicitly, then maximize once more; only if all that fails fall back to a plain tab.
, mnx_open_actionview = function(key) {
    let url = `popup/actionview.html?key=${key}`
    try {
        if(typeof chrome != 'undefined' && chrome.windows && chrome.windows.create){
            let sw = (typeof screen != 'undefined' && screen.availWidth) || 1280
            , sh = (typeof screen != 'undefined' && screen.availHeight) || 900
            ;
            chrome.windows.create({ url: url, width: sw, height: sh, left: 0, top: 0, focused: true }, function(win){
                if(chrome.runtime && chrome.runtime.lastError){
                    chrome.tabs.create({ url: url })
                    return
                }
                try{ chrome.windows.update(win.id, { state: 'maximized' }) }catch(e){}
            })
            return
        }
    } catch(e) {}
    chrome.tabs.create({ url: url })
}

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
// Serialize whole-table account mutations. chrome.storage.sync's account table can only be read→modified→written whole,
// and two extension pages (multi-window/multi-tab) writing concurrently clobber each other — the later write wins whole,
// erasing the account the earlier write just imported (account loss). Every account-table change must go through the accMutate queue,
// with post-write re-read verification and retry; external writes bypassing the queue (e.g. sync conflicts) are only caught by that verification.
, ACC_MUTATE_RETRY = 3
, acc_mutate_queue = Promise.resolve()
, accMutate = (fn) => {
    let run = acc_mutate_queue.then(fn)
    // the chain swallows failures to keep the queue going; failures surface to the caller via the returned promise
    acc_mutate_queue = run.then(() => nil, () => nil)
    return run
}
, stoSaveAccount = async (acc, passwd) => {
    // await chrome_storage_sync.clear()
    let pmd5
    if(passwd) {
        pmd5 = await stoSavePassword(passwd)
    }else{
        pmd5 = await stoReadPassword()
    }
    if(!pmd5){
        // no usable passphrase (session locked / the given passphrase does not match the existing wallet):
        // never persist the private key encrypted under an empty passphrase; the caller aborts on the return value and current_account stays untouched.
        return nil
    }
    let cryptkey = AES_encrypt(acc.private_key, pmd5)
    return await accMutate(async () => {
        for(let i = 0; i < ACC_MUTATE_RETRY; i++){
            let accs = await stoReadAccount()
            accs = accs || {}
            // existing accounts always keep their original cryptkey: never overwrite, never re-encrypt.
            // (re-importing under the same passphrase yields the same ciphertext anyway; keeping the original is always safer under concurrency/anomalies)
            let existed = !!accs[acc.address]
            if(!existed){
                accs[acc.address] = { cryptkey: cryptkey }
            }
            let sv = {}
            sv[accstokey] = accs
            await chrome_storage_sync.set(sv)
            // post-write verification: re-read and confirm the target account is in the table with the cryptkey just written
            let chk = await stoReadAccount()
            if(chk && chk[acc.address] && chk[acc.address].cryptkey == accs[acc.address].cryptkey){
                return pmd5
            }
        }
        return nil // verification still failing after retries: treat as unsaved, caller aborts
    })
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
, stoRemoveAccount = async (addr) => {
    // delete by the given address (never read the mutable current_account to decide what to delete):
    // the detail page shows the address it opened with; another window may have switched current already,
    // deleting by current would remove the wrong account.
    return await accMutate(async () => {
        for(let i = 0; i < ACC_MUTATE_RETRY; i++){
            let cur = await stoReadCurrentAccount()
            let accs = await stoReadAccount()
            accs = accs || {}
            if(!addr || !accs[addr]){
                return nil // account not found
            }
            let wascur = (cur == addr)
            let next = nil
            if(wascur){
                for(let k in accs){
                    if(k != addr){ next = k; break }
                }
                if(!next){
                    return no // the last account cannot be deleted (keeps the original refusal semantics)
                }
            }
            delete accs[addr]
            let sv = {}
            sv[accstokey] = accs
            if(wascur){
                // the account table and the current pointer go into one set: if a deletion interleaves with another window's
                // account switch/import, the pointer can never reference a deleted address
                sv[acccurkey] = next
            }
            await chrome_storage_sync.set(sv)
            // post-write verification: the address is gone, and (if the pointer moved) the account it now points to still exists
            let chkaccs = await stoReadAccount()
            let chkcur = await stoReadCurrentAccount()
            if(chkaccs && !chkaccs[addr] && (!wascur || (chkcur && chkaccs[chkcur]))){
                return wascur ? next : cur
            }
        }
        return nil
    })
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
    if(!accsv){
        // the account record is missing (dangling current_account and other storage inconsistencies): take the unified "unlock failed" path,
        // instead of throwing a TypeError here and deadlocking the caller (button/callback)
        return nil
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
, stoLocalRead = async (key, fallback) => {
    let obj = await chrome_storage_local.get(key)
    return obj[key] || fallback
}
, stoLocalSave = async (key, val) => {
    let sv = {}
    sv[key] = val
    await chrome_storage_local.set(sv)
    return val
}
, stoCurAccDoSign = async digesthex => {
    // SDK: digest = SigningRequest.digest (32B hex), pure-JS ECDSA signing
    let privkey = await stoUnlockAccount()
    if(!privkey) {
        return {err:'Account unlocking failed'} // error
    }
    try{
        return {
            pubkey: mnx_privkey_to_pubkey(privkey),
            signature: mnx_sign_digest(digesthex, privkey),
        }
    }catch(e){
        return {err: mnx_err_message(e)} // err
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
    let type = tx.type || 'MUL'
    // the chain context at transaction time (after switching on the Networks page, the activity list tells source chains apart by it;
    // skipped silently when the chain service is not bundled)
    let logchain = nil
    try {
        if(typeof stoReadCurrentChain === 'function'){
            logchain = await stoReadCurrentChain()
        }
    } catch(e) {}
    let svdata = {
        from: tx.payment_address,
        time: tx.timestamp,
        hash: tx.tx_hash,
        body: tx.tx_body,
        desc: tx.desc || tx.diamonds || '',
        chain_id: logchain ? (parseInt(logchain.id || 0) || 0) : 0,
        chain_name: logchain ? logchain.name : '',
        chain_remark: logchain ? (logchain.remark || '') : '',
        stat: 0, // 0:pending  1:ok  2:fail
    }
    if(tx.collection_address){
        svdata.to = tx.collection_address
        if(type == 'ASSET' || (tx.asset && typeof tx.asset === 'object')){
            type = 'ASSET'
            let ast = tx.asset || {}
            let serial = mnx_u64_string(ast.serial)
            let atoms = mnx_u64_string(ast.amount != null ? ast.amount : ast.atoms)
            // the caller (e.g. a DApp request's action) may lack decimal/name/ticket:
            // fill them from the on-chain metadata cache shared by the signing page/home, or Activity would show raw atoms.
            let meta = (ast.decimal == null || ast.decimal === '') ? mnx_asset_meta_get(serial) : null
            let decimal = (ast.decimal == null || ast.decimal === '') ? (meta ? meta.decimal : null) : ast.decimal
            let name = ast.name || (meta && meta.name) || (serial ? ('Asset #' + serial) : 'Asset')
            svdata.assetSerial = serial
            svdata.assetAtoms = atoms
            svdata.assetDecimal = decimal
            svdata.assetName = name
            svdata.assetTicket = ast.ticket || (meta && meta.ticket) || ''
            svdata.asset = mnx_asset_log_amount(atoms, decimal, name)
        }else{
            let ast = getAmtTip(tx)
            svdata.asset = ast
            if(!tx.type){
                // Legacy callers: infer from the display string. New code must pass type.
                if(ast.indexOf('HACD')>0){
                    type = 'HACD'
                }else if(ast.indexOf('SAT')>0){
                    type = 'SAT'
                }else if(ast.indexOf('HAC')>0){
                    type = 'HAC'
                }
            }
        }
    }
    svdata.type = type
    // do save
    let logs = await readTransactionLogs()
    logs.unshift(svdata)
    if(logs.length>500) {
        logs.pop() // max 500
    }
    let sv = {}
    sv[trslogkey] = logs
    await chrome_storage_local.set(sv)
    // ok
}

/////////

, addrOmitted = a => a.substring(0, 9)+'...'+a.slice(-8)

/////////

// A3 connect authorization store. The 0.3.x connect_domains allowlist (bare hosts,
// append-only, no listing/revocation: P0-1) is replaced by connect_sites keyed by
// exact origin:  { "<origin>": { host, connectedAt, accountAtConnect, legacy? } }
// - fresh grants key by origin ("https://example.com[:port]"); the background
//   matcher (background/init.js isConnectAuthorized) compares the request origin
//   exactly, so http/https and ports are distinguished for new grants.
// - 0.3.x records carried bare hosts (no scheme was ever stored): migration keeps
//   them 1:1 keyed by that host and flags them legacy; the background matcher
//   treats a request as authorized when its host equals such a record (same
//   effective matching as 0.3.x for migrated sites).
// - two-phase migration (§9 risk table): phase 1 (this change) reads old on first
//   access and writes new; phase 2 (after the §7.3 upgrade-migration test passes,
//   M2) deletes the legacy key. Until then connect_domains is never written again.
, stokey_connect_domains = 'connect_domains'
, stokey_connect_sites = 'connect_sites'
, connect_mutate_queue = Promise.resolve()
, connectMutate = (fn) => {
    // whole-table mutation queue, same as accMutate: connect_sites can only be read→modified→written whole,
    // and concurrent writers (a management-page disconnect racing a new dApp grant) would let the later write erase the earlier one.
    let run = connect_mutate_queue.then(fn)
    connect_mutate_queue = run.then(() => nil, () => nil)
    return run
}
, stoReadConnectSites = async () => {
    let obj = await chrome_storage_local.get(stokey_connect_sites)
    if(obj && obj[stokey_connect_sites]){
        return obj[stokey_connect_sites]
    }
    // First read after upgrade: migrate the 0.3.x bare-host allowlist once.
    // Read old -> write new; the legacy key is kept until the §7.3 migration
    // test verifies the new store (phase 2, M2). Before that first write the
    // background still authorizes straight from the legacy list.
    let old = await chrome_storage_local.get(stokey_connect_domains)
    old = (old && old[stokey_connect_domains]) || []
    let sites = {}
    for(let i in old){
        let host = (old[i] || '').trim()
        if(!host){ continue }
        sites[host] = {
            host: host,
            connectedAt: ctime(),
            accountAtConnect: nil,
            legacy: yes,
        }
    }
    let sv = {}
    sv[stokey_connect_sites] = sites
    await chrome_storage_local.set(sv)
    return sites
}
// Listing for the connected-sites management page (registered interface, doc/plan.cn.md appendix.3-2):
// array sorted by connectedAt desc — { origin, host, connectedAt, accountAtConnect, legacy }
// (origin = storage key; legacy=true for records migrated from 0.3.x bare hosts).
, stoListConnectSites = async () => {
    let sites = await stoReadConnectSites()
    let list = []
    for(let origin in sites){
        let s = sites[origin] || {}
        list.push({
            origin: origin,
            host: s.host || origin,
            connectedAt: s.connectedAt || 0,
            accountAtConnect: s.accountAtConnect || nil,
            legacy: !!s.legacy,
        })
    }
    list.sort((a, b) => (b.connectedAt || 0) - (a.connectedAt || 0))
    return list
}
// Grant/revoke API for dApp connects and the management page. origin must be a
// full http(s) origin — conn/vue.js validates urlquery.dmu before calling; a bare
// host here is a caller bug and throws (new URL) rather than silently storing a
// match-everything record.
, stoAppendConnectSite = async (origin, accaddr) => {
    let u = new URL(origin)
    return await connectMutate(async () => {
        let sites = await stoReadConnectSites()
        sites[origin] = {
            host: u.host,
            connectedAt: ctime(),
            accountAtConnect: accaddr || nil,
        }
        let sv = {}
        sv[stokey_connect_sites] = sites
        await chrome_storage_local.set(sv)
        return await stoListConnectSites()
    })
}
, stoRemoveConnectSite = async (origin) => {
    return await connectMutate(async () => {
        let sites = await stoReadConnectSites()
        if(!(origin in sites)){
            return nil // unknown site: nothing removed (caller reports)
        }
        delete sites[origin]
        let sv = {}
        sv[stokey_connect_sites] = sites
        await chrome_storage_local.set(sv)
        return await stoListConnectSites()
    })
}

/////////

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
    await routePageInit(loginSwitchCloseAll, force)
    // vue
    $display_block(btlginit)
}





// load show
_setTimeout(loginSwitchToInit, 10);



