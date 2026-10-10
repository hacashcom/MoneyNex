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

// B (Phase 3, revised): the in-wallet "Connected" indicator follows the active
// browser tab. None of these need the 'tabs' permission (events fire and
// id-only queries work without it; url/title fields stay hidden — the origin
// comes from the background's registry, sender-derived).
, chrome_tabs_query = chrome.tabs.query
, chrome_tabs_onActivated = chrome.tabs.onActivated
, chrome_tabs_onUpdated = chrome.tabs.onUpdated
, chrome_runtime_sendmessage = (msg) => new Promise((res, rej) => {
    try{
        chrome.runtime.sendMessage(msg, (r) => {
            void (chrome.runtime && chrome.runtime.lastError)
            res(r)
        })
    }catch(e){
        rej(e)
    }
})

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

, returnDataToUserPage = async (data) => {
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

// Copy + the shared "Copied" toast (the pages' copy-chip behavior; showWPtip
// is bundled with every page via popup_common comp/wptip)
var copyShowTip = (s) => {
    copyToClipboard(s)
    showWPtip(copyoktip)
}



// Common reply protocol for DApp request pages (shared by transfer/signtx/signtext/raisefee/connect):
// Single-reply contract — reply exactly once whether success/cancel/failure (either the result
// data or {ret:1, err}), then close the window; a silent cancel would leave the DApp's request
// hanging forever (callers have their own timeout fallback, but the normal path must cancel visibly).
// If the page is closed outright (X / Ctrl+W), the background's removal listener
// (firePendingCancel) delivers the cancel — see the comment inside.
// label identifies the page (e.g. 'Transfer request') and goes into the err text of the
// close-fallback reply; cancelMsg is the user-facing text of the explicit Cancel reply.
var mnx_dapp_reply = (label, cancelMsg) => {
    let answered = no
    , answerOnce = async (data) => {
        if(answered){ return }
        answered = yes
        try{ await returnDataToUserPage(data) }catch(e){}
        // 回答完成即回收（2026-10-10）：后台按 tid/did 清掉本请求的通知与角标；
        // 从侧边栏等嵌入面应答时，同一请求的旧弹窗也被后台关闭
        try{
            chrome.runtime.sendMessage({ action: 'mnx_req_done', tid: parseInt(urlquery.tid) || 0, did: parseInt(urlquery.did) || 0 }, () => {
                void (chrome.runtime && chrome.runtime.lastError)
            })
        }catch(e){}
        // mlkey 布局通道的敏感明文此时才清（不在加载时清——召回路由的重放页
        // 靠它渲染同一请求文本；加载即清会让重放页拿到空文本而误判拒绝）
        try{
            if(urlquery.mlkey && typeof chrome_storage_session !== 'undefined'){
                chrome_storage_session.remove(urlquery.mlkey)
            }
        }catch(e){}
    }
    , closeWin = () => {
        try{ window.close() }catch(e){}
        // 弹窗/独立窗环境 window.close() 即时生效；请求页被路由进侧边栏/标签时
        // close 无效 —— 应答完成后回钱包主页（MetaMask 语义：待签处理完回到钱包
        // 面）。绝对地址：实测扩展页相对地址自导航会落 chrome-error。
        _setTimeout(() => {
            try{
                if(!window.closed){ location.replace(chrome.runtime.getURL('popup/moneynex.html')) }
            }catch(e){}
        }, 350)
    }
    , cancelAndClose = (msg) => {
        answerOnce({ret: 1, err: msg, code: 'user_canceled'}).then(closeWin, closeWin)
    }
    // the pages' shared Cancel handler: once answered, nop only closes the window
    // (no second reply); otherwise it cancels visibly and closes.
    , nop = () => {
        if(answered){ closeWin(); return }
        cancelAndClose(cancelMsg || (label + ' canceled'))
    }
    // 关闭即取消由后台统一负责（tabs/windows.onRemoved → firePendingCancel，
    // 见 init.js）——页面侧不再挂 beforeunload 补发 cancel：双发是冗余，且会
    // 破坏召回接管（mnx_req_takeover 先改键后关旧窗，旧窗 onRemoved 已查不到
    // 键、不发 cancel；beforeunload 的直发绕过了这层保护，会在接管时误杀请求）
    return {
        isAnswered: () => answered,
        answerOnce: answerOnce,
        closeWin: closeWin,
        cancelAndClose: cancelAndClose,
        nop: nop,
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
