/**
 * define
 */
const chrome_storage_local = chrome.storage.local
, chrome_storage_sync = chrome.storage.sync


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

async function sendMessageToTabContent(tabid, req, msg) {
    if(!tabid){ return }
    msg.did = req.did
    try{
        await chrome.tabs.sendMessage(tabid, msg)
    }catch(e){
        // Target tab has no content script / is closed: reply lost; the caller (DApp) has its own timeout fallback
        console.warn('sendMessageToTabContent: ', e)
    }
}

async function sendMessageToCurrentTabContent(req, msg) {
    let curtab = await getCurrentTab()
    if(curtab && curtab.id){
        await sendMessageToTabContent(curtab.id, req, msg)
    }
}

async function openWalletPopupPageInNextTab(req, tabid) {
    // console.log(req)
    req = req || {}
    // Prefer the request's source tab (sender.tab.id): when a DApp runs in a
    // background tab / another window, the popup and reply must bind to the source
    // page, not the "current active page" (or the reply lands on the wrong page).
    let curtab = null
    if(tabid){
        try{ curtab = await chrome.tabs.get(tabid) }catch(e){}
    }
    if(!curtab){
        curtab = await getCurrentTab()
    }
    // Both lookups fail (edge cases like no active window): fall back to a plain new
    // tab without index, so a curtab.index throw can't kill the whole background
    // handler and leave the DApp hanging forever
    let cidx = curtab ? curtab.index : 0
    , tabid2 = curtab ? curtab.id : 0
    , actpage = req.action || 'moneynex'
    , params = `?tid=${tabid2}`;
    delete req.action
    // Objects like layout tables can't go in the URL: store in session, popup reads via mlkey
    // Same for signtext multi-line text (URLs are unsuitable for long text / newlines)
    let extra = {}
    const layoutKeys = {
        msglayout: 1, msg_layout: 1, msglayouts: 1, msg_layouts: 1,
        msgid: 1, msg_id: 1, message_id: 1, action_id: 1,
        text: 1,
    }
    for(let k in req){
        if(layoutKeys[k] || (req[k] != null && typeof req[k] === 'object')){
            extra[k] = req[k]
            delete req[k]
        }
    }
    if(Object.keys(extra).length){
        let mlkey = 'ml_' + tabid2 + '_' + (req.did || 0)
        try {
            await chrome.storage.session.set({ [mlkey]: extra })
            params += `&mlkey=${mlkey}`
        } catch(e) {}
    }
    for(let k in req){
        params += `&${k}=${req[k]}`
    }
    return chrome.tabs.create({
        url: `popup/${actpage}.html` + params,
        index: cidx + 1,
        openerTabId: tabid2,
    });
}

// P3-2: stale connect approval windows. Every "not authorized" call opens a connect
// page; if the user disconnects/reconnects repeatedly the same origin piles up
// unanswered connect tabs whose replies race onto old did channels. Track the
// latest pending connect tab per origin and close the previous one before opening
// a new approval (the closed page's beforeunload cancel reply frees the old did).
const pendingConnectTabs = {}
chrome.tabs.onRemoved.addListener((tabId) => {
    for(let origin in pendingConnectTabs){
        if(pendingConnectTabs[origin] === tabId){
            delete pendingConnectTabs[origin]
        }
    }
})

async function openConnectApproval(req, tabid) {
    let origin = (req && req.dmu) || ''
    if(!origin){
        return await openWalletPopupPageInNextTab(req, tabid)
    }
    // Reclaim a still-pending approval window for the same origin (best effort:
    // it may already have been closed/answered by the user — remove throws then).
    let oldId = pendingConnectTabs[origin]
    if(oldId){
        delete pendingConnectTabs[origin]
        try{ await chrome.tabs.remove(oldId) }catch(e){}
    }
    let tab = await openWalletPopupPageInNextTab(req, tabid)
    if(tab && tab.id){ pendingConnectTabs[origin] = tab.id }
    return tab
}

// connect whitelist authorization check: compatible with legacy location.host records and new origin records
async function isConnectAuthorized(origin) {
    let dms = await chrome_storage_local.get('connect_domains')
    dms = (dms && dms['connect_domains']) || []
    let host = ''
    try { host = new URL(origin).host } catch(e){}
    let bare = origin.replace(/^https?:\/\//, '')
    return dms.indexOf(origin) >= 0 || dms.indexOf(host) >= 0 || dms.indexOf(bare) >= 0
}


chrome.runtime.onInstalled.addListener(async ({reason}) => {
    if (reason === 'install') {
        await openWalletPopupPageInNextTab()
    }
});
