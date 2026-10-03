var explorer_url = 'https://explorer.hacash.org'
, fullnode_url = 'http://wallet.hacash.com/fullnode'
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

// All Actions 全览页打开方式：内容量大（多 action / json / raw），优先开一个独立的整屏窗口，
// 而不是挤在扩展弹窗尺寸里。无窗口管理器的环境（CI/沙箱）不会响应 state:'maximized'，
// 所以显式按屏幕可用尺寸建窗，再补一次 maximize；都不行才降级为普通标签页。
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
    return await accMutate(() => mnx_save_password_locked(passwd))
}
// Internal helper: callers must already hold the account-storage lock.
, mnx_save_password_locked = async (passwd) => {
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
// Serialize account-table mutations and selection across extension pages.
// Other devices and writers that do not acquire this lock remain outside it.
, ACC_MUTATE_RETRY = 3
, ACC_MUTATE_WAIT_MS = 5000
, accMutate = async (fn) => {
    // Refuse writes if bounded shared locking is unavailable.
    if(typeof navigator === 'undefined' || !navigator.locks ||
            typeof navigator.locks.request !== 'function' ||
            typeof AbortController !== 'function') { return nil }
    let controller = new AbortController()
    , started = no
    , timer = setTimeout(() => controller.abort(), ACC_MUTATE_WAIT_MS)
    try {
        // Queue directly in Web Locks so same-page waiters also have a deadline.
        return await navigator.locks.request('moneynex-account-storage',
            { signal: controller.signal }, () => {
                started = yes
                clearTimeout(timer)
                // Never time out or release a lock around an unfinished write.
                return fn()
            })
    } catch(error) {
        if(!started && controller.signal.aborted) { return nil }
        throw error
    } finally {
        clearTimeout(timer)
    }
}
, stoSaveAccount = async (acc, passwd) => {
    return await accMutate(async () => {
        // await chrome_storage_sync.clear()
        let pmd5
        if(passwd) {
            pmd5 = await mnx_save_password_locked(passwd)
        }else{
            pmd5 = await stoReadPassword()
        }
        if(!pmd5){
            // 没有可用口令（会话已锁 / 传入口令与既有钱包口令不符）：
            // 绝不把私钥用空口令加密落盘；调用方据返回值中止，current_account 不更新。
            return nil
        }
        let cryptkey = AES_encrypt(acc.private_key, pmd5)
            for(let i = 0; i < ACC_MUTATE_RETRY; i++){
            let accs = await stoReadAccount()
            accs = accs || {}
            // 已存在的账户一律保留原 cryptkey：绝不覆盖、绝不重加密。
            //（同口令下重导入本就得到相同密文；保留原值在并发/异常场景下永远更安全）
            let existed = !!accs[acc.address]
            if(!existed){
                accs[acc.address] = { cryptkey: cryptkey }
            }
            let sv = {}
            sv[accstokey] = accs
            await chrome_storage_sync.set(sv)
            // 写后校验：重读确认目标账户在表中，且 cryptkey 与本次落盘的值一致
            let chk = await stoReadAccount()
            if(chk && chk[acc.address] && chk[acc.address].cryptkey == accs[acc.address].cryptkey){
                return pmd5
            }
        }
        return nil // 重试后仍校验失败：视为未保存，调用方中止
    })
}
, stoReadAccount = async (addr) => {
    let ary = await chrome_storage_sync.get(accstokey)
    , tar = ary[accstokey] || {}
    return addr ? tar[addr] : tar
}
, stoSaveCurrentAccount = async (addr) => {
    return await accMutate(async () => {
        if(typeof addr !== 'string' || !addr || !(await stoReadAccount(addr))) { return nil }
        let sv = {}
        sv[acccurkey] = addr
        await chrome_storage_sync.set(sv)
        return yes
    })
}
, mnx_select_current_account = async (addr) => {
    try {
        if(await stoSaveCurrentAccount(addr)) { return yes }
    } catch(e) {}
    // A rejected storage write can have an uncertain outcome. Do not update
    // the page optimistically or display raw storage errors.
    showWPerr('Account selection failed. Refresh the wallet and try again.')
    return no
}
, stoReadCurrentAccount = async () => {
    let obj = await chrome_storage_sync.get(acccurkey)
    return obj[acccurkey]
}
, stoRemoveAccount = async (addr) => {
    // 按给定地址删除（绝不读可变的 current_account 来决定删谁）：
    // 详情页展示的是打开时的地址，其它窗口可能已把 current 切到别的账户，
    // 按 current 删会删错人。
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
                    return no // 最后一个账户不可删（保留原拒绝语义）
                }
            }
            delete accs[addr]
            let sv = {}
            sv[accstokey] = accs
            if(wascur){
                // 账户表与 current 指针放进同一条 set：删除与其它窗口的换账户/
                // 导入交错时，指针不会指向已删除的地址
                sv[acccurkey] = next
            }
            await chrome_storage_sync.set(sv)
            // 写后校验：地址已删，且（若换了指针）新指针指向的账户仍存在
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
        // 账户记录不存在（current_account 悬空等存储不一致）：统一走"解锁失败"路径，
        // 而不是在这里抛 TypeError 让调用方（按钮/回调）卡死
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
    // 交易发生时的链上下文（Networks 页切换后，活动列表据此区分来源链；
    // chain 服务不在 bundle 时静默跳过）
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
            // 调用方（如 DApp 请求的 action）可能没带 decimal/name/ticket：
            // 用签名页/首页共用的链上元数据缓存补齐，否则 Activity 会显示原始 atoms。
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
