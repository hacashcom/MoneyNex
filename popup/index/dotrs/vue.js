var routePageDotrs = (options, clbk) => {

    if(typeof options === 'function'){
        clbk = options
        options = null
    }
    options = options || {}
    let initType = options.type == 'ASSET' ? 'ASSET' : 'HAC'
    let initAsset = (initType == 'ASSET' && options.asset) ? options.asset : nil

    let {app} = VueCreateApp('dotrs', vue_tpl_dotrs, {
        icfp: icfpath,
        chain: nil,
        chaintip: '',
        isrcd : no,
        myadr: '',
        recaddr: '',
        amthac: '',
        nmshacd: '',
        amtasset: '',
        transferType: initType,
        asset: initAsset,
        assetAvail: '',
        gasw: nil,
        ing: no,
    },{
        getamt(){
            let t = this
            if(t.transferType=='HACD'){
                let hacd = t.nmshacd.trim()
                return hacd.length>=6 ? hacd : nil
            }
            if(t.transferType=='ASSET'){
                let a = t.amtasset.trim()
                return a.length>=1 ? a : nil
            }
            let hac = t.amthac.trim()
            return hac.length>=1 ? hac : nil
        },
        getgas() {
            return this.gasw.get()
        },
        swtcis(c) {
            let t = this
            if(t.transferType=='ASSET'){
                return
            }
            t.transferType = c==2 ? 'HACD' : 'HAC'
        },
        setmax() {
            let t = this
            if(!t.asset || t.asset.decimal == null){
                return
            }
            t.amtasset = formatAssetAtoms(t.asset.atoms, t.asset.decimal)
        },
        back(){
            let t = this
            pophpgw(()=>{
                if(t.isrcd) {
                    _setTimeout(async ()=>{
                        if(homePageCtxPtr){
                            await homePageCtxPtr.refreshAll()
                        }
                        if(refreshHomeTrsLog){
                            await refreshHomeTrsLog(yes)
                        }
                    }, 300)
                }
                app.unmount()
            })
        },
        async dotrs(){
            let t = this
            , recadr = t.recaddr.trim()
            , amt = t.getamt()
            , gas = t.getgas()
            ;
            if(t.ing){
                return
            }
            if(!recadr) {
                return showWPerr('Please enter receiving address')
            }
            if(!amt) {
                return showWPerr(t.transferType=='ASSET' ? 'Please enter amount' : 'Please enter asset')
            }
            if(!gas) {
                return showWPerr('Please enter gas fee')
            }
            if(t.myadr == recadr) {
                return showWPerr('Cannot transfer to yourself')
            }
            let atomicAmount = nil
            if(t.transferType=='ASSET'){
                if(!t.asset || !t.asset.metadata || t.asset.decimal == null){
                    return showWPerr('Asset metadata unavailable')
                }
                let parsed = parseAssetAmount(amt, t.asset.decimal, t.asset.atoms)
                if(parsed.err){
                    return showWPerr(parsed.err)
                }
                atomicAmount = parsed.atoms
            }
            t.ing = yes
            let privkey = await stoUnlockAccount()
            if(!privkey) {
                t.ing = no
                return showWPerr('Account unlocking failed')
            }
            try {
                // non-main chains get a ChainAllow action appended automatically (main chain returns the body unchanged, behavior identical)
                let txobjpre = { actions: [] }
                if(typeof applyCurrentChainToTxobj === 'function'){
                    txobjpre = await applyCurrentChainToTxobj({ actions: [] })
                    if(txobjpre.err){
                        t.ing = no
                        return showWPerr(txobjpre.err)
                    }
                }
                let actions = txobjpre.actions
                if(t.transferType=='HACD'){
                    actions.push({ kind: 'transfer_hacd_single_to', to: recadr, diamond: amt })
                }else if(t.transferType=='ASSET'){
                    actions.push({
                        kind: 'transfer_asset_to',
                        to: recadr,
                        asset: {
                            serial: t.asset.serial + '',
                            amount: atomicAmount,
                        },
                    })
                }else{
                    actions.push({ kind: 'transfer_hac_to', to: recadr, hacash: amt })
                }
                let timestamp = ctime()
                let fee = gas + ''
                let built = await sdk_tx_build({
                    tx_type: 2, main: t.myadr, fee: fee, timestamp: timestamp, gas_max: 0, actions,
                })
                let feeOpts = t.transferType=='ASSET' ? {extra9: true, tx_type: 2} : nil
                await t.gasw.req(built.body.length/2 + 100, feeOpts)
                fee = t.getgas() + ''
                built = await sdk_tx_build({
                    tx_type: 2, main: t.myadr, fee: fee, timestamp: timestamp, gas_max: 0, actions,
                })
                let txobj = {
                    type: t.transferType,
                    tx_body: built.body,
                    tx_hash: built.hash,
                    payment_address: t.myadr,
                    timestamp: timestamp,
                    collection_address: recadr,
                    amount: t.transferType=='HAC' ? amt : nil,
                    diamonds: t.transferType=='HACD' ? amt : nil,
                    diamond_count: t.transferType=='HACD' ? 1 : 0,
                }
                if(t.transferType=='ASSET'){
                    txobj.asset = {
                        serial: t.asset.serial + '',
                        amount: atomicAmount,
                        decimal: t.asset.decimal,
                        name: t.asset.name,
                        ticket: t.asset.ticket,
                    }
                }
                let rv = await mnx_local_review(built.body, t.myadr)
                if(rv.err){
                    t.ing = no
                    return showWPerr(rv.err)
                }
                if(t.transferType=='ASSET'){
                    let matched = mnx_review_asset_match(rv.review, t.asset.serial, atomicAmount, recadr)
                    if(matched.err){
                        t.ing = no
                        return showWPerr(matched.err)
                    }
                }
                let gastip = hac_show_mei_unit(fee)
                , to = addrOmitted(recadr)
                , cfmtip
                ;
                if(t.transferType=='ASSET'){
                    let name = mnx_esc_html(t.asset.name || ('Asset #' + t.asset.serial))
                    let ticket = mnx_esc_html(t.asset.ticket || '')
                    let amtDisp = mnx_esc_html(formatAssetAtoms(atomicAmount, t.asset.decimal))
                    let unit = ticket || name
                    cfmtip = `<p>Check transfer detail</p><br><table><tr><td>Asset</td><td>${name}${ticket ? ' ('+ticket+')' : ''}</td></tr><tr><td>Serial</td><td>#${mnx_esc_html(t.asset.serial)}</td></tr><tr><td>Amount</td><td>${amtDisp} ${unit}</td></tr><tr><td>Gas</td><td>${gastip}</td></tr><tr><td>To</td><td>${to}</td></tr></table>`
                }else{
                    cfmtip = `<p>Check transfer detail</p><br><table><tr><td>Asset</td><td>${getAmtTip(txobj)}</td></tr><tr><td>Gas</td><td>${gastip}</tr><tr><td>To</td><td>${to}</td></tr></table>`
                }
                let ok = await wpcfm_open(cfmtip, btncon_confirm)
                if(!ok) {
                    t.ing = no
                    return
                }
                let sv = await stoCurAccLocalSignTx(built.body, t.myadr, rv.review, '')
                if(sv.err){
                    t.ing = no
                    return showWPerr(sv.err)
                }
                let sigp = sv.result
                let sdrs = await submitTransaction(sigp.body)
                , err = sdrs.err
                if(err) {
                    t.ing = no
                    if(t.transferType!='ASSET' && err.indexOf('not enough') > 0){
                        err = "Insufficient Balance"
                    }
                    return showWPerr(err)
                }
                txobj.tx_body = sigp.body
                txobj.tx_hash = sigp.hash || built.hash
                await saveTransactionLog(txobj)
                showWPtip("Tx submitted successfully!")
                t.ing = no
                t.isrcd = yes
                _setTimeout(t.back, 777)
            } catch(e) {
                t.ing = no
                return showWPerr(mnx_err_message(e))
            }
        }
    }, async(t)=>{
        clbk && clbk()
        try {
            if(typeof stoReadCurrentChain === 'function'){
                t.chain = await stoReadCurrentChain()
                t.chaintip = chainTip(t.chain)
            }
        } catch(e) {}
        t.myadr = await stoReadCurrentAccount()
        t.gasw = t.$refs.swtgas
        let feeOpts = t.transferType=='ASSET' ? {extra9: true, tx_type: 2} : nil
        t.gasw.req(200, feeOpts)
        if(t.asset && t.asset.decimal != null){
            t.assetAvail = formatAssetAtoms(t.asset.atoms, t.asset.decimal)
        }
    }, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    });


};
