
var routePageSigTrs = (adr, clbk) => {

    let txobj = window.atob(decodeURIComponent(urlquery.txobj||''))
    if(!txobj){
        return alert('tx object must give!')
    }
    // console.log(txobj)
    txobj = JSON_parse(txobj)
    txobj.timestamp = tsnow() // 固定时间戳
    txobj.addtxsize = 33 + 64 + 2
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
    },{
        nop() {
            window.close()
        }
        // create trs
        , async crtrs() {
            let t = this
            t.lding = yes
            txobj.address = t.adr
            // console.log(txobj)
            // await sleep(500)
            let resp = await createTransaction(txobj)
            // console.log(resp)
            t.lding = no
            t.txres = resp
            t.txdesc = parseTxDesc(resp)
            // deal err
            t.txerr = resp.error || nil
            // set or req gas
            // set
            if(!txobj.fee){
                let rcmfee = hac_mei_unit(resp.txfee)
                t.gasw.setb(rcmfee)
            }
            // req
            // let txsz = (resp.txbody.length/2) + txobj.addtxsize // add one sign
            // await t.gasw.req(txsz) // get gas
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
            let signobj = await stoCurAccDoSign(t.txres.txhashfee)
            // console.log("signobj", signobj)
            if(signobj.err) {
                t.txerr = signobj.err
                t.ing = yes;
                return
            }
            // 提交交易
            let cmtres = await commitTransactionBySign(
                t.txres.txbody, signobj.pubkey, signobj.signature)
            // console.log("cmtres", cmtres)
            if(cmtres.err){
                t.txerr = cmtres.err
                t.ing = yes;
                return
            }
            if(!cmtres.success){
                t.txerr = 'Commit transaction failed'
                t.ing = yes;
                return
            }
            // success
            let txlog = {
                payment_address: t.adr,
                timestamp: txobj.timestamp,
                tx_hash: cmtres.txhash,
                tx_body: cmtres.txbody,
                desc: t.txres.description.join('\n')
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
            t.txres.txbody = cmtres.txbody
            await returnDataToUserPage(t.txres)
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
