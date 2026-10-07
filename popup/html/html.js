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
    // request-page shared header (jslib/moneynx_pghead.js sets the flag when
    // bundled): account switcher over existing accounts + network switcher
    // over existing networks; component data/methods win the merge, so pages
    // with their own switch logic (signtx/sigtrs/home) keep theirs
    if(window.MNX_PGHEAD && !appobj.mixins){
        appobj.mixins = [window.MNX_PGHEAD]
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
// P2-2: the legacy hacash_api_load()/wasm_bindgen('../jslib/hacash_sdk.wasm')
// boot call is removed (no callers repo-wide; hacash_sdk.wasm was never shipped
// — this stray fetch was the 404 console error in the M0 baseline). The SDK now
// loads exclusively via jslib/hacash_sdk.js (wasm inlined, globalThis.hacash_sdk,
// consumed by jslib/moneynx_sdk_facade.js).

var hacash_api = nil

/////////////////////

let hac_mei_unit = amt => {
    amt += ''
    return (amt.indexOf(':') > 0 ? hacash_api.hac_to_mei(amt) : amt)
}
, hac_show_mei_unit = amt => {
    return hac_mei_unit(amt) + ' HAC'
}
