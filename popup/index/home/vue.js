var refreshHomeTrsLog = nil
, homeTrsDatas = nil
, homePageAppPtr = nil
, homePageCtxPtr = nil
, routePageMain = (adr, clbk) => {

    if(homePageAppPtr) {
        homePageAppPtr.unmount()
        homePageAppPtr = nil
        homePageCtxPtr = nil
    }
    // alert(adr)

    let {app, ctx} = VueCreateApp('home', vue_tpl_home, {
        icfp: icfpath,
        lgtip: '',
        chain: nil,
        chaintip: '',
        addr: '',
        sadr: '',
        /* header */
        optmenu: no,
        adrswct: no,
        adrmaps: {},
        /* home */
        blsctx: ['HAC', 'HACD'],
        blsobj: nil, // {HAC, HACD, BTC, SAT}
        activeTab: 'assets', // assets | activity | collection (display initial; appendix.3-9)
        /* assets */
        assets: nil, // null=loading, []=empty
        assetsError: '',
        assetsLoaded: no,
        /* trslog actvlgs collect */
        trslgs: nil,
        actvlgs: nil,
        dialis: nil,
        /*  */
        clcted: no,
        /* rpc settings */
        rpcset: no,
        rpcuri: '',
        rpctip: fullnode_url, // build-time default node (placeholder)
        /* in-wallet Connected indicator (B Phase 3 revised): {origin, host} of
        the ACTIVE browser tab's site when connected, nil hides the bar */
        connsite: nil,
    },{
        dotrs() {
            routePageDotrs(null, ()=>{
                pushhpgw('dotrs')
            })
        }
        ,sendAsset(a) {
            if(!a || !a.metadata){
                return
            }
            routePageDotrs({
                type: 'ASSET',
                asset: {
                    serial: a.serial,
                    atoms: a.atoms,
                    decimal: a.decimal,
                    name: a.name,
                    ticket: a.ticket,
                    // the dotrs transfer page treats asset.metadata as the "metadata available" test (decimal comes
                    // from on-chain asset_meta); it must travel with the object or every amount reports Asset metadata unavailable.
                    metadata: a.metadata,
                }
            }, ()=>{
                pushhpgw('dotrs')
            })
        }
        ,txicon(v) {
            return this.icfp + mnx_tx_log_icon_file(v && v.type)
        }
        ,assetLogHead(v) {
            try {
                let unit = (v && (v.assetTicket || v.assetName)) || (v && v.assetSerial ? ('Asset #' + v.assetSerial) : 'Asset')
                let amt
                if(!v || v.assetDecimal == null || v.assetDecimal === ''){
                    amt = (v && v.assetAtoms) || ''
                }else{
                    amt = formatAssetAtoms(v.assetAtoms, v.assetDecimal)
                }
                if(amt){ return amt + ' ' + unit }
                return (v && v.asset) || unit
            } catch(e) {
                return (v && v.asset) || 'Asset'
            }
        }
        ,async swttab(x) {
            let t = this
            t.activeTab = x
            // load HACD names
            if(!t.clcted && x=='collection') {
                t.clcted = yes
                let res = await do_fetch_get(await mnx_get_fullnode_url()+'/query/balance?diamonds=true&address='+t.addr)
                , dias = (res && res.list && res.list[0] && res.list[0].diamonds) || ""
                , dn = dias.length
                , ds = []
                if(dn>=6) {
                    for(let i=0;i<dn;i+=6) {
                        let d = dias.slice(i, i+6);
                        ds.push(d)
                    }
                }
                t.dialis = ds
            }

        }
        ,async openadrswct() {
            let t = this
            t.adrmaps = await stoReadAccount()
            t.adrswct = yes
        }
        ,async swtcuraddr(adr) {
            let t = this
            t.addr = adr
            t.sadr = addrOmitted(adr)
            t.activeTab = 'assets' // reset to the default tab (2026-10-05)
            t.clcted = no // refresh
            t.dialis = nil
            t.assets = nil
            t.assetsError = ''
            t.assetsLoaded = no
            t.blsobj = nil
            t.adrswct = no
            await stoSaveCurrentAccount(adr)
            await t.ldbls() // load balance
            await refreshHomeTrsLog()
        }
        ,async dolock() {
            let t = this
            await stoDoLock()
            await loginSwitchToInit()
            app.unmount()
        }
        ,async doexit() {
            let ok = await wpass_open()
            if(!ok) {
                return
            }
            ok = await wpcfm_open(`Resetting your wallet will erase all transaction history, private keys, and passwords. Ensure you have backups for all account private keys, as failing to do so will result in permanent loss of all your assets`, 
            'I Acknowledge the Risk', 
            'red')
            if(!ok) {
                return
            }
            let rskcf = prompt ("Please type 'I ACKNOWLEDGE THE RISK' in the box below and click Confirm to delete all data, including private keys.", '')
            if(!rskcf){
                return // prompt canceled (null): the user backed out, touch nothing
            }
            if('IACKNOWLEDGETHERISK'!=rskcf.replace(/\s+/ig, '')){
                return
            }
            await chrome_storage_sync.clear()
            await chrome_storage_local.clear()
            await chrome_storage_session.clear()
            app.unmount()
            await loginSwitchToInit()
        }
        ,async donewacc(){
            let force = yes
            await loginSwitchToInit(force)     
            app.unmount()       
        }
        ,cpadr(){
            copyShowTip(this.addr)
        }
        ,chainName(){
            let t = this
            return (t.chain && t.chain.name) || 'Mainnet'
        }
        ,chainRemark(){
            return (this.chain && this.chain.remark) || ''
        }
        ,chainRpc(){
            return ((this.chain && this.chain.rpc) || '').replace(/^https?:\/\//i, '')
        }
        // Networks management page (the chains/chainform components ship with the moneynex page)
        , opchains(){
            routePageChains(()=>{
                pushhpgw('chains')
            })
        }
        // Connected sites management (A3, appendix.3-2/3-4): in-page hpgw view
        // (same connlists component the standalone popup/connectedsites.html uses),
        // listing connect_sites grants with per-site disconnect.
        , opconnlists(){
            routePageConnlists(this.addr, ()=>{
                pushhpgw('cnls')
            })
        }
        // exit button on the Connected indicator: revoke through the background
        // (sender-validated, with the legacy bare-host key fallback); the
        // resulting connect_sites write fires the SDK 'disconnect' push to the
        // site's frames, and the storage watcher re-queries this bar away. No
        // local teardown — the background stays the single source of truth.
        ,async dissite() {
            let t = this
            if(!t.connsite){ return }
            try{
                await chrome_runtime_sendmessage({ action: 'mnx_site_disconnect_origin', origin: t.connsite.origin })
            }catch(e){}
        }
        // load balance (HAC/HACD and Assets are applied independently)
        ,async ldbls() {
            let t = this
            let addr = t.addr
            let res = await do_fetch_get(await mnx_get_fullnode_url()+'/query/balance?unit=mei&assets=true&asset_meta=true&address='+addr)
            if(t.addr !== addr){
                return
            }
            let row = res && res.list && res.list[0]
            if(!row){
                t.assetsError = (res && (res.err || res.error)) || 'Failed to load assets'
                if(t.assets == null){
                    t.assets = []
                }
                t.assetsLoaded = yes
                return
            }
            t.blsobj = {HAC: row.hacash, HACD: row.diamond, SAT: row.satoshi}
            let ast = mnx_normalize_asset_list(row.assets)
            if(ast.err){
                t.assetsError = ast.err
                if(t.assets == null){
                    t.assets = []
                }
            }else{
                t.assetsError = ''
                t.assets = ast.list
                // the same asset metadata cache serves the signing/review pages (decimal/name/ticket are immutable)
                mnx_asset_meta_put_list(ast.list).catch(()=>{})
            }
            t.assetsLoaded = yes
        }
        ,async retryAssets() {
            let t = this
            t.assets = nil
            t.assetsError = ''
            t.assetsLoaded = no
            await t.ldbls()
        }
        // View HACD in Explorer
        ,vwdiaexpl(){
            let t = this
            , dias = t.dialis.join(',')
            t.opurl(explorer_url+'/diamond-views?name='+dias)
        }
        ,cpdianms(){
            copyShowTip(this.dialis.join(','))
        }
        // view address in exporer
        ,vmadrexpl(){
            let t = this
            t.opurl(explorer_url+'/address/'+t.addr)
        }
        ,opintab(){
            this.opurl('popup/moneynex.html')
        }
        , opacinf(){
            let t = this
            routePageAcinf(t.addr, ()=>{
                pushhpgw('acinf')
            })
        }
        , optx(tx) {
            this.opurl(explorer_url+'/tx/'+tx)
        }
        , cpbody(body) {
            copyShowTip(body)
        }
        ,opurl(url){
            chrome_tabs_create({url:url})
        }
        ,dospt(){
            this.opurl('https://t.me/HacashCom/61435')
        }
        // RPC node settings (runtime override of build-time default; query/broadcast only, signing hash still computed locally)
        ,async oprpcset(){
            let t = this
            // show the EFFECTIVE address (override > selected network's RPC >
            // build-time default), not just the raw override — otherwise the box
            // looks empty / shows a stale placeholder hint while a node is in use
            t.rpcuri = (await mnx_get_fullnode_url()) || ''
            t.rpcset = yes
        }
        ,async rpcsave(dflt) {
            let t = this
            if(!dflt){
                let uri = (t.rpcuri||'').trim()
                if(uri && !/^https?:\/\//i.test(uri)){
                    return showWPtip('RPC URL must start with http:// or https://')
                }
                await stoSaveRpcUrl(uri)
                showWPtip(uri ? 'RPC node saved' : 'RPC node reset to default')
            }else{
                await stoSaveRpcUrl('')
                t.rpcuri = ''
                showWPtip('RPC node reset to default')
            }
            t.rpcset = no
            t.ldbls() // refresh balance immediately with the new node
        }

        , async updtxsts(updtrs) {
            if(!updtrs.length) {
                return
            }
            // concurrent queries (waiting on each one would slow linearly with the pending count),
            // network-level failures (do_fetch_get returns {ret:1,err}) must be skipped:
            // one network hiccup must never be read as "not found on chain" and permanently marked failed.
            let curid = 0
            try {
                if(typeof getCurrentChain === 'function'){
                    curid = (parseInt((await getCurrentChain()).id || 0) || 0)
                }
            } catch(e) {}
            let results = await Promise.all(updtrs.map(async (li) => {
                // transactions on other chains are not queried on this chain's node: keep their status
                if(curid && (parseInt(li.chain_id || 0) || 0) !== curid){
                    return { hash: li.hash, res: { skipped: true } }
                }
                let res = await do_fetch_get(await mnx_get_fullnode_url()+'/query/transaction?hash='+li.hash) || {}
                return { hash: li.hash, res: res }
            }))
            let updtsome = no
            , sts = {} // hash -> new status, merged by hash afterwards
            ;
            for(let i in results){
                let { hash, res } = results[i]
                if(res.err || res.ret){
                    continue // the query itself failed: skip this round, status stays pending (failed items can be refreshed manually)
                }
                if(parseInt(res.confirm) >= 0){
                    sts[hash] = 1 // ok
                    updtsome = yes
                }else if( ! res.pending) {
                    sts[hash] = 2 // not find, fail
                    updtsome = yes
                }
            }
            // sync the in-memory display objects (updtrs items share references with t.trslgs) for immediate UI feedback
            for(let i in updtrs){
                let st = sts[updtrs[i].hash]
                if(st != nil) {
                    updtrs[i].stat = st
                }
            }
            if(updtsome) {
                // re-read storage before writing back and merge by hash only: the transfer page (dotrs) may have just inserted records,
                // and writing the whole stale in-memory homeTrsDatas array back would overwrite them (read-modify-write race).
                let logs = await readTransactionLogs()
                for(let i in logs){
                    let st = sts[logs[i].hash]
                    if(st != nil) {
                        logs[i].stat = st
                    }
                }
                await updateTransactionLogs(logs)
                homeTrsDatas = logs
            }
        }
        // manually refresh a transaction marked failed (the refresh icon next to Failed in the activity list):
        // query once and update the status faithfully — mined becomes success, back in the mempool becomes pending (auto-refresh takes over),
        // still missing stays failed and can be refreshed again; network errors only notify and never touch status.
        , async refreshtx(li) {
            if(li.rfig){
                return
            }
            li.rfig = yes
            try {
                let res = await do_fetch_get(await mnx_get_fullnode_url()+'/query/transaction?hash='+li.hash) || {}
                if(res.err || res.ret){
                    showWPerr('Refresh failed: ' + (res.err || 'network error'))
                    return
                }
                let st = parseInt(res.confirm) >= 0 ? 1 : (res.pending ? 0 : 2)
                li.stat = st
                // re-read storage before writing back, merge by hash only (same race protection as updtxsts)
                let logs = await readTransactionLogs()
                for(let i in logs){
                    if(logs[i].hash == li.hash){ logs[i].stat = st }
                }
                await updateTransactionLogs(logs)
                homeTrsDatas = logs
            } finally {
                li.rfig = no
            }
        }
        // update balance and trs log
        , async refreshAll() {
            let t = this
            await mnx_load_chaintip(t)
            t.blsobj = nil
            await refreshHomeTrsLog()
            // load balance
            await t.ldbls()
        }

    }, async (t) => {
        connbarBind() // in-wallet Connected indicator: follow the active browser tab
        t.addr = adr
        t.sadr = addrOmitted(adr)
        await mnx_load_chaintip(t)
        clbk && clbk()
        // load transaction
        await t.swttab('assets') // display initial tab (appendix.3-9); tx log still loads via refreshAll
        // refresh trs log
        refreshHomeTrsLog = async (reload) => {
            await rfhtl(t, reload)
        }
        await t.refreshAll()

    })

    homePageAppPtr = app
    homePageCtxPtr = ctx

    async function rfhtl(t, reload) {
        if(reload) {
            t.activeTab = 'activity' // switch to trs log card
        }
        // re-read storage every time: the transfer page (dotrs) may have just written new records,
        // reusing the stale in-memory array would let a later whole-array write overwrite them (W52).
        homeTrsDatas = await readTransactionLogs()
        let curtrs = []
        let updtrs = []
        for(var i in homeTrsDatas) {
            let one = homeTrsDatas[i]
            if(one.from == t.addr){
                curtrs.push(one)
            }
            if(one.stat == 0){
                updtrs.push(one)
            }
        } 
        t.trslgs = curtrs;
        // return
        // update status
        await t.updtxsts(updtrs)
    }   


}

// ============================================================================
// B (Phase 3, revised): in-wallet "Connected" indicator. The side panel stays
// open while the user browses, so the WALLET itself follows the ACTIVE
// browser tab (MetaMask's pattern) and shows its site when connected:
//   tabs.onActivated → follow the newly active tab (real-time on switching)
//   tabs.onUpdated   → navigation on the followed tab: drop the stale
//                      registry entry + hide, re-query once the load completes
//   storage.onChanged(mnx_connect_tabs / connect_sites) → re-query
// The origin never comes from tab.url ('tabs' permission stays out of the
// manifest) — the background maps tabId→origin from content-script
// registrations (sender-derived).
// Listeners bind ONCE per page at module level: the home view unmounts when
// entering sub-views (connlists etc.) and remounts on return; while home is
// not mounted homePageCtxPtr is nil and every handler no-ops.
// ============================================================================
var connbarTabId = 0
, connbarBound = no

function connbarApply(res) {
    let t = homePageCtxPtr
    if(!t){ return }
    t.connsite = (res && res.connected && res.host)
        ? { origin: res.origin, host: res.host }
        : nil
}

async function connbarQuery() {
    if(!connbarTabId){ return }
    let res = nil
    try{
        res = await chrome_runtime_sendmessage({ action: 'mnx_current_site', tabid: connbarTabId })
    }catch(e){}
    connbarApply(res)
}

function connbarFollow(tabid) {
    connbarTabId = tabid || 0
    connbarQuery()
}

async function connbarBind() {
    // initial follow: the window the panel is attached to ('currentWindow'
    // from an extension page = its own window); onActivated keeps it live
    try{
        let tabs = await chrome_tabs_query({ active: yes, currentWindow: yes })
        if(tabs && tabs.length){ connbarFollow(tabs[0].id) }
    }catch(e){}
    if(connbarBound){ return }
    connbarBound = yes
    chrome_tabs_onActivated.addListener((info) => {
        connbarFollow(info && info.tabId)
    })
    // 被跟随的标签被关闭（用户关掉 dapp 标签；或 connect 授权窗开/关期间焦点
    // 短暂落在它的窗口上）：跟随目标已死，重新跟随当前聚焦窗口的活跃标签 ——
    // 否则指示条停在旧目标上，直到用户下一次切换标签才恢复
    chrome.tabs.onRemoved.addListener((tabid) => {
        if(tabid != connbarTabId){ return }
        chrome_tabs_query({ active: yes, lastFocusedWindow: yes }).then((tabs) => {
            connbarFollow(tabs && tabs.length ? tabs[0].id : 0)
        }).catch(()=>{})
    })
    chrome.windows.onFocusChanged.addListener((wid) => {
        // tab switches inside a window fire onActivated; switching WINDOWS
        // doesn't (that tab never re-activates) — follow the focused window's
        // active tab so the indicator always names the site the user sees
        if(wid == chrome.windows.WINDOW_ID_NONE){ return }
        chrome_tabs_query({ active: yes, lastFocusedWindow: yes }).then((tabs) => {
            if(tabs && tabs.length){ connbarFollow(tabs[0].id) }
        }).catch(()=>{})
    })
    chrome_tabs_onUpdated.addListener((tabid, ci) => {
        if(tabid != connbarTabId){ return }
        if(ci && ci.status == 'loading'){
            // navigation started on the followed tab: the page that registered
            // the old origin is going away — drop its entry (else the bar
            // would light up for the PREVIOUS site while the new page loads)
            // and hide until the new page re-registers (document_idle)
            connbarApply(nil)
            chrome_runtime_sendmessage({ action: 'mnx_tab_invalidate', tabid: tabid }).catch(()=>{})
        }else if(ci && ci.status == 'complete'){
            // re-query after the new page's registration has landed (a
            // same-origin reload writes an identical registry entry, so no
            // storage.onChanged fires — this is the deterministic fallback)
            _setTimeout(connbarQuery, 400)
        }
    })
    chrome_storage.onChanged.addListener((ch, area) => {
        if((area == 'session' && ch['mnx_connect_tabs'])
        || (area == 'local' && ch['connect_sites'])){
            connbarQuery()
        }
    })
}


// update balance and trs log
_setInterval(async ()=>{
    if(homePageCtxPtr){
        await homePageCtxPtr.refreshAll()
    }
}, minutes*5);
