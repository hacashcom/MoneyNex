
function divlist(opks) {
    var ks = []
    for(var i in opks){
        ks.push(`<div class="${opks[i]}"></div>`)
    }
    return ks.join("\n")
}

function registerHacashApi(key, exec) {
    // expose the API via event bindings
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
        // execute
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
$attr(hacash_api_div, 'icon', chrome.runtime.getURL('image/icos/logo.svg'))
// P2-1: report the real manifest version (was hardcoded '0.1.0' vs manifest 0.4.0);
// MoneyNex.info.version field name unchanged (I-1)
$attr(hacash_api_div, 'version', chrome.runtime.getManifest().version)
$display_none(hacash_api_div)
$html(hacash_api_div, hacash_api_html)
$irsd(hacash_api_div)


/**
 * wallet→page event div (B, Phase 3): must exist before hacash_api.min.js runs
 * (its 15ms bind timer looks it up); created here next to the api div for the
 * same ordering guarantee.
 */
var hacash_evt_div = $div('div')
hacash_evt_div.id = optkey_evt_id
$display_none(hacash_evt_div)
$irsd(hacash_evt_div)


/**
 * reg APIs
 */
function sendmsg(params){
    // 扩展重载/升级后旧内容脚本成孤儿：chrome.* 访问直接抛
    // "Extension context invalidated"（线上实例：defi.hacd.it/bridge）。
    // 不能只吞——把错误经事件桥回给页面世界，让 dApp 的 pending promise
    // 可见地 reject（而非永远挂起）；页面重载后 SDK 自动恢复。
    try{
        chrome.runtime.sendMessage(params)
    }catch(e){
        console.warn('MoneyNex: extension context invalidated — reload the page to restore the SDK', e)
        try{
            $attr(hacash_api_div, 'did', params.did || 0)
            $attr(hacash_api_div, 'data', JSON_stringify({
                did: params.did || 0,
                ret: 1,
                err: 'extension context invalidated — reload the page',
                code: 'context_invalidated',
            }))
            hacash_api_div.click()
        }catch(e2){}
    }
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



