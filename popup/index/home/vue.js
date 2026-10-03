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
        activeTab: 'activity', // assets | activity | collection
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
                    // dotrs 转账页以 asset.metadata 作为"元数据可用"判据（decimal 来自链上
                    // asset_meta），这里必须随对象一起传，否则一律报 Asset metadata unavailable。
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
                // console.log(ds)
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
            if(!(await mnx_select_current_account(adr))) { return }
            t.addr = adr
            t.sadr = addrOmitted(adr)
            t.activeTab = 'activity' // reset
            t.clcted = no // refresh
            t.dialis = nil
            t.assets = nil
            t.assetsError = ''
            t.assetsLoaded = no
            t.blsobj = nil
            t.adrswct = no
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
                return // prompt 取消（null）：用户反悔，不动任何数据
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
            copyToClipboard(this.addr)
            showWPtip(copyoktip)
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
        // Networks 管理页（chains/chainform 组件随 moneynex 页构建）
        , opchains(){
            routePageChains(()=>{
                pushhpgw('chains')
            })
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
                // 同一份 asset metadata 缓存供签名页/全览页使用（decimal/name/ticket 不可变）
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
            let dias = this.dialis.join(',')
            copyToClipboard(dias)
            showWPtip(copyoktip)
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
            copyToClipboard(body)
            showWPtip(copyoktip)
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
            t.rpcuri = (await stoReadRpcUrl()) || ''
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
            // console.log(updtrs)
            if(!updtrs.length) {
                return
            }
            // 并发查询（单笔等待会随 pending 数量线性变慢），
            // 网络层失败（do_fetch_get 返回 {ret:1,err}）必须跳过：
            // 绝不能把一次网络抖动当成"链上查无此交易"而永久标成失败。
            let curid = 0
            try {
                if(typeof getCurrentChain === 'function'){
                    curid = (parseInt((await getCurrentChain()).id || 0) || 0)
                }
            } catch(e) {}
            let results = await Promise.all(updtrs.map(async (li) => {
                // 其它链上发生的交易不在此链的节点上查询：保持其原状态
                if(curid && (parseInt(li.chain_id || 0) || 0) !== curid){
                    return { hash: li.hash, res: { skipped: true } }
                }
                let res = await do_fetch_get(await mnx_get_fullnode_url()+'/query/transaction?hash='+li.hash) || {}
                return { hash: li.hash, res: res }
            }))
            let updtsome = no
            , sts = {} // hash -> 新状态，稍后按 hash 合并
            ;
            for(let i in results){
                let { hash, res } = results[i]
                if(res.err || res.ret){
                    continue // 查询本身失败：本轮跳过，状态保持 pending（用户也可在失败项上手动刷新）
                }
                if(parseInt(res.confirm) >= 0){
                    sts[hash] = 1 // ok
                    updtsome = yes
                }else if( ! res.pending) {
                    sts[hash] = 2 // not find, fail
                    updtsome = yes
                }
            }
            // 同步内存展示对象（updtrs 的项与 t.trslgs 同引用），UI 立即反馈
            for(let i in updtrs){
                let st = sts[updtrs[i].hash]
                if(st != nil) {
                    updtrs[i].stat = st
                }
            }
            if(updtsome) {
                // 写回前重读 storage，只按 hash 合并状态：转账页（dotrs）可能刚插入新记录，
                // 直接整数组写回旧的内存 homeTrsDatas 会把它覆盖掉（读-改-写竞态）。
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
        // 手动刷新一笔被标为失败的交易（活动列表 Failed 旁的刷新图标）：
        // 查一次、如实更新状态——上链则转成功、回到内存池则转 pending（交给自动刷新跟进）、
        // 仍查不到则保持失败，可继续手动刷新；网络失败只提示、不动状态。
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
                // 写回前重读 storage，只按 hash 合并状态（与 updtxsts 相同的竞态保护）
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
            try {
                if(typeof stoReadCurrentChain === 'function'){
                    t.chain = await stoReadCurrentChain()
                    t.chaintip = chainTip(t.chain)
                }
            } catch(e) {}
            t.blsobj = nil
            await refreshHomeTrsLog()
            // load balance
            await t.ldbls()
            // console.log("refresh all", ctime())
        }

    }, async (t) => {
        t.addr = adr
        t.sadr = addrOmitted(adr)
        try {
            if(typeof stoReadCurrentChain === 'function'){
                t.chain = await stoReadCurrentChain()
                t.chaintip = chainTip(t.chain)
            }
        } catch(e) {}
        clbk && clbk()
        // load transaction
        await t.swttab('activity')
        // refresh trs log
        refreshHomeTrsLog = async (reload) => {
            await rfhtl(t, reload)
        }
        await t.refreshAll()
        // test
        // t.opacinf()
        // await t.openadrswct()
        _setTimeout(async ()=>{
            // t.blsobj = {HAC: '1200.8364', HACD: '65', BTC: '0.08625'} // test
            // t.blsobj = {HAC: '0.0', HACD: '0', BTC: '0.0'} // test
           
        }, 600)

    })

    homePageAppPtr = app
    homePageCtxPtr = ctx

    // console.log(app)

    async function rfhtl(t, reload) {
        if(reload) {
            t.activeTab = 'activity' // switch to trs log card
        }
        // 每次都重读 storage：转账页（dotrs）可能刚写入新记录，
        // 复用旧的内存数组会让后续整数组写回把它覆盖掉（W52）。
        homeTrsDatas = await readTransactionLogs()
        // homeTrsDatas[0].stat = 0
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
        // console.log('hac_show_mei_unit', hac_show_mei_unit('999999999999:235'))

        //test
        // t.trslgs[2].stat = 1
        // t.trslgs[3].stat = 1
        // console.log('refreshHomeTrsLog', reload, t.trslgs)
    }   


}

// update balance and trs log
_setInterval(async ()=>{
    if(homePageCtxPtr){
        await homePageCtxPtr.refreshAll()
    }
}, minutes*5);
