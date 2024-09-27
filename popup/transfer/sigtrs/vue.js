
var routePageSigTrs = (adr, clbk) => {

    let txobj = window.atob(decodeURIComponent(urlquery.txobj||''))
    if(!txobj){
        return alert('tx object must give!')
    }
    // console.log(txobj)
    txobj = JSON_parse(txobj)
    if(!txobj.timestamp) {
        txobj.timestamp = tsnow() // 时间戳
    }
    if(txobj.main_address && txobj.main_address!=adr){
        return alert(`main address ${txobj.main_address} not match wallet current account ${adr}`)
    }
    txobj.main_address = adr
    // ok

    let {app} = VueCreateApp('sgtx', vue_tpl_sigtrs, {
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
        txdesc: [],
        txerr: nil,
        // swtgas app
        gasw: nil,
        gaswst: false,
    },{
        nop() {
            window.close()
        }
        // create trs
        , async crtrs() {
            let t = this
            t.lding = yes
            // console.log(txobj)
            // set fee
            if(!t.gaswst){
                if(txobj.fee){
                    txobj.fee += ''
                    let rcmfee = hac_mei_unit(txobj.fee)
                    t.gasw.setb(rcmfee)
                    t.gaswst = true
                }else{
                    txobj.fee = '0.0001' // def
                }
            }
            // console.log(txobj)
            // await sleep(500)
            let resp = await createTransaction(txobj)
            // console.log(resp)
            if(!t.gaswst){
                txobj.fee = await t.gasw.req(resp.body.length/2 + 100) // add 100 sign size
                txobj.fee += ''
                t.gaswst = true
                return await t.crtrs() // re create by req fee
            }
            // console.log(resp)
            t.lding = no
            t.txres = resp
            t.txdesc = parseTxDesc(resp)
            // deal err
            t.txerr = resp.error || nil
            // set or req gas
        }
        , async cfim() {
            let t = this
            if(t.txerr){
                return
            }
            if( ! await wpcfm_open('Once the transaction is signed and commited, it cannot be reversed, can it be confirmed?', 'Confirm')  ) {
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
            , gasset = t.gasw.get()
            if(t.ing) return
            t.ing = yes;
            // console.log(gasset,"HAC gas")
            let signobj = await stoCurAccDoSign(t.txres.hash_with_fee)
            // console.log("signobj", signobj)
            if(signobj.err) {
                t.txerr = signobj.err
                t.ing = yes;
                return
            }
            // do sign
            let sigp = await signTransaction(t.txres.body, {
                signature: true,
                pubkey: signobj.pubkey,
                sigdts: signobj.signature,
            })
            console.log(sigp)
            if(sigp.err){
                t.txerr = sigp.err
                t.ing = yes;
                return
            }
            // submit tx
            let sbmtx = await submitTransaction(sigp.body)
            console.log(sbmtx)
            if(sbmtx.err){
                t.txerr = sbmtx.err
                t.ing = yes;
                return
            }
            // success
            let txlog = {
                payment_address: t.adr,
                timestamp: txobj.timestamp,
                tx_hash: sigp.hash,
                tx_body: sigp.body,
                desc: parseTxDesc(t.txres).join('<br/>')
            };
            let acts = txobj.actions
            console.log(acts)
            if(acts.length==1){
                let act = acts[0]
                , kd = act.kind
                if(kd==1 || kd==5 || kd==6 || kd==8){
                    // transfer
                    txlog.collection_address = act.to
                    if(kd==1) {
                        txlog.amount = act.amount // HAC
                    }else if(kd==8) {
                        txlog.amount = act.amount + ' SAT'
                    }else{
                        txlog.diamonds = act.diamonds
                        txlog.diamond_count = act.diamonds.split(',').length
                    }
                }
            }
            await saveTransactionLog(txlog)
            // ret page data
            t.txres.body = sigp.body
            await returnDataToUserPage(t.txres)
            // ok
            t.ing = no
            t.end = yes
            _setTimeout(t.nop, 3000) // close
            _setTimeout(_=>t.ende=1, 150)
            // ok
            showWPtip("Tx submitted successfully!")
            // close window
            // window.href = './moneynex.html'
        }
    }, async(t)=>{
        clbk && clbk()   
        t.gasw = t.$refs.swtgas
        t.gasw.swt(gas => {
            // console.log(gas)
            txobj.fee = gas+''
            t.crtrs().then()
        })
        // console.log("t.gasw ", t.gasw , t.$refs)
        await t.crtrs()
        // await t.agas.req()
        // console.log()
    }, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    });


}
