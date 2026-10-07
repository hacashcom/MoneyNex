
const messageHandler = {}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action } = request
    , handler = messageHandler[action]
    if(handler){
        // console.log(request, sender, sendResponse)
        handler(request, sender, sendResponse).then()
    }else{
        sendResponse({
            err: `unknow action <${action}>`
        });
    }
    return true;
});


// popup api: origin binding + connect gate
// (origin always comes from background's sender; the dmu self-reported by content is untrusted)
function dealHandleHacashApiToPopup(apis) {
    for(let i in apis){
        let one = apis[i]
        messageHandler[one] = async function(req, sender, ok){
            let origin = senderOriginOf(sender)
            , tabid = (sender && sender.tab && sender.tab.id) || 0
            if(!origin){
                ok({err: 'unknown request origin'})
                return
            }
            req.dmu = origin
            // connect is the explicit grant request: it always opens the approval
            // page (no whitelist gate) and shares the same-origin window
            // replacement — two rapid connects must leave exactly one window
            // (found as a real window-pileup in A5 sandbox testing: falling
            // straight through to openWalletPopupPageInNextTab let a second
            // window stack beside the first and its stale answer poisoned later
            // flows)
            if(one == optkey_connect_account){
                // §7.2 "repeat request, no second popup": an already-authorized origin's repeated
                // connect() resolves {address} immediately (address follows the
                // current account, A3 decision) without reopening the approval
                // window. After a Disconnect, isConnectAuthorized(origin) is false
                // again → the next connect reopens the approval window (§7.3-A6).
                if(await isConnectAuthorized(origin)){
                    let address = await stoReadCurrentAccount()
                    if(tabid){
                        await sendMessageToTabContent(tabid, req, {address})
                    }
                    ok({})
                    return
                }
                await openConnectApproval(req, tabid)
                ok({})
                return
            }
            // Unauthorized domains go through connect first (wallet authorization is handled separately in account.js)
            if(!(await isConnectAuthorized(origin))){
                // Notify the DApp "connect required first" (must reply via content's did channel:
                // content-side sendMessage leaves no callback, so sendResponse would be dropped
                // and the caller would wait forever), then open the connect approval page;
                // once approved, the user returns to the page and retries.
                if(tabid){
                    await sendMessageToTabContent(tabid, req, {err: 'need connect first', code: 'need_connect'})
                }
                req.action = optkey_connect_account
                // P3-2: reclaim any stale pending connect window for this origin first
                await openConnectApproval(req, tabid)
                ok({})
                return
            }
            // console.log(req)
            await openWalletPopupPageInNextTab(req, tabid)
            ok({})
        }
    }
}

