
function divlist(opks) {
    var ks = []
    for(var i in opks){
        ks.push(`<div class="${opks[i]}"></div>`)
    }
    return ks.join("\n")
}

function registerHacashApi(key, exec) {
    // 通过事件绑定执行接口
    var elm = $clas(hacash_api_div, key)
    elm.onclick = function(e){
        var t = this
        , ps = {}
        try {
            let p = JSON_parse($attr(t, paramsk))
            if(p && typeof p == 'object') {
                ps = p
            }
        }catch(e){
            return null
        }
        // 执行
        ps.did = parseInt($attr(t, 'did')) || 0
        ps.action = $attr(t, 'class')
        // console.log(ps)
        exec(ps)
        e.stopPropagation()
        return false
    }
}


/**
 * insert div callback
 */
let hacash_api_html = divlist(optkey_list_to_popup)
, hacash_api_div = $div('div')
hacash_api_div.id = optkey_id
$attr(hacash_api_div, 'icon', chrome.runtime.getURL('image/icos/128.png'))
$attr(hacash_api_div, 'version', '0.1.0')
$display_none(hacash_api_div)
$html(hacash_api_div, hacash_api_html)
$irsd(hacash_api_div)


/**
 * reg APIs
 */
function sendmsg(params){
    // console.log("sendmsg:", params)
    chrome.runtime.sendMessage(params)
}
function registerCommonHacashApis(apikeys) {
    for(var i in apikeys){
        registerHacashApi(apikeys[i], sendmsg)
    }
}


/**
 * open_wallet, do_transfer
 */
registerCommonHacashApis(optkey_list_to_popup)


/**
 * api data ariive
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // console.log('Received message:', message);
    if(!message.did) {
        return
    }
    $attr(hacash_api_div, 'did', message.did,)
    $attr(hacash_api_div, 'data', JSON_stringify(message))
    // callback
    hacash_api_div.click()
});
  


/**
 * inject api
 */
injectScript( chrome.runtime.getURL('content/hacash_api.min.js'));



// ok
console.log("hacash api runtime ok.")



























// document.body.onclick = function(){
//     console.log("chrome.action", chrome.action)

    // chrome-extension://bafhnhhcnjhlbhibnncmmdjjajcdmijp/popup/moneynex.html


    // window.open(
    //     'chrome-extension://bafhnhhcnjhlbhibnncmmdjjajcdmijp/popup/moneynex.html',
        
    // )
    // window.open(
    //     'chrome-extension://bafhnhhcnjhlbhibnncmmdjjajcdmijp/popup/moneynex.html',
    //     'MoneyNex',
    //     'height=600,width=400,top=100,left=200,toolbar=no,menubar=no, scrollbars=no,resizable=no,location=no, status=no'
    // )

// }




// window.hacash = {
//     open_wallet() {
//         chrome.runtime.sendMessage({
//             action: "open_wallet",
//         })
//     }
// }
