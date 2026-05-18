
var routePageSignTx = (adr, clbk) => {

    let txbody = urlquery.txbody||''
    if(!txbody){
        return alert('Missing tx body')
    }
    let autosubmit = urlquery.autosubmit||false
    let sa = 'sign_addr'
    // console.log(txbody)
    // ok
    let {app} = VueCreateApp('sgtx', vue_tpl_signtx, {
        icfp: icfpath,
        dmu: urlquery.dmu,
        end: no,
        ende: no,
        ing: no,
        lding: yes,
        adr: adr,
        sadr: addrOmitted(adr),
        chain: default_chain_configs[MAIN_CHAIN_ID],
        chaintip: '',
        adrswct: no,
        adrmaps: {},
        txres: {},
        txsgck: {},
        txdesc: [],
        txerr: nil,
        // swtgas app
        // gasw: nil,
    },{
        nop() {
            window.close()
        }
        , async req_check() {
            let t = this
            // await sleep(500)
            let resp = await checkTransaction(txbody, { 
                unit: 'mei', sign_address: adr,
                signature: true, description: true,
            })
            // console.log(resp)
            t.txres = resp
            t.txsgck = resp.signatures || {}
            if(!resp.error) {
                let cherr = await assertCheckedBodyChain(resp, yes)
                if(cherr) {
                    resp.error = cherr.err
                    await returnDataToUserPage(cherr)
                }
            }
            return resp
        }
        // check trs
        , async crtrs() {
            let t = this
            t.lding = yes
            // params[sa] = t.adr
            let resp = await t.req_check()
            t.lding = no
            t.txdesc = parseTxDesc(resp)
            // deal err
            t.txerr = resp.error || nil
            // req
        }
        , async cfim() {
            let t = this
            if(t.txerr){
                return
            }
            if( ! await wpcfm_open(`<p>Network: <b>${t.chaintip}</b></p><p>Once signed, this transaction cannot be reversed. Confirm?</p>`, 'Confirm')  ) {
                return
            }
            // do sign
            t.dosign().then()
        }
        , async openadrswct() {
            let t = this
            t.adrmaps = await stoReadAccount()
            t.adrswct = yes
        }
        ,async swtcuraddr(adr) {
            let t = this
            t.adr = adr
            t.sadr = addrOmitted(adr)
            t.adrswct = no
            await stoSaveCurrentAccount(adr)
            await t.crtrs() // refresh tx
        }
        , async dosign(){
            let t = this
            // , gasset = t.gasw.get()
            if(t.ing) return
            let cherr = await assertCheckedBodyChain(t.txres, yes)
            if(cherr) {
                t.txerr = cherr.err
                await returnDataToUserPage(cherr)
                return
            }
            t.ing = yes;
            let sigp = await signTxBodyAndMaybeSubmit(txbody, t.txres.sign_hash, autosubmit)
            if(sigp.err) {
                t.txerr = sigp.err
                t.ing = no;
                return
            }
            // success return
            await returnDataToUserPage(sigp)
            // ok
            t.ing = no
            t.end = yes
            _setTimeout(t.nop, 2500)
            _setTimeout(_=>t.ende=1, 150)
            // ok
            // showWPtip("Tx submitted successfully!")
            // close window
            // window.href = './moneynex.html'
        }
    }, async(t)=>{
        clbk && clbk()   
        t.chain = await stoReadCurrentChain()
        t.chaintip = chainTip(t.chain)
        // t.gasw = t.$refs.swtgas
        // t.gasw.swt(gas => {
        //     // console.log(gas)
        //     txobj.fee = gas+''
        //     t.crtrs().then()
        // })
        // console.log("t.gasw ", t.gasw , t.$refs)
        await t.crtrs()
        // await t.agas.req()
        // console.log()
    }/*, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    }*/);


}
