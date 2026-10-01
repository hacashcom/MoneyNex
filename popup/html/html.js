function parseUrlQuery(url){
    let arr = (url||'').split('?')
    , obj = {}
    if(!arr || arr.length<2) {
        return obj
    }
    let  params = arr[1].split('&')
    for(let i=0;i<params.length;i++){
        let param = params[i].split('=');
        obj[decodeURIComponent(param[0]||'')] = decodeURIComponent(param.slice(1).join('=')||'');
    }
    return obj;
}

// console.log(window.location.search)


var yes = true
, no = false
, nil = null
, ctime = (ms) => {
    let t = new Date().getTime()
    return ms ? t : parseInt(t/1000)
}
, urlquery = parseUrlQuery( window.location.search )

, windowWidth = window.innerWidth

, $id = (s)=>{
    return document.getElementById(s)
}
, $class = (b, n)=>{
    return (n?b:document).getElementsByClassName(n||b)
}
, $clas = (b, n)=>{
    return $class(b,n)[0]
}
, $display_none = (s)=>{
    s.style.display = 'none'
}
, $display_block = (s)=>{
    s.style.display = 'block'
}
, $attr = (s, k, v)=> {
    return v ? s.setAttribute(k, v) : s.getAttribute(k)
}
, $div = (s) => {
    return document.createElement(s)
}
, $irsd = (s) => {
    document.body.appendChild(s);
}
, $html = (s, h) => {
    return h ? (s.innerHTML = h) : s.innerHTML;
}
, injectScript = function(file){
    var s = $div('script');
    // $attr(s, 'type', 'text/javascript');
    $attr(s, 'src', file);
    $irsd(s);
}


, _setInterval = setInterval
, _clearInterval = clearInterval
, _setTimeout = setTimeout
, _clearTimeout = clearTimeout
, seconds = 1000
, minutes = 60*1000
, clsname_hide = 'hide'
, clsname_show = 'show'
, clsname_active = 'active'

, btncon_confirm = 'Confirm'
, copyoktip = 'Copied'

, chrome_storage = chrome.storage
, chrome_storage_sync = chrome_storage.sync
, chrome_storage_local = chrome_storage.local
, chrome_storage_session = chrome_storage.session

, chrome_tabs_create = chrome.tabs.create

/* , _Vue = Vue */

, VueCreateAppEx = (tplf, d,f,m, exps, extds) => {
    let appobj = {
        render: tplf(),
        data() {
            return d
        },
        mounted(e){ 
            m && (m(this))
        },
        methods: f,
        expose: exps
    }
    if(extds) {
        for(let i in extds) {
            appobj[i] = extds[i]
        }
    }
    let app = _Vue.createApp(appobj)
    // , ctx = app.mount('#'+id);
    return app
}
, VueCreateApp = (id, tplf, d,f,m, exps, extds) => {
    let app = VueCreateAppEx(tplf, d,f,m, exps, extds)
    let ctx = app.mount('#'+id);
    app.directive('auto-focus',{
        mounted: (el) => {
            el.focus()
        }
    });
    return {app, ctx}
}

, JSON_parse = (s) => {
    return JSON.parse(s)
}
, JSON_stringify = (s) => {
    return JSON.stringify(s)
}
, sendMessage = async (data) => {
    return await chrome.runtime.sendMessage(data)
}

, returnDataToUserPage = async (data) => {
    // console.log(urlquery.tid, urlquery.did, data)
    data = data || {}
    data.did = parseInt(urlquery.did)
    // The source tab may be closed / lack a content script: sendMessage throws
    // "Receiving end does not exist" — must tolerate it, or the success flow hangs on this await
    try{
        await chrome.tabs.sendMessage(parseInt(urlquery.tid), data)
    }catch(e){
        console.warn('returnDataToUserPage: ', e)
    }
}

, icfpath = '../image/ftic/'

, tsnow = ms => {
    let dv = ms ? 1 : 1000
    return parseInt((new Date()).getTime()/dv)
}
, sleep = time => {
    return new Promise((resolve) => setTimeout(resolve, time));
}


/******** uitl ********/

, hexToBytes = hex => {
    let bytes = [];
    for (let c = 0; c < hex.length; c += 2){
        bytes.push(parseInt(hex.substr(c, 2), 16));
    }
    return Uint8Array.from(bytes);
}
, hexToString = hex => {
    let arr = hex.split("")
    let out = ""
    for (let i = 0; i < arr.length / 2; i++) {
        let tmp = "0x" + arr[i * 2] + arr[i * 2 + 1]
        let charValue = String.fromCharCode(tmp);
        out += charValue;
    }
    return out
}

;

////////

// copy
var copyToClipboardTextContent = ''
document.addEventListener('copy', function(e) {
    e.clipboardData.setData('text/plain', copyToClipboardTextContent);
    e.preventDefault();
});

var copyToClipboard = (s) => {
    copyToClipboardTextContent = s
    document.execCommand('copy');
}



// Common reply protocol for DApp request pages (shared by transfer/signtx/signtext/raisefee/connect):
// Single-reply contract — reply exactly once whether success/cancel/failure (either the result
// data or {ret:1, err}), then close the window; a silent cancel would leave the DApp's request
// hanging forever (callers have their own timeout fallback, but the normal path must cancel visibly).
// If the page is closed outright (X / Ctrl+W), the beforeunload handler makes a best effort to
// send a cancel reply; a failed send is harmless.
// label identifies the page (e.g. 'Transfer request') and goes into the err text of the
// close-fallback reply.
var mnx_dapp_reply = (label) => {
    let answered = no
    , answerOnce = async (data) => {
        if(answered){ return }
        answered = yes
        try{ await returnDataToUserPage(data) }catch(e){}
    }
    , closeWin = () => {
        try{ window.close() }catch(e){}
    }
    , cancelAndClose = (msg) => {
        answerOnce({ret: 1, err: msg, code: 'user_canceled'}).then(closeWin, closeWin)
    }
    try{
        window.addEventListener('beforeunload', ()=>{
            if(!answered){
                try{
                    returnDataToUserPage({ret: 1, err: label + ' canceled (popup closed)', code: 'user_canceled'})
                }catch(e){}
            }
        })
    }catch(e){}
    return {
        isAnswered: () => answered, // once answered, nop only needs to close the window, no extra cancel
        answerOnce: answerOnce,
        closeWin: closeWin,
        cancelAndClose: cancelAndClose,
    }
}



;







/**
 * Hacash SDK
 */

var hacash_api = nil
const hacash_api_load = async function() {
    if(hacash_api){
        return hacash_api
    }
    // await wasm_bindgen(parse_hacash_sdk_wasm_code());
    await wasm_bindgen('../jslib/hacash_sdk.wasm');
    hacash_api = wasm_bindgen
    // test
    // console.log("123456666");
    // let accs = hacash_api_ptr.create_account_by("123456");
    // console.log(accs);
    // let tx1 = hacash_api.general_transfer("1", "123456789", "1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9", "500", "HAC 1:244", "1697200000")
    // console.log(JSON.parse(tx1))
    // console.log(hacash_api.hac_to_mei("HAC 1250:240")) 
    return wasm_bindgen
}

hacash_api_load().then()

/////////////////////

let hac_mei_unit = amt => {
    amt += ''
    return (amt.indexOf(':') > 0 ? hacash_api.hac_to_mei(amt) : amt)
}
, hac_show_mei_unit = amt => {
    return hac_mei_unit(amt) + ' HAC'
}
