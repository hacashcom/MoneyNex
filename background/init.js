/**
 * define
 */
const chrome_storage_local = chrome.storage.local
, chrome_storage_sync = chrome.storage.sync


/**
 * Hacash SDK
 */

var hacash_api_ptr = null
const hacash_api = async function() {
    if(hacash_api_ptr){
        return hacash_api_ptr
    }
    // await wasm_bindgen(parse_hacash_sdk_wasm_code());
    await wasm_bindgen('../jslib/hacash_sdk.wasm');
    // test
    // console.log("123456666");
    // let accs = hacash_api.create_account_by("123456");
    // console.log(accs);
    // let tx1 = hacash_api.hac_transfer("1", "123456789", "1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9", "ㄜ1:248", "ㄜ1:244", "1697200000")
    // console.log(tx1)
    hacash_api_ptr = wasm_bindgen
    return wasm_bindgen
}

async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}

async function stoReadCurrentAccount() {
    let acccurkey = 'current_account'
    let obj = await chrome_storage_sync.get(acccurkey)
    return obj[acccurkey]
}

function getDappDomainFromSender(sender) {
    try {
        let url = new URL(((sender || {}).tab || {}).url || '')
        return url.host || 'hacash.com'
    }catch(e){
        return 'hacash.com'
    }
}

async function getOpenerTabIdFromStorage() {
    let tid = await chrome_storage_local.get('origin_tab_id')
    // console.log(tid)
    // console.log(tid.origin_tab_id)
    return tid.origin_tab_id
}

async function sendMessageToCurrentTabContent(req, msg, sender) {
    let tabid = ((sender || {}).tab || {}).id
    if(tabid === undefined || tabid === null) {
        let curtab = await getCurrentTab()
        tabid = curtab.id
    }
    msg.did = req.did
    chrome.tabs.sendMessage(tabid, msg);
}

async function openWalletPopupPageInNextTab(req, sender) {
    // console.log(req)
    req = req || {}
    let curtab = ((sender || {}).tab) || await getCurrentTab()
    , cidx = curtab.index
    , tabid = curtab.id
    , actpage = req.action || 'moneynex'
    , params = `?tid=${tabid}`;
    req.dmu = getDappDomainFromSender(sender)
    delete req.action
    for(let k in req){
        params += `&${encodeURIComponent(k)}=${encodeURIComponent(req[k])}`
    }
    // chrome.storage.local.set({'origin_tab_id': tabid})
    // console.log(curtab)
    chrome.tabs.create({
        url: `popup/${actpage}.html` + params,
        index: cidx + 1,
        openerTabId: tabid,
    });
}

async function returnDataToUserPage(did, data) {
    let tabid = await getOpenerTabIdFromStorage()
}


chrome.runtime.onInstalled.addListener(async ({reason}) => {
    if (reason === 'install') {
        await openWalletPopupPageInNextTab()
    }
});
  

