
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


// popup api
function dealHandleHacashApiToPopup(apis) {
    for(let i in apis){
        let one = apis[i]
        messageHandler[one] = async function(req, sender, ok){
            // console.log(req)
            await openWalletPopupPageInNextTab(req)
            ok({})
        }
    }
}


 