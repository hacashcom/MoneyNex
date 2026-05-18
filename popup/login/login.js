
var cti = ctime(yes)
, btlgboot = $id('boot')
, btlginit = $id('init')
, btlglogok = $id('logok')
, loginSwitchCloseAll  = ()=>{
    let ct = ctime(yes)
    , bcl = btlgboot.classList
    , rct = 0 - (ct - cti)
    rct = rct<0 ? 0 : rct
    // console.log("rct ", rct)
    _setTimeout(()=>{
        bcl.add(clsname_hide)
    }, rct)
} 
, loginSwitchToInit = async (force)=>{
    await stoReadCurrentChain()
    await routePageInit(loginSwitchCloseAll, force)
    // vue
    $display_block(btlginit)
}





// load show
_setTimeout(loginSwitchToInit, 10);
