
// [2026-10-10] 钱包面打开即处理待签署（本文件只打进 moneynex 页，请求页不受
// 影响）。MetaMask 同款交互：home.component.js 的 checkStatusAndNavigate 在
// 存在待确认签署时把打开的钱包面导航到 confirm 路由 —— 我们请求页是独立页
// 面，等价物是整页替换到最早的那笔待签请求。工具栏图标点击（侧边栏/回退
// popup）由此获得「点角标直达待签页」的召回路径。锁定态下请求页自身先要求
// 解锁；板载期不可能有 sign 请求（需先连接），引导流不受影响。
;(async () => {
    try{
        let res = await chrome_runtime_sendmessage({ action: 'mnx_pending_sign' })
        // 绝对地址：实测扩展页相对地址自导航会落 chrome-error（沙盒 CFT 152，
        // 直连绝对地址正常）——getURL 解析后任何环境一致
        if(res && res.url){
            // 接管（fire-and-forget）：后台把该请求的注册表改键到本 tab 并静默
            // 关闭旧弹窗——不发 cancel（先改键后关窗，见 mnx_req_takeover），
            // 通知与角标原样保留，待签请求由本页继续
            chrome_runtime_sendmessage({ action: 'mnx_req_takeover' }).catch(() => {})
            location.replace(chrome.runtime.getURL(res.url))
        }
    }catch(e){}
})()

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
        showWPerr(e.toString())
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
