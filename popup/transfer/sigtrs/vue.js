
// Old DApp txobj action kind -> SDK ActionSpec mapping
// (sdk.md contract: 1=HAC, 5/6=HACD, 8=SAT, 17=Asset, 32=HACD inscription; wallet history txlog also reads 5=HACD)
// Accept BOTH the legacy numeric dapp kinds AND their SDK registry action names
// (transfer_hac_to / transfer_hacd_single_to / transfer_hacd_to / transfer_sat_to /
// transfer_asset_to / hacd_insc_push) — ActionSpec.kind takes either form, so the transfer
// entry point must not reject the documented registry names (P3-1).
// dapp kind 5=single name -> transfer_hacd_single_to (diamond field),
// 6=multi names -> transfer_hacd_to (diamonds), 8=SAT -> transfer_sat_to, 17=Asset.
var mnx_map_txobj_actions = (acts) => {
    let out = []
    for(let i in (acts || [])){
        let a = acts[i]
        let kd = a.kind
        // normalize SDK registry names to their legacy numeric kind
        if(kd == 'transfer_hac_to'){ kd = 1 }
        else if(kd == 'transfer_hacd_single_to'){ kd = 5 }
        else if(kd == 'transfer_hacd_to'){ kd = 6 }
        else if(kd == 'transfer_sat_to'){ kd = 8 }
        else if(kd == 'transfer_asset_to'){ kd = 17 }
        else if(kd == 'hacd_insc_push'){ kd = 32 }
        if(kd == 1){
            // numeric-form field is `amount`, SDK-name-form field is `hacash` — accept both
            let amt = a.amount != null ? a.amount : a.hacash
            out.push({ kind: 'transfer_hac_to', to: a.to, hacash: (amt==null ? '0' : amt)+'' })
        }else if(kd == 5 || kd == 6){
            let dn = (a.diamond || a.diamonds || '')
            let names = dn.split(',').map(s=>s.trim()).filter(s=>s.length>0)
            if(kd == 5 && names.length == 1){
                out.push({ kind: 'transfer_hacd_single_to', to: a.to, diamond: names[0] })
            }else{
                out.push({ kind: 'transfer_hacd_to', to: a.to, diamonds: names })
            }
        }else if(kd == 8){
            out.push({ kind: 'transfer_sat_to', to: a.to, satoshi: Number(a.satoshi!=null ? a.satoshi : a.amount) || 0 })
        }else if(kd == 17){
            let ast = a.asset || {}
            out.push({
                kind: 'transfer_asset_to',
                to: a.to,
                asset: {
                    serial: mnx_u64_string(ast.serial),
                    amount: mnx_u64_string(ast.amount) || '0',
                },
            })
        }else if(kd == 32){
            // HACD inscription (engraved_content is UTF-8 hex)
            let dn = (a.diamond || a.diamonds || '')
            let names = dn.split(',').map(s=>s.trim()).filter(s=>s.length>0)
            out.push({
                kind: 'hacd_insc_push',
                diamonds: names,
                protocol_cost: (a.protocol_cost == null ? '0' : a.protocol_cost) + '',
                engraved_type: a.engraved_type == null ? 0 : parseInt(a.engraved_type, 10),
                engraved_content: mnx_utf8_to_hex(a.inscription),
            })
        }else{
            throw new Error('Unsupported action kind: '+kd+'. MoneyNex.transfer accepts kind 1/5/6/8/17/32 or the SDK names transfer_hac_to / transfer_hacd_single_to / transfer_hacd_to / transfer_sat_to / transfer_asset_to / hacd_insc_push')
        }
    }
    return out
}

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
        txobj.timestamp = tsnow() // timestamp
    }
    if(txobj.main_address && txobj.main_address!=adr){
        return alert(`main address ${txobj.main_address} not match wallet current account ${adr}`)
    }
    txobj.main_address = adr
    // Single-reply contract (shared helper): reply to the DApp once (success or {err}) then
    // close; a silent cancel/failure would leave the DApp's transfer request hanging forever.
    let {isAnswered, answerOnce, closeWin, cancelAndClose} = mnx_dapp_reply('Transfer request')
    // ok

    let {app} = VueCreateApp('sgtx', vue_tpl_sigtrs, {
        icfp: icfpath,
        dmu: urlquery.dmu,
        chain: nil,
        chaintip: '', 
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
        layouterr: '',
        body: nil,
        // swtgas app
        gasw: nil,
        gaswst: false,
    },{
        nop() {
            if(isAnswered()){ closeWin(); return }
            cancelAndClose('User canceled the transfer request')
        }
        // build + review (local SDK)
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
            try {
                // URL 请求的链与当前网络不一致时拒绝（远端语义）
                if(typeof assertUrlRequestChain === 'function'){
                    let reqerr = await assertUrlRequestChain(yes)
                    if(reqerr) {
                        t.lding = no
                        t.txerr = reqerr.err
                        await answerOnce(reqerr)
                        return
                    }
                }
                // 非主链自动附加 ChainAllow action（主链上原样返回，行为不变）
                if(typeof applyCurrentChainToTxobj === 'function'){
                    let chtx = await applyCurrentChainToTxobj(txobj)
                    if(chtx.err) {
                        t.lding = no
                        t.txerr = chtx.err
                        await answerOnce(chtx)
                        return
                    }
                    txobj = chtx
                }
                // Local build Type-2 (old general_transfer was Type-1; the SDK only supports Type-2/3 builds).
                // main must use the currently selected account t.adr (not the account at popup open): after switching
                // accounts inside the popup, crtrs() rebuilds with the new one — otherwise you get an inconsistent
                // "built with old main + signed by new account" transaction.
                let actions = mnx_map_txobj_actions(txobj.actions)
                let built = await sdk_tx_build({
                    tx_type: 2,
                    main: t.adr,
                    fee: txobj.fee,
                    timestamp: txobj.timestamp,
                    gas_max: 0,
                    actions,
                })
                if(!t.gaswst){
                    let feeOpts = actions.some(a => a.kind == 'transfer_asset_to')
                        ? {extra9: true, tx_type: 2}
                        : nil
                    txobj.fee = await t.gasw.req(built.body.length/2 + 100, feeOpts) // add 100 sign size
                    txobj.fee += ''
                    t.gaswst = true
                    return await t.crtrs() // re build by req fee
                }
                t.body = built.body
                // Local review
                let rv = await mnx_local_review(built.body, t.adr)
                if(rv.err){
                    t.txerr = rv.err
                    t.txres = {}
                    t.txdesc = []
                    t.layouterr = ''
                    t.lding = no
                    return
                }
                t.lding = no
                t.txres = rv.review
                await mnx_msglayout_load()
                // Asset 金额显示需要链上小数位：先按 review.asset_serials 补齐元数据（失败也不阻断签名）
                await mnx_asset_meta_ensure(rv.review.asset_serials || [])
                t.txdesc = parseTxDesc(rv.review)
                t.layouterr = (mnx_msglayout_state && mnx_msglayout_state.display_err) || ''
                t.txerr = nil
            } catch(e) {
                t.lding = no
                t.txerr = mnx_err_message(e)
                t.layouterr = ''
            }
        }
        , async cfim() {
            let t = this
            if(t.txerr){
                return
            }
            if(t.txres && t.txres.auditability && t.txres.auditability != 'full'){
                if( ! await wpcfm_open(`This transaction contains complex actions (audit level: ${t.txres.auditability}). Please review the full action details before committing. Continue?`, 'Continue') ) {
                    cancelAndClose('User canceled the transfer request')
                    return
                }
            }
            if( ! await wpcfm_open('Once the transaction is signed and commited, it cannot be reversed, can it be confirmed?', 'Confirm')  ) {
                cancelAndClose('User canceled the transfer request')
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
        // Open the read-only full review page (body+review passed via storage.session; no re-fetching/modifying the tx)
        , async openactv() {
            let t = this
            let key = 'actv_' + (t.txres.review_binding || t.txres.tx_hash)
            await chrome_storage_session.set({ [key]: {
                body: t.body,
                review: JSON.parse(JSON.stringify(mnx_sdk_review_clean(t.txres))),
                msgparse: (mnx_msglayout_state && mnx_msglayout_state.extra) || null,
            } })
            mnx_open_actionview(key)
        }
        ,async swtcuraddr(adr) {
            let t = this
            if(!(await mnx_select_current_account(adr))) { return }
            t.adr = adr
            t.sadr = addrOmitted(adr)
            t.adrswct = no
            await t.crtrs() // refresh tx
        }
        , async dosign(){
            let t = this
            , gasset = t.gasw.get()
            if(t.ing) return
            t.ing = yes;
            let origin = urlquery.dmu || ''
            // prepare -> vault sign -> attach (local)
            let sv = await stoCurAccLocalSignTx(t.body, t.adr, t.txres, origin)
            let signerr = sv.err
            if(signerr) {
                t.txerr = signerr
                t.ing = no;
                // Terminal failure (no signature produced): notify the DApp and close
                answerOnce({ret: 1, err: signerr, code: 'sign_failed'}).then(()=>{
                    _setTimeout(closeWin, 800)
                })
                return
            }
            let sigp = sv.result
            // submit tx
            let sbmtx = await submitTransaction(sigp.body)
            console.log(sbmtx)
            let submiterr = sbmtx.err || sbmtx.error
            if(submiterr){
                t.txerr = submiterr
                t.ing = no;
                // Signed but on-chain submission failed: hand the signed body back to the DApp; the caller decides on retry
                answerOnce({ret: 1, err: 'Signed, but chain submission failed: ' + submiterr, code: 'submit_failed', txbody: sigp.body, body: sigp.body}).then(()=>{
                    _setTimeout(closeWin, 800)
                })
                return
            }
            // success: tx has been signed AND submitted to the chain — mark submit
            // so the DApp callback (mnx_dapp_result) reports submit:true (P2-2:
            // signtx/raisefee already set this; a missing flag made DApps that
            // branch on `submit` think the tx was never broadcast).
            sigp.submit = true
            let txlog = {
                payment_address: t.adr,
                timestamp: txobj.timestamp,
                tx_hash: sigp.hash || t.txres.tx_hash,
                tx_body: sigp.body,
                desc: parseTxDesc(t.txres).join('<br/>')
            };
            let acts = txobj.actions
            console.log(acts)
            if(acts.length==1){
                let act = acts[0]
                , kd = act.kind
                if(kd == 'transfer_hac_to'){ kd = 1 }
                else if(kd == 'transfer_hacd_single_to'){ kd = 5 }
                else if(kd == 'transfer_hacd_to'){ kd = 6 }
                else if(kd == 'transfer_sat_to'){ kd = 8 }
                else if(kd == 'transfer_asset_to'){ kd = 17 }
                if(kd==1 || kd==5 || kd==6 || kd==8 || kd==17){
                    // transfer
                    txlog.collection_address = act.to
                    if(kd==1) {
                        txlog.amount = act.amount != null ? act.amount : act.hacash
                    }else if(kd==8) {
                        txlog.amount = (act.amount != null ? act.amount : act.satoshi) + ' SAT'
                    }else if(kd==17) {
                        txlog.type = 'ASSET'
                        let ast = act.asset || {}
                        txlog.asset = {
                            serial: mnx_u64_string(ast.serial),
                            amount: mnx_u64_string(ast.amount) || '0',
                            decimal: ast.decimal,
                            name: ast.name,
                            ticket: ast.ticket,
                        }
                    }else{
                        txlog.diamonds = act.diamonds || act.diamond
                        txlog.diamond_count = String(act.diamonds||act.diamond||'').split(',').length
                    }
                }
            }
            await saveTransactionLog(txlog)
            // ret page data (DApp callback compatibility: ret/success/txbody/txhash/txhashfee/txfee/description)
            await answerOnce(await mnx_dapp_result(t.txres, sigp, sv.request, t.adr))
            // ok
            t.ing = no
            t.end = yes
            _setTimeout(t.nop, 3000) // close
            _setTimeout(_=>t.ende=1, 150)
            // ok
            showWPtip("Tx submitted successfully!")
        }
    }, async(t)=>{
        clbk && clbk()
        try {
            if(typeof stoReadCurrentChain === 'function'){
                t.chain = await stoReadCurrentChain()
                t.chaintip = chainTip(t.chain)
            }
        } catch(e) {}
        t.gasw = t.$refs.swtgas
        t.gasw.swt(gas => {
            // console.log(gas)
            txobj.fee = gas+''
            t.crtrs().then()
        })
        // console.log("t.gasw ", t.gasw , t.$refs)
        await t.crtrs()
    }, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    });


}
