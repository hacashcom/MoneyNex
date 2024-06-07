
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
        // , async req_check() {
        //     let t = this
        //     // await sleep(500)
        //     let resp = await checkTx(txbody, params)
        //     t.txres = resp
        //     t.txsgck = resp.need_sign_address
        //     console.log(resp)
        //     return resp
        // }
        // check trs
        // , async crtrs() {
        //     let t = this
        //     t.lding = yes
        //     params[sa] = t.adr
        //     let resp = await t.req_check()
        //     t.lding = no
        //     t.txdesc = parseTxDesc(resp)
        //     // deal err
        //     t.txerr = resp.error || nil
        //     // req
        // }
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
            let res = await proxyWalletAPI('raise_fee', {
                hash: t.hash,
                fee: t.fee,
            });
            if(!res || res.err) {
                t.ing = no;
                return showWPerr('Error: '+res.err)
            }
            console.log(res)
            let signobj = await stoCurAccDoSign(res.hash_with_fee)
            console.log("signobj", signobj)
            if(signobj.err) {
                t.ing = no;
                return showWPerr('Sign Error: '+signobj.err)
            }
            // up
            let res2 = await proxyWalletAPI('raise_fee', {
                hash: t.hash,
                fee: t.fee,
                publickey: signobj.pubkey,
                signature: signobj.signature,
            });
            console.log("res submit", res2)
            if(!res2 || res2.err) {
                t.ing = no;
                return showWPerr('Error: '+res2.err)
            }
            // submit ok
            t.end = yes
            _setTimeout(t.nop, 3000)
            _setTimeout(_=>t.ende=1, 150)
            // success return
            await returnDataToUserPage(res2)
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
