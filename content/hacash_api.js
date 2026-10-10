
var hacashApiMessageHandlerCallback = {}



// register
_setTimeout(function(){



let apidiv = $id(optkey_id)
;

/**
 * api callback
 */
apidiv.onclick = function(e){
    var t = this
    , didk = ($attr(t, 'did') || 0) + ''
    , data = JSON_parse($attr(t, 'data')||'{}') || {}
    , callfn = hacashApiMessageHandlerCallback[didk]
    // console.log("apidiv.onclick ", didk, data, callfn)
    if(callfn){
        delete hacashApiMessageHandlerCallback[didk]
        callfn(data)
    }
    e.stopPropagation()
    return false
}


/**
 * 
 * api callback
 */
var hacApiObj = {}
, apiDataAutoIncrement = 0
for(var i in optkey_list_to_popup) {
    var one = optkey_list_to_popup[i];
    (function(action){
        hacApiObj[action] = function(params, callback) {
            apiDataAutoIncrement++
            params = params || {}
            params.did = apiDataAutoIncrement
            params.dmu = location.host || 'hacash.com'
            let done = false
            let finishOk, finishErr
            let p = new Promise((resolve, reject) => {
                finishOk = resolve
                finishErr = reject
            })
            hacashApiMessageHandlerCallback[''+apiDataAutoIncrement] = function(data) {
                if(done){ return }
                done = true
                if(callback){ callback(data) }
                if(data && data.err){ finishErr(data) }
                else { finishOk(data) }
            }
            var li = $clas(apidiv, action)
            $attr(li, 'did', apiDataAutoIncrement)
            $attr(li, paramsk, JSON_stringify(params))
            li.click()
            return p
        }
    })(one);
}


//
var icon_url = $attr(apidiv, 'icon')
// , cid = icon_url.match(/\:\/\/([^\/]+)\//)[1];
// console.log(cid)
var wltinfo = {
    // 'chrome_id': cid,
    'icon': icon_url,
    'name': 'MoneyNex',
    'version': $attr(apidiv, 'version'),
}
hacApiObj.info = wltinfo;


/**
 * B (Phase 3): additive event surface — MoneyNex.on(event, cb) / .off(event, cb).
 * First event: 'disconnect' → cb({origin}) when the site's connection is revoked
 * (floatbar exit button, connected-sites management, or the account page).
 * Deliveries: the registered callback AND a page-wide CustomEvent
 * 'MoneyNexDisconnect' (detail {origin}) on window, so frameworks can listen
 * without touching the SDK object. Strictly additive: the 8 request APIs and
 * their reply contracts are untouched.
 */
var hacApiEvtListeners = {}
function fireHacApiEvent(name, detail) {
    var arr = hacApiEvtListeners[name]
    if(arr){
        var cbs = arr.slice()
        for(var i = 0; i < cbs.length; i++){
            try{ cbs[i](detail) }catch(e){ console.warn('MoneyNex.on(' + name + ') callback error: ', e) }
        }
    }
    if(name == 'disconnect'){
        try{
            window.dispatchEvent(new CustomEvent('MoneyNexDisconnect', { detail: detail }))
        }catch(e){
            console.warn('MoneyNexDisconnect dispatch error: ', e)
        }
    }
}
// bind the wallet→page event div (created by the content script next to the api
// div; absent when the page was loaded by an older extension build — events are
// simply not delivered then, request APIs keep working)
var evtdiv = $id(optkey_evt_id)
if(evtdiv){
    evtdiv.onclick = function(e){
        var t = this
        , raw = $attr(t, 'sdk_event') || ''
        $attr(t, 'sdk_event', '')
        var ev = null
        try{ ev = JSON_parse(raw) }catch(ex){}
        if(ev && ev.event){
            fireHacApiEvent(ev.event, ev.detail || {})
        }
        e.stopPropagation()
        return false
    }
}
hacApiObj.on = function(event, cb) {
    // only known events are subscribable; anything else is silently ignored so
    // a future event name can't turn a typo into a never-firing listener
    if(event == 'disconnect' && typeof cb == 'function'){
        var arr = hacApiEvtListeners[event]
        if(!arr){ arr = hacApiEvtListeners[event] = [] }
        if(arr.indexOf(cb) < 0){ arr.push(cb) } // off-on symmetry: no duplicate delivery
    }
    return hacApiObj
}
hacApiObj.off = function(event, cb) {
    var arr = hacApiEvtListeners[event]
    if(arr){
        var ix = arr.indexOf(cb)
        if(ix >= 0){ arr.splice(ix, 1) }
    }
    return hacApiObj
}


// api
window.MoneyNex = hacApiObj;

if(window.MoneyNexInit){
    window.MoneyNexInit(wltinfo, hacApiObj)
}

}, 15)
