
var routePageSignTx = (adr, clbk) => {

    let txbody = urlquery.txbody||''
    if(!txbody){
        return alert('tx body must give!')
    }
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
            t.txsgck = resp.signatures
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
            if( ! await wpcfm_open('Once the transaction is signed, it cannot be reversed, can it be confirmed?', 'Confirm')  ) {
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
            t.ing = yes;
            // console.log(gasset,"HAC gas")
            // console.log(t.txres)
            let signobj = await stoCurAccDoSign(t.txres.sign_hash)
            // console.log("signobj", signobj)
            if(signobj.err) {
                t.txerr = signobj.err
                t.ing = no;
                return
            }
            // do sign
            let sigp = await signTransaction(txbody, {
                signature: true,
                pubkey: signobj.pubkey,
                sigdts: signobj.signature,
            })
            let check_all_sigs_ok = function() {
                for( sg in sigp.signatures ) {
                    let isok = sigp.signatures[sg].complete
                    if(!isok) {
                        return false
                    }
                }
                return true
            } 
            if( check_all_sigs_ok() ) {
                // submit 
                let subp = await submitTransaction(sigp.body)
                // console.log(subp)
                if(subp.err) {
                    t.txerr = subp.err
                    t.ing = no;
                    return
                }
                sigp.submit = true;
            } 
            // console.log(sigp)
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

