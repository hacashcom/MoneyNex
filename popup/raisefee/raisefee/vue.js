
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
            // get tx body
            let res = await queryTransaction(t.hash)
            console.log(res)
            if(!res || !res.pending) {
                t.ing = no;
                return showWPerr('Error: Tx not find in tx pool')
            }
            // reset fee
            let txobj = await checkTransaction(res.body, {
                body: true, set_fee: t.fee,
            })
            console.log("txobj", txobj)
            if(!txobj || txobj.err) {
                t.ing = no;
                return showWPerr('Check Tx Error: '+txobj.err)
            }
            let signobj = await stoCurAccDoSign(txobj.hash_with_fee)
            console.log("signobj", signobj)
            if(signobj.err) {
                t.ing = no;
                return showWPerr('Sign Error: '+signobj.err)
            }
            // do sign
            let sigp = await signTransaction(txobj.body, {
                signature: true,
                pubkey: signobj.pubkey,
                sigdts: signobj.signature,
            })
            // console.log(sigp)
            // submit 
            let subp = await submitTransaction(sigp.body)
            console.log(subp)
            if(subp.err) {
                t.ing = no;
                return showWPerr('Error: '+subp.err)
            }
            // success return
            sigp.submit = true;
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
            if( ! await wpcfm_open(`Attention: once the tx fee is raised to '${t.fee}', it can't be reduced or revoked.`, 'Confirm')  ) {
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
