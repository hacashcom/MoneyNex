
var routePageRaiseFee = (adr, clbk) => {

    let hash = urlquery.hash||''
    let fee = urlquery.fee||''

    // console.log(hash, fee)

    // let params = {}
    // , sa = 'sign_addr'
    // ok
    let {app} = VueCreateApp('rsfe', vue_tpl_raisefee, {
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
        // data
        err: null,
        hash,
        fee,
    },{
        nop() {
            window.close()
        }
        , async doraise() {
            let t = this
            // , gasset = t.gasw.get()
            if(!t.hash){
                return showWPerr('Please enter the tx hash.')
            }
            if(!t.fee){
                return showWPerr('Please enter the tx fee.')
            }
            if(t.ing) return
            t.ing = yes;
            let reqerr = await assertUrlRequestChain(yes)
            if(reqerr) {
                t.ing = no
                t.err = reqerr.err
                await returnDataToUserPage(reqerr)
                return showWPerr(reqerr.err)
            }
            // get tx body
            let res = await queryTransaction(t.hash)
            if(!res || !res.pending) {
                t.ing = no;
                return showWPerr('Error: Tx not find in tx pool')
            }
            // reset fee
            let txobj = await checkTransaction(res.body, {
                body: true, set_fee: t.fee,
            })
            if(!txobj || txobj.err || txobj.error) {
                t.ing = no;
                return showWPerr('Check Tx Error: '+(txobj ? (txobj.err || txobj.error) : 'empty response'))
            }
            let cherr = await assertCheckedBodyChain(txobj, yes)
            if(cherr) {
                t.ing = no
                t.err = cherr.err
                await returnDataToUserPage(cherr)
                return showWPerr(cherr.err)
            }
            let sigp = await signAndSubmitTxBody(txobj.body, txobj.hash_with_fee)
            if(sigp.err) {
                t.ing = no
                return showWPerr('Error: '+sigp.err)
            }
            t.end = yes
            _setTimeout(t.nop, 3000)
            _setTimeout(_=>t.ende=1, 150)
            // success return
            await returnDataToUserPage(sigp)
        }
        , async cfim() {
            let t = this
            if(t.txerr){
                return
            }
            if( ! await wpcfm_open(`<p>Network: <b>${t.chaintip}</b></p><p>Attention: once the tx fee is raised to '${t.fee}', it can't be reduced or revoked.</p>`, 'Confirm')  ) {
                return
            }
            // do raise
            t.doraise().then()
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
            // await t.crtrs() // refresh tx
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
        // await t.crtrs()
        // await t.agas.req()
        // console.log()
    }/*, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    }*/);


}
