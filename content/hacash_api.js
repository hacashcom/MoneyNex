
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


// api 
window.MoneyNex = hacApiObj;

if(window.MoneyNexInit){
    window.MoneyNexInit(wltinfo, hacApiObj)
}

}, 15)
