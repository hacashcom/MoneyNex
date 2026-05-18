var jsdttyhdr = {
    "Content-Type": "application/json"
}
, reqFeasibleFee = async (txsz) => {
    let url = fullnode_url+"/query/fee/average?unit=mei"
    if(txsz > 0){
        url += `&consumption=${txsz}`
    }
    return do_fetch_get(url)
}
, proxyFullnodeApiPost = (path, bodydata, params) => {
    let url = fullnode_url+path+"?";
    params = params || {}
    for(let k in params){
        url += `${k}=${params[k]}&`
    }
    return do_fetch_post(url, bodydata, jsdttyhdr)
}
, queryTransaction = async (txhash) => {
    let url = fullnode_url+"/query/transaction?unit=mei&body=true&&hash=" + txhash
    return do_fetch_get(url)
}
, submitTransaction = async (txbody) => {
    return proxyFullnodeApiPost(
        "/submit/transaction", hexToBytes(txbody)
    )
}
, createTransaction = async (txjson) => {
    return proxyFullnodeApiPost(
        "/create/transaction", JSON_stringify(txjson), {unit: 'mei', action: true, description: true, signature: true}
    )
}
, checkTransaction = async (txbody, params) => {
    return proxyFullnodeApiPost(
        "/util/transaction/check", hexToBytes(txbody), params
    )
}
, signTransaction = async (txbody, params) => {
    return proxyFullnodeApiPost(
        "/util/transaction/sign", hexToBytes(txbody), params
    )
}
;
