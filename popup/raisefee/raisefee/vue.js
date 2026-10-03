
var routePageRaiseFee = (adr, clbk) => {

    let hash = urlquery.hash||''
    let fee = urlquery.fee||''

    // console.log(hash, fee)

    // Single-reply contract (shared helper): reply to the DApp once (success or {err}) then close;
    // a silent cancel would leave the DApp's raisefee request hanging forever.
    let {isAnswered, answerOnce, closeWin, cancelAndClose} = mnx_dapp_reply('Raise fee request')
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
                return showWPerr('Please enter the tx hash.')
            }
            if(!t.fee){
                return showWPerr('Please enter the tx fee.')
            }
            if(t.ing) return
            t.ing = yes;
            // URL 请求的链与当前网络不一致时拒绝（远端语义）
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
                return showWPerr('Error: Tx not find in tx pool')
            }
            try {
                // 1) hash 绑定（防换交易）：请求加费的是 t.hash 这笔交易，节点返回的 body
                //    必须本地重算出同一个 tx hash。RPC 可被替换/劫持（默认网关甚至是 http），
                //    body 与请求 hash 无绑定时，用户以为在给 A 交易加费，
                //    实际可能把签名交给任意一笔交易。
                let orig = await sdk_tx_inspect_report(res.body)
                if(!orig || !orig.tx_hash || String(orig.tx_hash).toLowerCase() != String(t.hash).toLowerCase()){
                    throw new Error('Refetched tx body does not match the requested hash — refusing to sign')
                }
                // SDK local rebuild: decode -> map to ActionSpec -> rebuild with the new fee
                // (tx.encode has an unsigned_body_hash integrity gate; changing the fee requires recomputing via tx.build)
                let txjson = await sdk_tx_decode(res.body)
                if(txjson.main && txjson.main != t.adr){
                    // 加费必须由原交易的手续费支付方（main）签名支付；换过账户时提前给明确提示，
                    // 而不是等到 prepare_signature 报 SDK 签名者错误
                    t.ing = no
                    return showWPerr('This tx fee is paid by ' + txjson.main + ' — switch to that account first')
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
                    return showWPerr('Check Tx Error: '+rv.err)
                }
                let review = rv.review
                // body 内 ChainAllow 必须允许当前网络（远端语义）
                if(typeof assertCheckedBodyChain === 'function'){
                    let cherr = await assertCheckedBodyChain(review, yes)
                    if(cherr) {
                        t.ing = no
                        t.err = cherr.err
                        await answerOnce(cherr)
                        return showWPerr(cherr.err)
                    }
                }
                // 2) 重显完整 actions 二次确认：加费页此前只展示 hash/fee，用户看不到要签什么。
                //    本地 review 渲染出全部动作（parseTxDesc 内部对 action 内容做了转义），
                //    用户确认的必须是"这笔交易的这些动作"。
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
                    return showWPerr('Sign Error: '+signerr)
                }
                let sigp = sv.result
                // submit
                let subp = await submitTransaction(sigp.body)
                console.log(subp)
                let submiterr = subp.err || subp.error
                if(submiterr) {
                    t.ing = no;
                    return showWPerr('Error: '+submiterr)
                }
                // success return (DApp callback compatibility)
                sigp.submit = true;
                await answerOnce(await mnx_dapp_result(review, sigp, sv.request, t.adr))
                t.end = yes
                _setTimeout(t.nop, 3000)
                _setTimeout(_=>t.ende=1, 150)
            } catch(e) {
                t.ing = no;
                return showWPerr('Error: '+mnx_err_message(e))
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
            if(!(await mnx_select_current_account(adr))) { return }
            t.adr = adr
            t.sadr = addrOmitted(adr)
            t.adrswct = no
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
