
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
// (origin always comes from background's sender.url; the dmu self-reported by content is untrusted)
function dealHandleHacashApiToPopup(apis) {
    for(let i in apis){
        let one = apis[i]
        messageHandler[one] = async function(req, sender, ok){
            let origin = ''
            , tabid = 0
            try {
                if(sender && sender.url){
                    origin = new URL(sender.url).origin
                }
                if(sender && sender.tab && sender.tab.id){
                    tabid = sender.tab.id
                }
            } catch(e){}
            if(!origin){
                ok({err: 'unknown request origin'})
                return
            }
            req.dmu = origin
            // Unauthorized domains go through connect first (wallet authorization is handled separately in account.js)
            if(one != optkey_connect_account && !(await isConnectAuthorized(origin))){
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

