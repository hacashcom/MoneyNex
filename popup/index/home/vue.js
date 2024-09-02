let refreshHomeTrsLog = nil
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
        addr: '',
        sadr: '',
        /* header */
        optmenu: no,
        adrswct: no,
        adrmaps: {},
        /* home */
        blsctx: ['HAC', 'HACD'],
        blsobj: nil, // {HAC, HACD, BTC, SAT}
        tabx: 0,
        /* trslog actvlgs collect */
        trslgs: nil,
        actvlgs: nil,
        dialis: nil,
        /*  */
        clcted: no,
    },{
        dotrs() {
            routePageDotrs(()=>{
                pushhpgw('dotrs')
            })
        }
        ,async swttab(x) {
            let t = this
            t.tabx = x
            // load HACD names
            if(!t.clcted && x==3) {
                t.clcted = yes
                let res = await do_fetch_get(fullnode_url+'/query/balance?diamonds=true&address='+t.addr)
                , dias = res.list[0].diamonds || ""
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
            t.addr = adr
            t.sadr = addrOmitted(adr)
            t.tabx = 1 // reset
            t.clcted = no // refresh
            t.dialis = nil
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
        // load balance
        ,async ldbls() {
            // return
            let t = this
            let res = await do_fetch_get(fullnode_url+'/query/balance?unit=mei&address='+t.addr)
            res = res.list[0]
            // console.log(res)
            t.blsobj = {HAC: res.hacash, HACD:  res.diamond, SAT:  res.satoshi}
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

        , async updtxsts(updtrs) {
            // console.log(updtrs)
            if(!updtrs.length) {
                return
            }
            // console.log(updtrs)
            let updtsome = no
            for(let i in updtrs){
                let li = updtrs[i]
                let res = await do_fetch_get(fullnode_url+'/query/transaction?hash='+li.hash) || {}
                // console.log(res)
                if(res.confirm){
                    li.stat = 1 // ok
                    updtsome = yes
                }else if( ! res.pending) {
                    li.stat = 2 // not find, fail
                    updtsome = yes
                }
                // res['pending']
                // console.log(res)
            }
            if(updtsome) {
                // console.log('updateTransactionLogs(homeTrsDatas)')
                await updateTransactionLogs(homeTrsDatas)
            }
        }
        // update balance and trs log
        , async refreshAll() {
            let t = this
            t.blsobj = nil
            await refreshHomeTrsLog()
            // load balance
            await t.ldbls()
            // console.log("refresh all", ctime())
        }

    }, async (t) => {
        t.addr = adr
        t.sadr = addrOmitted(adr)
        clbk && clbk()
        // load transaction
        await t.swttab(1)
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
            t.tabx = 1 // switch to trs log card
        }
        if(reload || !homeTrsDatas){
            homeTrsDatas = await readTransactionLogs()
        }
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
}, minutes*5)
