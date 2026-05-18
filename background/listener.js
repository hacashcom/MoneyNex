
const messageHandler = {}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action } = request
    , handler = messageHandler[action]
    if(handler){
        handler(request, sender, sendResponse).then()
    }else{
        sendResponse({
            err: `unknown action <${action}>`
        });
    }
    return true;
});


// popup api
function dealHandleHacashApiToPopup(apis) {
    for(let i in apis){
        let one = apis[i]
        messageHandler[one] = async function(req, sender, ok){
            await openWalletPopupPageInNextTab(req, sender)
            ok({})
        }
    }
}
