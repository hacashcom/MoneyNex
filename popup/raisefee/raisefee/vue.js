
var routePageRaiseFee = (adr, clbk) => {

    let hash = urlquery.hash||''
    let fee = urlquery.fee||''

    // console.log(hash, fee)

    // Single-reply contract (shared helper): reply to the DApp once (success or {err}) then close;
    // a silent cancel would leave the DApp's raisefee request hanging forever.
    let {isAnswered, answerOnce, closeWin, cancelAndClose} = mnx_dapp_reply('Raise fee request')
    // Terminal failure must reach the DApp (single-reply contract): show the reason
    // in the window AND answer {ret:1, err, code} once, or the DApp's raisefee
    // promise hangs forever while the window just sits on the error (found as a
    // real gap in A5 phase-2: node "tx already exists" left the DApp hanging).
    let raisefail = (err, code) => {
        if(!isAnswered()){ answerOnce({ret: 1, err, code}) }
        return showWPerr(err)
    }
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
        chain: nil,
        chaintip: '', 
    },{
        nop() {
            if(isAnswered()){ closeWin(); return }
            cancelAndClose('User canceled the raise-fee request')
        }
        , async doraise() {
            let t = this
            if(!t.hash){
                return raisefail('Please enter the tx hash.', 'sign_refused')
            }
            if(!t.fee){
                return raisefail('Please enter the tx fee.', 'sign_refused')
            }
            if(t.ing) return
            t.ing = yes;
            // refuse when the chain requested via URL differs from the current network (remote semantics)
            if(typeof assertUrlRequestChain === 'function'){
                let reqerr = await assertUrlRequestChain(yes)
                if(reqerr) {
                    t.ing = no
                    t.err = reqerr.err
                    await answerOnce(reqerr)
                    return showWPerr(reqerr.err)
                }
            }
            // get tx body
            let res = await queryTransaction(t.hash)
            console.log(res)
            if(!res || !res.pending) {
                t.ing = no;
                return raisefail('Error: Tx not find in tx pool', 'sign_refused')
            }
            try {
                // 1) hash binding (anti-substitution): the fee raise targets the transaction t.hash; the body the node returns
                //    must re-hash locally to that same tx hash. An RPC can be swapped/hijacked (the default gateway was even http),
                //    without binding the body to the requested hash, the user thinks they are raising the fee for transaction A
                //    while actually handing their signature to an arbitrary transaction.
                let orig = await sdk_tx_inspect_report(res.body)
                if(!orig || !orig.tx_hash || String(orig.tx_hash).toLowerCase() != String(t.hash).toLowerCase()){
                    throw new Error('Refetched tx body does not match the requested hash — refusing to sign')
                }
                // SDK local rebuild: decode -> map to ActionSpec -> rebuild with the new fee
                // (tx.encode has an unsigned_body_hash integrity gate; changing the fee requires recomputing via tx.build)
                let txjson = await sdk_tx_decode(res.body)
                if(txjson.main && txjson.main != t.adr){
                    // the fee must be signed by the original transaction's fee payer (main); when the account has switched, say so up front
                    // instead of waiting for prepare_signature to fail with an SDK signer error
                    t.ing = no
                    return raisefail('This tx fee is paid by ' + txjson.main + ' — switch to that account first', 'sign_refused')
                }
                let specs = mnx_txjson_to_spec(txjson)
                let built = await sdk_tx_build({
                    tx_type: txjson.tx_type,
                    main: txjson.main,
                    fee: t.fee,
                    timestamp: txjson.timestamp,
                    gas_max: txjson.gas_max || 0,
                    actions: specs,
                })
                // Local review
                let rv = await mnx_local_review(built.body, t.adr)
                if(rv.err){
                    t.ing = no;
                    return raisefail('Check Tx Error: '+rv.err, 'sign_refused')
                }
                let review = rv.review
                // the body's ChainAllow must allow the current network (remote semantics)
                if(typeof assertCheckedBodyChain === 'function'){
                    let cherr = await assertCheckedBodyChain(review, yes)
                    if(cherr) {
                        t.ing = no
                        t.err = cherr.err
                        await answerOnce(cherr)
                        return showWPerr(cherr.err)
                    }
                }
                // 2) re-show the full actions for a second confirmation: the fee page used to show only hash/fee, hiding what is being signed.
                //    the local review renders every action (parseTxDesc escapes action content internally),
                //    and what the user confirms must be "these actions of this transaction".
                await mnx_msglayout_load()
                let desc = parseTxDesc(review).join('<br/>')
                let actok = await wpcfm_open(
                    `<p>Check the actions of tx <b>${mnx_esc_html(String(t.hash).substring(0, 16))}…</b> (fee → <b>${mnx_esc_html(t.fee)} HAC</b>):</p><div class="rfdesc">${desc}</div>`,
                    'Confirm', 'red')
                if(!actok){
                    t.ing = no
                    cancelAndClose('User canceled the raise-fee request')
                    return
                }
                // Sign + attach (local)
                let origin = urlquery.dmu || ''
                let sv = await stoCurAccLocalSignTx(built.body, t.adr, review, origin)
                let signerr = sv.err
                if(signerr) {
                    t.ing = no;
                    return raisefail('Sign Error: '+signerr, 'sign_failed')
                }
                let sigp = sv.result
                // submit
                let subp = await submitTransaction(sigp.body)
                console.log(subp)
                let submiterr = subp.err || subp.error
                if(submiterr) {
                    t.ing = no;
                    return raisefail('Error: '+submiterr, 'submit_failed')
                }
                // success return (DApp callback compatibility)
                sigp.submit = true;
                await answerOnce(await mnx_dapp_result(review, sigp, sv.request, t.adr))
                t.end = yes
                _setTimeout(t.nop, 3000)
                _setTimeout(_=>t.ende=1, 150)
            } catch(e) {
                t.ing = no;
                return raisefail('Error: '+mnx_err_message(e), 'sign_refused')
            }
        }
        , async cfim() {
            let t = this
            if( ! await wpcfm_open(`Attention: once the tx fee is raised to '${t.fee}', it can't be reduced or revoked.`, 'Confirm')  ) {
                cancelAndClose('User canceled the raise-fee request')
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
        try {
            if(typeof stoReadCurrentChain === 'function'){
                t.chain = await stoReadCurrentChain()
                t.chaintip = chainTip(t.chain)
            }
        } catch(e) {}
    });


}
