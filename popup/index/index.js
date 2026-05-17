
var hpgwstks = ['home']
, hpgw_refreshers = {}
, setHpgwRefresher = (name, fn) => {
    hpgw_refreshers[name] = fn
}
, clearHpgwRefresher = name => {
    delete hpgw_refreshers[name]
}
, refreshHpgw = async name => {
    let fn = hpgw_refreshers[name]
    try {
        fn && await fn()
    } catch(e) {
        console.log(e)
    }
}
, pushhpgw = (name, clbk) => {
    var stkl = hpgwstks.length
    , pre = $id(hpgwstks[stkl-1])
    , elm = $id(name)
    , el = elm.classList
    ;
    hpgwstks.push(name)
    pre.classList.add(clsname_hide)
    el.add(clsname_active)
    setTimeout(()=>{
        clbk && clbk()
        refreshHpgw(name).then()
    },555)

}
, pophpgw = (clbk) => {
    var stkl = hpgwstks.length
    , elm = $id(hpgwstks[stkl-1])
    , base = $id(hpgwstks[stkl-2])
    , el = elm.classList
    ;
    hpgwstks.pop()
    el.remove(clsname_active)
    base.classList.remove(clsname_hide)
    let baseName = hpgwstks[hpgwstks.length-1]
    setTimeout(()=>{
        clbk && clbk()
        refreshHpgw(baseName).then()
    },555)
}
;
