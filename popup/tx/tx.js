var stoCurAccDoSign = async msg => {
    let privkey = await stoUnlockAccount()
    if(!privkey) {
        return {err:'Unlock failed'}
    }
    let res = hacash_api.sign(privkey, msg)
    try{
        return JSON_parse(res)
    }catch(e){
        return {err: res}
    }
}
, signTxBodyByCurrentAccount = async (txbody, signHash) => {
    let signobj = await stoCurAccDoSign(signHash)
    if(signobj.err) {
        return signobj
    }
    return await signTransaction(txbody, {
        signature: true,
        pubkey: signobj.pubkey,
        sigdts: signobj.signature,
    })
}
, allTxSignaturesComplete = sigp => {
    let sigs = (sigp || {}).signatures || {}
    for(let sg in sigs ) {
        if(!sigs[sg].complete) {
            return no
        }
    }
    return yes
}
, signAndSubmitTxBody = async (txbody, signHash) => {
    let sigp = await signTxBodyByCurrentAccount(txbody, signHash)
    if(sigp.err) {
        return sigp
    }
    let subp = await submitTransaction(sigp.body)
    if(subp.err) {
        return subp
    }
    sigp.submit = true
    return sigp
}
, signTxBodyAndMaybeSubmit = async (txbody, signHash, autosubmit) => {
    let sigp = await signTxBodyByCurrentAccount(txbody, signHash)
    if(sigp.err) {
        return sigp
    }
    if(autosubmit && allTxSignaturesComplete(sigp)) {
        let subp = await submitTransaction(sigp.body)
        if(subp.err) {
            return subp
        }
        sigp.submit = true
    }
    return sigp
}
, getAmtTip = (obj) => {
    let dc = obj.diamond_count
    , ds = obj.diamonds
    , amt = obj.amount
    if(dc > 0) {
        let dns = dc > 2 ? `${ds.substring(0,13)}...` : ds
        return `${dc} HACD (${dns})`
    }
    if(amt.indexOf('SAT')>0){
        return amt
    }
    return hac_show_mei_unit(amt)
}
, trslogkey = 'trslogs'
, readTransactionLogs = async () => {
    let logs = await chrome_storage_local.get(trslogkey)
    logs = logs ? logs[trslogkey] : []
    return logs || []
}
, updateTransactionLogs = async (logs) => {
    let sv = {}
    sv[trslogkey] = logs
    await chrome_storage_local.set(sv)
}
, saveTransactionLog = async (tx) => {
    let chain = await stoReadCurrentChain()
    let type = 'MUL'
    , svdata = {
        from: tx.payment_address,
        time: tx.timestamp,
        hash: tx.tx_hash,
        body: tx.tx_body,
        desc: tx.desc || tx.diamonds || '',
        chain_id: chainIdOf(chain),
        chain_name: chain.name,
        chain_remark: chain.remark,
        rpc: chain.rpc,
        stat: 0,
    }
    if(tx.collection_address){
        let ast = getAmtTip(tx)
        svdata.to = tx.collection_address
        svdata.asset = ast
        if(ast.indexOf('HACD')>0){
            type = 'HACD'
        }else if(ast.indexOf('SAT')>0){
            type = 'SAT'
        }else if(ast.indexOf('HAC')>0){
            type = 'HAC'
        }
    }
    svdata.type = type;
    let logs = await readTransactionLogs()
    logs.unshift(svdata)
    if(logs.length>500) {
        logs.pop()
    }
    let sv = {}
    sv[trslogkey] = logs
    await chrome_storage_local.set(sv)
}
, parseTxDesc = tx => {
    let txdesc = []
    if(!tx || !tx.description){
        return []
    }
    let parse = (i, v) => {
        let li = v.replace(/(\s[0-9\.]+)HAC\s/g, ` <b class="amt">$1</b> HAC `)
            .replace(/([a-km-zA-HJ-NP-Z1-9]{28,34})/g, ` <a class="addr" href="${explorer_url}/address/$1" target="_blank" title="$1">$1</a> `)
        return `<span>${1+i}</span> ${li}`
    }
    txdesc.push(parse(0, tx.description))
    for(let i in tx.actions){
        let li = tx.actions[i]
        txdesc.push(parse(parseInt(i)+1, li.description))
    }
    return txdesc
}
;
