// const API = 12

function dealAccountApi() {


messageHandler[msg_create_account_by] = async function(req, sender, ok){
    let api = await hacash_api()
    , acc = api.create_account_by(req.stuff)
    ok(JSON.parse(acc))
}


messageHandler['wallet'] = async function(req, sender, ok){
    // console.log(`!!!!!messageHandler['wallet']`, req)
    let address = await stoReadCurrentAccount()
    await sendMessageToCurrentTabContent(req, {address});
    ok({})
    // ok({address:'1x...address'})
}




}





