
var hpgwstks = ['home']
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
    setTimeout(()=>{
        clbk && clbk()
    },555)
}
;

