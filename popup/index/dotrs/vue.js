var routePageDotrs = (clbk) => {

    // alert(adr)

    let {app} = VueCreateApp('dotrs', vue_tpl_dotrs, {
        icfp: icfpath,
        isrcd : no,
        myadr: '',
        recaddr: '',
        amthac: '',
        // recaddr: '1LRi6Wn38JtUppbFv2uWyAwtctcDLtFDFr',
        // amthac: '120', // test
        nmshacd: '',
        cisx: 1,
        /* / gas use
        gsus: 1,
        bgas: 0.0001,
        setgas: '',
        rcmgas: '',
        */
       gasw: nil,
        ing: no,
    },{
        getamt(){
            let t = this
            , hac = t.amthac.trim()
            , hacd = t.nmshacd.trim()
            ;
            if(t.cisx==2 && hacd.length>=6){
                return hacd
            }else if(t.cisx==1 && hac.length>=1){
                return hac
            }
            return nil
        },
        getgas() {
            return this.gasw.get()
        },
        /*
        getgas() {
            let t = this
            , gas = parseFloat(t.rcmgas)
            if(gas < t.bgas){
                gas = t.bgas
            }
            if(t.gsus==2) {
                gas *= 4
            }else if(t.gsus==3) {
                if(t.setgas.indexOf(':')>0){
                    gas = t.setgas
                }else{
                    gas = parseFloat(t.setgas)||0
                }
            }
            return gas
        },
        swtgas(g) {
            let t = this
            t.gsus = g
        },
        */
        swtcis(c) {
            let t = this
            t.cisx = c
            t.bgas = c==1
                ? 0.0001
                : 0.0004
        },
        back(){
            let t = this
            pophpgw(()=>{
                if(t.isrcd) {
                    _setTimeout(refreshHomeTrsLog, 300, yes)
                }
                app.unmount()
            })
        },
        async dotrs(){
            let t = this
            , recadr = t.recaddr.trim()
            , amt = t.getamt()
            , gas = t.getgas()
            ;
            if(t.ing){
                return
            }
            if(!recadr) {
                return showWPerr('Please enter receiving address')
            }
            if(!amt) {
                return showWPerr('Please enter asset')
            }
            if(!gas) {
                return showWPerr('Please enter gas fee')
            }
            if(t.myadr == recadr) {
                return showWPerr('Cannot transfer to yourself')
            }
            let privkey = await stoUnlockAccount()
            if(!privkey) {
                return showWPerr('Account unlocking failed')
            }
            t.ing = yes
            let txres = hacash_api.general_transfer("0", privkey, recadr, amt, gas+"", ctime()+"")
            let txobj = nil
            try {
                txobj = JSON_parse(txres)
            } catch (e) {
                t.ing = no
                return showWPerr(txres)
            }
            // ok pass get amt tip
            // console.log(resobj)
            let amtip = getAmtTip(txobj)
            , gastip = hac_show_mei_unit(gas)
            , to = addrOmitted(recadr);
            // confirm
            let ok = await wpcfm_open(`<p>Check transfer detail</p><br><table><tr><td>Asset</td><td>${amtip}</td></tr><tr><td>Gas</td><td>${gastip}</tr><tr><td>To</td><td>${to}</td></tr></table>`, btncon_confirm)
            if(!ok) {
                t.ing = no
                return
            }
            // submit to blockchain
            let sdrs = await submitTransaction(txobj.tx_body)
            , err = sdrs.err
            if(err) {
                t.ing = no
                // Transaction Add to MemTxPool error: address 1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9 balance ㄜ0:0 not enough， need ㄜ123:248.
                if(err.indexOf('not enough') > 0){
                    err = "Insufficient Balance"
                }
                return showWPerr(err)
            }
            await saveTransactionLog(txobj)
            showWPtip("Tx submitted successfully!")
            // ok
            t.ing = no
            t.isrcd = yes
            _setTimeout(t.back, 777)
        }
    }, async(t)=>{
        clbk && clbk()
        t.myadr = await stoReadCurrentAccount()
        t.gasw = t.$refs.swtgas
        t.gasw.req(200)
    }, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    });


};
