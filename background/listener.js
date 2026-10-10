
const messageHandler = {}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action } = request
    , handler = messageHandler[action]
    if(handler){
        // console.log(request, sender, sendResponse)
        handler(request, sender, sendResponse).then()
    }else{
        sendResponse({
            err: `unknow action <${action}>`
        });
    }
    return true;
});


// ---- 钱包面打开时的待签召回（对齐 MetaMask checkStatusAndNavigate）----------
// MetaMask 的 home.component.js 在 unconfirmedTransactionsCount>0 时把打开的
// 钱包面 push 到 confirm 路由 —— 无论 popup/全屏/通知窗。我们的请求页是独立
// 页面（popup/<kind>.html?tid=&did=…），等价物是让 moneynex.html 启动时查询
// 本 handler 并 location.replace 到待签页。url 取自 pending 注册表（开窗时
// 存下的完整参数串，含 mlkey 布局通道，无法从 tid/did 重建）。
// 仅扩展页可查（senderIsOwnPage，sites.js）；网页侧不得探测钱包的待签状态。
messageHandler['mnx_pending_sign'] = async function(req, sender, ok){
    let out = { count: 0, url: '' }
    if(senderIsOwnPage(sender)){
        // 同一请求以窗口/tab 双键注册（reqReplyKeys），按 rid 去重后计数
        let obj = await chrome.storage.session.get(PENDING_REQ_KEY)
        , tbl = (obj && obj[PENDING_REQ_KEY]) || {}
        , best = null
        , seen = {}
        for(let k in tbl){
            let e = tbl[k]
            if(!e || !REQ_SIGN_KINDS[e.kind] || seen[e.rid]){ continue }
            seen[e.rid] = 1
            out.count++
            if(!best || e.rid < best.rid){ best = e } // rid 含时间戳，最小者最老
        }
        if(best){ out.url = best.url || '' }
    }
    ok(out)
}

// 请求召回接管（boot 钩子路由到待签页前发出）：发起方 tab 接管最老的待签请求
// —— 注册表改键到本 tab、旧弹窗静默关闭。次序是关键：先改键后关窗，旧窗的
// onRemoved 走 firePendingCancel 时已查不到自己的键，不会给 dApp 发 cancel
// （请求仍活着，由接管页继续；通知与角标原样保留）。
messageHandler['mnx_req_takeover'] = async function(req, sender, ok){
    let tabid = sender && sender.tab && sender.tab.id
    if(senderIsOwnPage(sender) && tabid != null){
        await withPendingReqLock(async () => {
            let obj = await chrome.storage.session.get(PENDING_REQ_KEY)
            , tbl = (obj && obj[PENDING_REQ_KEY]) || {}
            , best = null
            if(tbl['t' + tabid]){ return } // 本 tab 已持有请求（重复路由幂等）
            for(let k in tbl){
                let e = tbl[k]
                if(!e || !REQ_SIGN_KINDS[e.kind]){ continue }
                if(!best || e.rid < best.rid){ best = e }
            }
            if(!best){ return }
            let oldWinIds = []
            for(let k in tbl){
                if(tbl[k] && tbl[k].rid === best.rid){
                    if(('' + k).indexOf('t') != 0){ oldWinIds.push(parseInt(k)) }
                    delete tbl[k]
                }
            }
            tbl['t' + tabid] = best
            await chrome.storage.session.set({ [PENDING_REQ_KEY]: tbl })
            for(let winId of oldWinIds){
                try{ await chrome.windows.remove(winId) }catch(e){}
            }
        }).catch(e => {
            console.warn('mnx_req_takeover: ', e)
        })
    }
    ok({})
}

// 请求页应答完成上报（mnx_dapp_reply.answerOnce 回包后发出）：清掉本请求的
// 通知与角标；从侧边栏等嵌入面应答时，同一请求的旧弹窗仍开着 —— 顺手关闭，
// 避免一个展示着已应答请求的僵尸窗。dApp 的 did 通道首包生效，旧窗关闭路径
// 的 firePendingCancel 晚到 cancel 会被 dApp 侧已删的 did 回调表丢弃（无害）。
messageHandler['mnx_req_done'] = async function(req, sender, ok){
    if(senderIsOwnPage(sender)){
        let tid = parseInt((req && req.tid) || 0) || 0
        , did = parseInt((req && req.did) || 0) || 0
        if(tid && did){
            await withPendingReqLock(async () => {
                let obj = await chrome.storage.session.get(PENDING_REQ_KEY)
                , tbl = (obj && obj[PENDING_REQ_KEY]) || {}
                , rids = {}
                , winIds = []
                , hit = false
                for(let k in tbl){
                    let e = tbl[k]
                    if(!e || e.tid !== tid || e.did !== did){ continue }
                    hit = true
                    rids[e.rid] = 1
                    if(('' + k).indexOf('t') != 0){ winIds.push(parseInt(k)) }
                    delete tbl[k]
                }
                if(hit){
                    await chrome.storage.session.set({ [PENDING_REQ_KEY]: tbl })
                    for(let rid in rids){ clearReqNotification(rid) }
                    updateRequestBadge()
                    for(let winId of winIds){
                        try{ await chrome.windows.remove(winId) }catch(e){}
                    }
                }
            }).catch(e => {
                console.warn('mnx_req_done: ', e)
            })
        }
    }
    ok({})
}


// popup api: origin binding + connect gate
// (origin always comes from background's sender; the dmu self-reported by content is untrusted)
function dealHandleHacashApiToPopup(apis) {
    for(let i in apis){
        let one = apis[i]
        messageHandler[one] = async function(req, sender, ok){
            let origin = senderOriginOf(sender)
            , tabid = (sender && sender.tab && sender.tab.id) || 0
            if(!origin){
                ok({err: 'unknown request origin'})
                return
            }
            req.dmu = origin
            // connect is the explicit grant request: it always opens the approval
            // page (no whitelist gate) and shares the same-origin window
            // replacement — two rapid connects must leave exactly one window
            // (found as a real window-pileup in A5 sandbox testing: falling
            // straight through to openWalletPopupPageInNextTab let a second
            // window stack beside the first and its stale answer poisoned later
            // flows)
            if(one == optkey_connect_account){
                // §7.2 "repeat request, no second popup": an already-authorized origin's repeated
                // connect() resolves {address} immediately (address follows the
                // current account, A3 decision) without reopening the approval
                // window. After a Disconnect, isConnectAuthorized(origin) is false
                // again → the next connect reopens the approval window (§7.3-A6).
                if(await isConnectAuthorized(origin)){
                    let address = await stoReadCurrentAccount()
                    if(tabid){
                        await sendMessageToTabContent(tabid, req, {address})
                    }
                    ok({})
                    return
                }
                await openConnectApproval(req, tabid)
                ok({})
                return
            }
            // Unauthorized domains go through connect first (wallet authorization is handled separately in account.js)
            if(!(await isConnectAuthorized(origin))){
                // Notify the DApp "connect required first" (must reply via content's did channel:
                // content-side sendMessage leaves no callback, so sendResponse would be dropped
                // and the caller would wait forever), then open the connect approval page;
                // once approved, the user returns to the page and retries.
                if(tabid){
                    await sendMessageToTabContent(tabid, req, {err: 'need connect first', code: 'need_connect'})
                }
                req.action = optkey_connect_account
                // P3-2: reclaim any stale pending connect window for this origin first
                await openConnectApproval(req, tabid)
                ok({})
                return
            }
            // console.log(req)
            await openWalletPopupPageInNextTab(req, tabid)
            ok({})
        }
    }
}

