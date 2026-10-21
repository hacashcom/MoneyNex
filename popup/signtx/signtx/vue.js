
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
    let reviewGeneration = 0
    window.addEventListener('pagehide', ()=>{ reviewGeneration++ })
    // Single-reply contract (shared helper): reply signed tx data or {err} once, then close.
    // Cancel / confirm-reject / sign failure / submit failure must all reply before closing.
    let {answerOnce, closeWin, cancelAndClose, nop} = mnx_dapp_reply('Transaction signing', 'User canceled the signing request')
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
        reviewReady: false,
        adr: adr,
        sadr: addrOmitted(adr),
        txres: {},
        txmeta: {},
        txAddressTableHtml: '',
        txfee: {},
        displayContext: {},
        txsgck: {},
        txdesc: [],
        txerr: nil,
        layouterr: '',
        // shared single-reply Cancel handler (mnx_dapp_reply), exposed as data
        nop: nop,
    },{
        // SDK local review (strict window + degraded report)
        async req_check() {
            let t = this
            return await mnx_local_review(txbody, t.adr)
        }
        // check trs
        , async crtrs() {
            let t = this
            let generation = ++reviewGeneration
            t.reviewReady = false
            t.lding = yes
            let rv = await t.req_check()
            if(generation !== reviewGeneration){ return }
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
            let addresses = Array.isArray(review.address_table) ? review.address_table : [review.main]
            t.txAddressTableHtml = addresses.length > 1
                ? '<ol class="tx-address-table">' + addresses.map((address, index) =>
                    `<li><span class="tx-addr-index">${index}:</span>${mnx_address_html(address)}${index === 0 ? ' <b>primary / fee payer</b>' : ''}</li>`
                ).join('') + '</ol>'
                : ''
            t.txmeta = { timestamp: new Date(review.timestamp * 1000).toLocaleString() }
            t.txfee = {
                amount: mnx_fin_to_decimal(review.fee),
                gasMax: review.gas_max == null ? 'Not set' : review.gas_max,
                gasBudget: review.gas_budget,
                maxCharge: review.gas_max_charge == null ? null : mnx_fin_to_decimal(review.gas_max_charge),
                purity: review.fee_purity,
                purityUnit: review.fee_purity_unit,
                purityFloor: review.fee_purity_floor,
                billingSize: review.billing_size,
                estimateHeight: review.gas_estimate_height,
            }
            // the body's ChainAllow must allow the current network, otherwise refuse outright and answer the DApp (remote semantics)
            if(typeof assertCheckedBodyChain === 'function'){
                let cherr = await assertCheckedBodyChain(review, yes)
                if(generation !== reviewGeneration){ return }
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
            if(generation !== reviewGeneration){ return }
            // Asset amount display needs on-chain decimals: warm the metadata from review.asset_serials first (failure never blocks signing)
            await mnx_asset_meta_ensure(review.asset_serials || [])
            if(generation !== reviewGeneration){ return }
            let heightClock = await mnx_height_clock_load(review, t.chain)
            if(generation !== reviewGeneration){ return }
            t.displayContext = { height_clock: heightClock }
            t.txdesc = parseTxDesc(review, t.displayContext)
            t.lding = no
            await mnx_txdesc_attach_code(review, t.txdesc, () => generation === reviewGeneration, () => {})
            if(generation !== reviewGeneration){ return }
            t.layouterr = (mnx_msglayout_state && mnx_msglayout_state.display_err) || ''
            t.txerr = nil
            t.reviewReady = true
            // Signer status: local Review required/present/missing
            let sg = {}
            for(let i in (review.required_signers || [])){
                let s = review.required_signers[i]
                let status = mnx_tx_signer_status(review, s)
                sg[s] = { address: s, status, complete: status === 'valid' }
            }
            t.txsgck = sg
        }
        , async cfim() {
            let t = this
            if(t.txerr || !t.reviewReady || t.lding){
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
        // Open the read-only full review page (shared helper: body+review via storage.session)
        , async openactv() {
            await mnx_open_actionview_for(txbody, this.txres, this.displayContext)
        }
        , async gashelp() {
            let text = this.txfee.gasBudget == null
                ? 'No gas budget is specified for this transaction.'
                : '<b>About the maximum gas charge</b><br>Estimated charge at the full gas budget, using the higher of transaction fee purity and the protocol purity floor, rounded up to the settlement unit. Actual charge depends on gas used and refunds.'
            await wphelp_open(text)
        }
        ,async swtcuraddr(adr) {
            let t = this
            t.adr = adr
            t.sadr = addrOmitted(adr)
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
        await mnx_load_chaintip(t)
        await t.crtrs()
    }, nil, {
        components: {
            pghead: pgheadAppObj,
        },
    });


}
