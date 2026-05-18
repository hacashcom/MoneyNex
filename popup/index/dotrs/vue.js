var routePageDotrs = (clbk) => {

    // alert(adr)

    let {app} = VueCreateApp('dotrs', vue_tpl_dotrs, {
        icfp: icfpath,
        isrcd : no,
        myadr: '',
        chain: default_chain_configs[MAIN_CHAIN_ID],
        chaintip: '',
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
            let act = nil
            if(t.cisx == 1) {
                act = {kind: 1, to: recadr, hacash: amt}
            }else{
                act = {kind: 7, to: recadr, diamonds: amt}
            }
            let txobj = await applyCurrentChainToTxobj({
                main_address: t.myadr,
                fee: gas+'',
                timestamp: ctime(),
                actions: [act],
            })
            if(txobj.err) {
                t.ing = no
                return showWPerr(txobj.err)
            }
            let txres = await createTransaction(txobj)
            if(txres.err || txres.error) {
                t.ing = no
                return showWPerr(txres.err || txres.error)
            }
            // ok pass get amt tip
            // console.log(resobj)
            let amtip = t.cisx == 1 ? hac_show_mei_unit(amt) : `${amt.split(',').length} HACD (${amt})`
            , gastip = hac_show_mei_unit(gas)
            , to = addrOmitted(recadr);
            // confirm
            let ok = await wpcfm_open(`<p>Check transfer detail</p><br><table><tr><td>Network</td><td>${t.chaintip}</td></tr><tr><td>Asset</td><td>${amtip}</td></tr><tr><td>Gas</td><td>${gastip}</tr><tr><td>To</td><td>${to}</td></tr></table>`, btncon_confirm)
            if(!ok) {
                t.ing = no
                return
            }
            let sigp = await signAndSubmitTxBody(txres.body, txres.hash_with_fee)
            if(sigp.err) {
                t.ing = no
                let err = sigp.err
                if(err.indexOf && err.indexOf('not enough') > 0){
                    err = 'Insufficient Balance'
                }
                return showWPerr(err)
            }
            await saveTransactionLog({
                payment_address: t.myadr,
                timestamp: txobj.timestamp,
                tx_hash: sigp.hash,
                tx_body: sigp.body,
                collection_address: recadr,
                amount: t.cisx == 1 ? amt : nil,
                diamonds: t.cisx == 2 ? amt : nil,
                diamond_count: t.cisx == 2 ? amt.split(',').length : nil,
                desc: parseTxDesc(txres).join('<br/>'),
            })
            showWPtip("Tx submitted successfully!")
            // ok
            t.ing = no
            t.isrcd = yes
            _setTimeout(t.back, 777)
        }
    }, async(t)=>{
        clbk && clbk()
        t.chain = await stoReadCurrentChain()
        t.chaintip = chainTip(t.chain)
        t.myadr = await stoReadCurrentAccount()
        t.gasw = t.$refs.swtgas
        t.gasw.req(200)
    }, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    });


};
