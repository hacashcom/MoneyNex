
;let wptipex = (function(w){

    let wptip = $id('wptip')
    , wptippop = $clas(wptip, 'popbox')
    , wptipcon = $clas(wptip, 'con')
    , pl = wptippop.classList
    , cl = wptipcon.classList
    , hd = clsname_hide
    , blcls = 'blue'
    , tout = nil
    , wptipcg = (e, cls) => {
        _clearTimeout(tout)
        wptipcon.innerHTML = e||'';
        if(e){
            if(cls) {
                pl.add(cls)
            }else{
                pl.remove(blcls)
            }
            pl.remove(hd)
            tout = _setTimeout(()=>{
                cl.remove(hd)
            }, 15)
        }else{
            pl.add(hd)
            cl.add(hd)
        }
    }
    , stip = (s) => {
        wptipcg(s, blcls)
        tout = _setTimeout(()=>{
            cl.add(hd)
            tout = _setTimeout(()=>{
                pl.add(hd)
            },500)
        },1500)
    };
    $clas(wptip, 'bg').onclick = ()=>{ wptipcg()/*hide*/ };
    
    // showWPerr showWPtip hideWPtip
    return [wptipcg, stip, wptipcg]

})();

let showWPerr = wptipex[0]
, showWPtip = wptipex[1]
, hideWPtip = wptipex[2]
, showWPcopyok = _=> showWPtip(copyoktip)
;



// // test
// _setTimeout(()=>{

//     showWPtip("hahaha")


// }, 123);