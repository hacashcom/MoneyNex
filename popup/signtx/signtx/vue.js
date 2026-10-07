
var routePageSignTx = (adr, clbk) => {

    let txbody = urlquery.txbody||''
    if(!txbody){
        return alert('tx body must give!')
    }
    // URL params are always strings and "false" is truthy: only explicit true/1 auto-broadcasts,
    // default and false both sign without submitting (the DApp receives the signature and decides when to broadcast).
    let asv = String(urlquery.autosubmit == null ? '' : urlquery.autosubmit).trim().toLowerCase()
    , autosubmit = (asv == 'true' || asv == '1')
    let sa = 'sign_addr'
    // Single-reply contract (shared helper): reply signed tx data or {err} once, then close.
    // Cancel / confirm-reject / sign failure / submit failure must all reply before closing.
    let {isAnswered, answerOnce, closeWin, cancelAndClose} = mnx_dapp_reply('Transaction signing')
    // ok
    let {app} = VueCreateApp('sgtx', vue_tpl_signtx, {
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
        txsgck: {},
        txdesc: [],
        txerr: nil,
        layouterr: '',
    },{
        nop() {
            if(isAnswered()){ closeWin(); return }
            cancelAndClose('User canceled the signing request')
        }
        // SDK local review (strict window + degraded report)
        , async req_check() {
            let t = this
            return await mnx_local_review(txbody, t.adr)
        }
        // check trs
        , async crtrs() {
            let t = this
            t.lding = yes
            let rv = await t.req_check()
            if(rv.err){
                t.lding = no
                t.txerr = rv.err
                t.txres = {}
                t.txsgck = {}
                t.txdesc = []
                t.layouterr = ''
                // Terminal refusal must reach the DApp (single-reply contract, same
                // as the ChainAllow branch below): a banned Sign button would
                // otherwise leave the DApp's promise hanging forever. The window
                // stays open showing the reason; Cancel then only closes.
                await answerOnce({ret: 1, err: rv.err, code: 'sign_refused'})
                return
            }
            let review = rv.review
            t.txres = review
            // the body's ChainAllow must allow the current network, otherwise refuse outright and answer the DApp (remote semantics)
            if(typeof assertCheckedBodyChain === 'function'){
                let cherr = await assertCheckedBodyChain(review, yes)
                if(cherr) {
                    t.lding = no
                    t.txerr = cherr.err
                    t.txres = {}
                    t.txsgck = {}
                    t.txdesc = []
                    t.layouterr = ''
                    await answerOnce(cherr)
                    return
                }
            }
            await mnx_msglayout_load()
            // Asset amount display needs on-chain decimals: warm the metadata from review.asset_serials first (failure never blocks signing)
            await mnx_asset_meta_ensure(review.asset_serials || [])
            t.txdesc = parseTxDesc(review)
            await mnx_txdesc_attach_code(review, t.txdesc)
            t.layouterr = (mnx_msglayout_state && mnx_msglayout_state.display_err) || ''
            t.txerr = nil
            t.lding = no
            // Signer status: local Review required/present/missing
            let sg = {}
            for(let i in (review.required_signers || [])){
                let s = review.required_signers[i]
                sg[s] = { address: s, complete: (review.present_signers||[]).indexOf(s) >= 0 }
            }
            t.txsgck = sg
        }
        , async cfim() {
            let t = this
            if(t.txerr){
                return
            }
            if(t.txres && t.txres.auditability && t.txres.auditability != 'full'){
                if( ! await wpcfm_open(`This transaction contains complex actions (audit level: ${t.txres.auditability}). Please review the full action details before signing. Continue?`, 'Continue') ) {
                    cancelAndClose('User canceled the signing request')
                    return
                }
            }
            let nettip = t.chaintip ? `<p>Network: <b>${t.chaintip}</b></p>` : ''
            if( ! await wpcfm_open(`${nettip}<p>Once the transaction is signed, it cannot be reversed, can it be confirmed?</p>`, 'Confirm')  ) {
                cancelAndClose('User canceled the signing request')
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
                body: txbody,
                // Drop Vue proxies so arrays (actions / signers) survive session storage
                review: JSON.parse(JSON.stringify(mnx_sdk_review_clean(t.txres))),
                msgparse: (mnx_msglayout_state && mnx_msglayout_state.extra) || null,
            } })
            mnx_open_actionview(key)
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
            if(t.ing) return
            t.ing = yes;
            if(typeof assertCheckedBodyChain === 'function'){
                let cherr = await assertCheckedBodyChain(t.txres, yes)
                if(cherr) {
                    t.txerr = cherr.err
                    t.ing = no
                    await answerOnce(cherr)
                    return
                }
            }
            let origin = urlquery.dmu || ''
            // prepare -> vault sign -> attach (local)
            let sv = await stoCurAccLocalSignTx(txbody, t.adr, t.txres, origin)
            let signerr = sv.err
            if(signerr) {
                t.txerr = signerr
                t.ing = no;
                // Terminal failure (no signature produced): notify the DApp and close (retry after resolving)
                answerOnce({ret: 1, err: signerr, code: 'sign_failed'}).then(()=>{
                    _setTimeout(closeWin, 800)
                })
                return
            }
            let sigp = sv.result
            // After attach, complete = all required signers have signed
            if( autosubmit && sigp.complete ) {
                // submit
                let subp = await submitTransaction(sigp.body)
                // console.log(subp)
                let submiterr = subp.err || subp.error
                if(submiterr) {
                    t.txerr = submiterr
                    t.ing = no;
                    // Tx signed but on-chain submission failed: hand the signed body back to the DApp; the caller decides when to retry
                    answerOnce({
                        ret: 1,
                        err: 'Signed, but chain submission failed: ' + submiterr,
                        code: 'submit_failed',
                        body: sigp.body,
                        txbody: sigp.body,
                    }).then(()=>{
                        _setTimeout(closeWin, 800)
                    })
                    return
                }
                sigp.submit = true;
            }
            // Reply compatibility: restore sign_hash/hash/hash_with_fee/body/fee/address/need_sign_address/description/ret per sdk.md
            await answerOnce(await mnx_dapp_result(t.txres, sigp, sv.request, t.adr))
            // ok
            t.ing = no
            t.end = yes
            _setTimeout(t.nop, 2500)
            _setTimeout(_=>t.ende=1, 150)
        }
    }, async(t)=>{
        clbk && clbk()
        try {
            if(typeof stoReadCurrentChain === 'function'){
                t.chain = await stoReadCurrentChain()
                t.chaintip = chainTip(t.chain)
            }
        } catch(e) {}
        await t.crtrs()
    });


}
