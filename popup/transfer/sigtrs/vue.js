
var routePageSigTrs = (adr, clbk) => {

    let txobj = window.atob(decodeURIComponent(urlquery.txobj||''))
    if(!txobj){
        return alert('tx object must give!')
    }
    // console.log(txobj)
    txobj = JSON_parse(txobj)
    if(urlquery.chain_id === undefined && txobj.chain_id !== undefined) {
        urlquery.chain_id = txobj.chain_id
    }
    delete txobj.chain_id
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
        chain: default_chain_configs[MAIN_CHAIN_ID],
        chaintip: '',
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
            let reqerr = await assertUrlRequestChain(yes)
            if(reqerr) {
                t.lding = no
                t.txerr = reqerr.err
                await returnDataToUserPage(reqerr)
                return
            }
            let chtx = await applyCurrentChainToTxobj(txobj)
            if(chtx.err) {
                t.lding = no
                t.txerr = chtx.err
                await returnDataToUserPage(chtx)
                return
            }
            txobj = chtx
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
            if(resp.err || resp.error) {
                t.lding = no
                t.txres = resp
                t.txdesc = parseTxDesc(resp)
                t.txerr = resp.err || resp.error
                return
            }
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
            if( ! await wpcfm_open(`<p>Network: <b>${t.chaintip}</b></p><p>Once the transaction is signed and committed, it cannot be reversed, can it be confirmed?</p>`, 'Confirm')  ) {
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
            let cherr = await assertUrlRequestChain(yes)
            if(cherr) {
                t.txerr = cherr.err
                await returnDataToUserPage(cherr)
                return
            }
            t.ing = yes;
            let sigp = await signAndSubmitTxBody(t.txres.body, t.txres.hash_with_fee)
            if(sigp.err){
                t.txerr = sigp.err
                t.ing = no;
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
            let acts = (txobj.actions || []).filter(act => parseInt(act.kind) !== CHAIN_ALLOW_KIND)
            if(acts.length==1){
                let act = acts[0]
                , kd = parseInt(act.kind)
                , amount = act.amount || act.hacash
                , diamonds = act.diamonds || act.diamond
                if(kd==1 || kd==5 || kd==6 || kd==7 || kd==8){
                    // transfer
                    if(kd==1 && amount) {
                        txlog.collection_address = act.to
                        txlog.amount = amount // HAC
                    }else if(kd==8 && amount) {
                        txlog.collection_address = act.to
                        txlog.amount = amount + ' SAT'
                    }else if(diamonds){
                        txlog.collection_address = act.to
                        txlog.diamonds = diamonds
                        txlog.diamond_count = diamonds.split(',').length
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
        t.chain = await stoReadCurrentChain()
        t.chaintip = chainTip(t.chain)
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
