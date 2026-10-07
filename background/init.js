/**
 * define
 */
const chrome_storage_local = chrome.storage.local
, chrome_storage_sync = chrome.storage.sync


async function getCurrentTab() {
    let queryOptions = { active: true, lastFocusedWindow: true };
    // `tab` will either be a `tabs.Tab` instance or `undefined`.
    let [tab] = await chrome.tabs.query(queryOptions);
    return tab;
}

async function stoReadCurrentAccount() {
    let acccurkey = 'current_account'
    let obj = await chrome_storage_sync.get(acccurkey)
    return obj[acccurkey]
}

async function sendMessageToTabContent(tabid, req, msg) {
    if(!tabid){ return }
    msg.did = req.did
    try{
        await chrome.tabs.sendMessage(tabid, msg)
    }catch(e){
        // Target tab has no content script / is closed: reply lost; the caller (DApp) has its own timeout fallback
        console.warn('sendMessageToTabContent: ', e)
    }
}

async function sendMessageToCurrentTabContent(req, msg) {
    let curtab = await getCurrentTab()
    if(curtab && curtab.id){
        await sendMessageToTabContent(curtab.id, req, msg)
    }
}

// A2: dApp request pages (connect/transfer/signtx/signtext/raisefee/switchchain)
// open as a MetaMask-style notification popup window instead of a full tab:
// type 'popup', sized REQ_WIN_W x REQ_WIN_H (see the constants below — 800px
// is the #wpage design max-width), outer size including the window frame.
// The tid/did/dmu URL contract
// and the ml_<tabid>_<did> session channel are unchanged — replies are delivered
// to the source tab via chrome.tabs.sendMessage(tid), independent of the window
// form, so the SDK message protocol is untouched.
const REQ_WIN_W = 800
, REQ_WIN_H = 800

async function openWalletPopupPageInNextTab(req, tabid) {
    // console.log(req)
    req = req || {}
    // Prefer the request's source tab (sender.tab.id): when a DApp runs in a
    // background tab / another window, the popup and reply must bind to the source
    // page, not the "current active page" (or the reply lands on the wrong page).
    let curtab = null
    if(tabid){
        try{ curtab = await chrome.tabs.get(tabid) }catch(e){}
    }
    if(!curtab){
        curtab = await getCurrentTab()
    }
    // Both lookups fail (edge cases like no active window): fall back to plain
    // defaults, so a curtab access can't kill the whole background handler and
    // leave the DApp hanging forever
    let cidx = curtab ? curtab.index : 0
    , tabid2 = curtab ? curtab.id : 0
    , actpage = req.action || 'moneynex'
    , params = `?tid=${tabid2}`;
    delete req.action
    // Objects like layout tables can't go in the URL: store in session, popup reads via mlkey
    // Same for signtext multi-line text (URLs are unsuitable for long text / newlines)
    let extra = {}
    const layoutKeys = {
        msglayout: 1, msg_layout: 1, msglayouts: 1, msg_layouts: 1,
        msgid: 1, msg_id: 1, message_id: 1, action_id: 1,
        text: 1,
    }
    for(let k in req){
        if(layoutKeys[k] || (req[k] != null && typeof req[k] === 'object')){
            extra[k] = req[k]
            delete req[k]
        }
    }
    if(Object.keys(extra).length){
        let mlkey = 'ml_' + tabid2 + '_' + (req.did || 0)
        try {
            await chrome.storage.session.set({ [mlkey]: extra })
            params += `&mlkey=${mlkey}`
        } catch(e) {}
    }
    for(let k in req){
        params += `&${k}=${req[k]}`
    }
    let url = `popup/${actpage}.html` + params
    // [Modernize-1] anchor the request window beside the requesting page — top
    // right of the window that owns the source tab (the MetaMask showPopup
    // placement), so the approval visibly belongs to the dApp that raised it,
    // like Chrome's own permission bubbles. A failed lookup yields no anchor and
    // the window keeps the pre-change system placement.
    , anchor = await sourceWindowAnchor(curtab)
    , win = await openRequestPopupWindow(url, anchor)
    if(win){
        let rid = newReqRid()
        await registerPendingReqReply(await reqReplyKeys(win), { tid: tabid2, did: req.did || 0, rid: rid })
        // [Modernize-2] recall aids on the pending registry: OS notification
        // (click refocuses the request window) + toolbar badge count. Both are
        // fire-and-forget; window-open latency is unchanged.
        notifyPendingRequest(rid, actpage, req.dmu)
        updateRequestBadge()
        return win
    }
    // Fallback to the original next-tab open, mandated by the refactor plan for
    // environments where window creation fails (e.g. no window manager). The
    // cause is logged above, never swallowed.
    let ftab = await chrome.tabs.create({
        url: url,
        index: cidx + 1,
        openerTabId: tabid2,
    });
    if(ftab && ftab.id){
        let rid = newReqRid()
        await registerPendingReqReply(['t' + ftab.id], { tid: tabid2, did: req.did || 0, rid: rid })
        notifyPendingRequest(rid, actpage, req.dmu)
        updateRequestBadge()
    }
    return ftab
}

// [Modernize-1] top-right anchor of the window that owns the source tab — the
// MetaMask showPopup placement (left = win.left + win.width - popupWidth, top =
// win.top, left clamped at 0 exactly like their Math.max). Unusable placements
// return null so the caller keeps Chrome's default positioning: a minimized or
// off-screen window reports launch coords (this sandbox launches at -32000,-32000)
// and a fullscreen source would just drag the popup under itself.
async function sourceWindowAnchor(tab) {
    if(!tab || tab.windowId == null){ return null }
    try{
        let w = await chrome.windows.get(tab.windowId)
        if(!w || w.left == null || w.top == null || w.width == null){ return null }
        if(w.state == 'minimized' || w.state == 'fullscreen'){ return null }
        if(w.left < -100 || w.top < -100 || w.left > 20000 || w.top > 20000){ return null }
        return {
            left: Math.max((w.left || 0) + ((w.width || 0) - REQ_WIN_W), 0),
            top: w.top || 0,
        }
    }catch(e){
        return null
    }
}

// A2: create the notification popup window. Resolves the created window, or null
// when Chrome refused (lastError) — the caller falls back to chrome.tabs.create.
function openRequestPopupWindow(url, anchor) {
    return new Promise((resolve) => {
        try{
            let crt = {
                url: url,
                type: 'popup',
                width: REQ_WIN_W,
                height: REQ_WIN_H,
                focused: true,
            }
            // [Modernize-1] create beside the requesting page's window when the
            // anchor is known
            if(anchor && anchor.left != null && anchor.top != null){
                crt.left = anchor.left
                crt.top = anchor.top
            }
            chrome.windows.create(crt, (win) => {
                let err = chrome.runtime && chrome.runtime.lastError
                if(err || !win || !win.id){
                    console.warn('openRequestPopupWindow failed, falling back to tab: ', err ? err.message : 'no window returned')
                    resolve(null)
                    return
                }
                // Resolve FIRST and enforce geometry OUTSIDE the create callback —
                // see reassertRequestPopupWindow: state writes made inside this
                // callback race the window-open churn and are silently dropped.
                resolve(win)
                reassertRequestPopupWindow(win.id, crt)
            })
        }catch(e){
            console.warn('openRequestPopupWindow threw, falling back to tab: ', e)
            resolve(null)
        }
    })
}

// [Modernize-1] enforce the REQ_WIN_W x REQ_WIN_H contract + anchored position after create.
// Two hardening facts shape this: (1) this sandbox launches Chrome minimized
// off-screen and windows.create then ignores width/height/left/top entirely,
// cloning the launch geometry (found live; the old in-callback size reassert
// existed for exactly this); (2) NEW: geometry/badge writes issued from inside
// the create callback — or anywhere in the request event's window-open churn —
// are silently dropped by Chrome 152 (the update "succeeds" but the state
// never lands; the same call from a settled context sticks). So the reassert
// runs deferred, re-reads real bounds instead of trusting the create callback
// snapshot, and makes a second pass after the window has fully settled — the
// MetaMask updateWindowPosition-after-create pattern, made churn-proof.
function reassertRequestPopupWindow(winId, crt) {
    const pass = (attempt) => {
        setTimeout(() => {
            chrome.windows.get(winId, (w) => {
                if(chrome.runtime && chrome.runtime.lastError){ return }
                if(!w){ return }
                let upds = null
                if(crt.left != null){
                    // anchored: the anchor derives from an on-screen source
                    // window, so it is always valid — enforce it over whatever
                    // Chrome placed (launch-geometry clone included)
                    if(w.state != 'fullscreen' && (w.left != crt.left || w.top != crt.top)){
                        upds = { left: crt.left, top: crt.top }
                    }
                }else if(w.left != null && (w.left < -100 || w.top < -100 || w.left > 20000 || w.top > 20000)){
                    // legacy off-screen rescue for unanchored windows
                    upds = { left: 0, top: 0 }
                }
                if(upds){
                    upds.width = REQ_WIN_W
                    upds.height = REQ_WIN_H
                    chrome.windows.update(winId, upds, () => {
                        let uerr = chrome.runtime && chrome.runtime.lastError
                        if(uerr){ console.warn('reassertRequestPopupWindow: ', uerr.message) }
                    })
                }
                if(attempt < 2){ pass(attempt + 1) }
            })
        }, attempt === 0 ? 0 : 300)
    }
    pass(0)
}

// P3-2: stale connect approval windows. Every "not authorized" call opens a connect
// window; if the user disconnects/reconnects repeatedly the same origin piles up
// unanswered connect windows whose replies race onto old did channels. Track the
// latest pending connect window per origin and close the previous one before opening
// a new approval (the closed page's beforeunload cancel reply frees the old did).
// A2: pendingConnectTabs (tab-id keyed, tabs.onRemoved) becomes window-keyed.
const pendingConnectWins = {}

// A2/§7.5: authoritative X-close fallback for dApp request windows. The page-side
// beforeunload cancel is best-effort only — when the window is destroyed outright
// the reply send races page teardown and can be lost, leaving the DApp hanging
// until its own timeout. The background owns the reliable path: every request
// window/tab is registered here with its source-tab did channel, and the close
// listeners deliver the cancel reply. Two hardening facts from the M3 step-14
// forensics shape the storage design:
// - an MV3 service worker is terminated after ~30s idle and restarted BY the
//   close event itself — an in-memory table is empty in the restarted worker
//   (found live: the pre-fix build lost every X-close cancel this way), so
//   registrations live in chrome.storage.session, which survives worker
//   restarts and is cleared automatically when the browser session ends;
// - a request popup is addressable both as a window (windows.onRemoved) and as
//   its contained tab (tabs.onRemoved — Ctrl+W, CDP target close). Both ids are
//   registered under one rid; whichever removal event fires first consumes the
//   entry, duplicates are dropped. A late cancel after a normal resolve is also
//   safe — the content-script callback table deletes a did on first delivery.
const PENDING_REQ_KEY = 'pending_req_replies'
function newReqRid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
// A request popup window is cancellable as a window AND as its contained tab.
// The create/update result does not always carry tabs, so query when needed.
async function reqReplyKeys(win) {
    let ptid = (win && win.tabs && win.tabs[0] && win.tabs[0].id) || null
    if(ptid == null && win && win.id != null){
        try {
            let ts = await chrome.tabs.query({ windowId: win.id })
            ptid = ts.length ? ts[0].id : null
        }catch(e){
            console.warn('reqReplyKeys: tab lookup failed for window ', win.id, ': ', e)
        }
    }
    let keys = [win.id]
    if(ptid != null){ keys.push('t' + ptid) }
    return keys
}
// serialize read-modify-write on the session table: one window close fires both
// removal events (tab first, then window) and the two rewrites must not interleave
let pendingReqLock = Promise.resolve()
function withPendingReqLock(fn) {
    let run = pendingReqLock.then(fn, fn)
    pendingReqLock = run.then(() => {}, () => {})
    return run
}
function registerPendingReqReply(keys, entry) {
    return withPendingReqLock(async () => {
        let obj = await chrome.storage.session.get(PENDING_REQ_KEY)
        , tbl = (obj && obj[PENDING_REQ_KEY]) || {}
        for(let k of keys){ tbl[k] = entry }
        await chrome.storage.session.set({ [PENDING_REQ_KEY]: tbl })
    }).catch(e => {
        console.warn('registerPendingReqReply: ', e)
    })
}
function firePendingCancel(key){
    return withPendingReqLock(async () => {
        let obj = await chrome.storage.session.get(PENDING_REQ_KEY)
        , tbl = (obj && obj[PENDING_REQ_KEY]) || {}
        , pend = tbl[key]
        if(!pend){ return null }
        for(let k in tbl){ if(tbl[k].rid === pend.rid){ delete tbl[k] } }
        await chrome.storage.session.set({ [PENDING_REQ_KEY]: tbl })
        return pend
    }).then(pend => {
        if(!pend){ return }
        let msg = { did: pend.did, ret: 1, err: 'Request canceled (popup closed)', code: 'user_canceled' }
        // no receiver (source page closed before the popup) is a normal race,
        // not an error: the DApp's own timeout is the last-resort fallback there
        chrome.tabs.sendMessage(pend.tid, msg).catch(() => {})
        // [Modernize-2] the request is gone: drop its recall notification and
        // refresh the badge from the now-shrunken registry
        clearReqNotification(pend.rid)
        updateRequestBadge()
    }).catch(e => {
        console.warn('firePendingCancel: ', e)
    })
}
chrome.windows.onRemoved.addListener((winId) => {
    for(let origin in pendingConnectWins){
        if(pendingConnectWins[origin] === winId){
            delete pendingConnectWins[origin]
        }
    }
    firePendingCancel(winId)
})
chrome.tabs.onRemoved.addListener((tabId) => {
    firePendingCancel('t' + tabId)
})

// [Modernize-2] toolbar badge + OS notification recall for dApp request windows.
// The pending_req_replies registry is the single source of truth — one rid per
// open request window, dropped when the window/tab goes away — so the badge is
// just its distinct-rid count and every notification id is 'mnxreq-' + rid,
// which makes both self-cleaning. The badge is re-derived on every
// service-worker start (call at the bottom of this file): the badge text lives
// browser-side across worker restarts, so the restart call refreshes it after
// a browser restart and repairs it if a worker died mid-update.
const BADGE_COLOR = '#d9534f'
// The badge write must land OUTSIDE the request event's window-open churn:
// setBadgeText issued while a request popup is being created is silently
// dropped by Chrome 152 (found live — the write "succeeds" but the badge never
// changes; the identical call from a settled context sticks). A short defer
// fixes it; the debounce also collapses rapid register/cancel bursts into one
// write. The SW stays well past 250ms (any event grants ~30s), so the timer is
// safe in MV3.
let badgeDeferTimer = null
function updateRequestBadge() {
    if(badgeDeferTimer){ clearTimeout(badgeDeferTimer) }
    badgeDeferTimer = setTimeout(() => {
        badgeDeferTimer = null
        withPendingReqLock(async () => {
            let obj = await chrome.storage.session.get(PENDING_REQ_KEY)
            , tbl = (obj && obj[PENDING_REQ_KEY]) || {}
            , rids = {}
            for(let k in tbl){ rids[tbl[k] ? tbl[k].rid : 0] = 1 }
            let n = Object.keys(rids).length
            try{
                chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
                chrome.action.setBadgeText({ text: n > 0 ? (n > 9 ? '9+' : '' + n) : '' })
            }catch(e){
                console.warn('updateRequestBadge: setBadge failed: ', e)
            }
        }).catch(e => {
            console.warn('updateRequestBadge: ', e)
        })
    }, 250)
}

// OS notification when a request window opens: the recall path for a window
// buried under others or a whole browser left in the background. Clicking
// focuses the request window — chrome.windows.update needs no user gesture,
// and notification clicks are deliberately NOT used for sidePanel.open here
// (they are not a valid gesture for it; verified against the official gesture
// list). The notification clears itself when the request goes away or on click.
const REQ_PAGE_LABELS = {
    connect: 'Connect request',
    transfer: 'Transfer request',
    signtx: 'Transaction signing request',
    signtext: 'Message signing request',
    raisefee: 'Fee adjustment request',
    switchchain: 'Network switch request',
    actionview: 'Transaction review request',
    connectedsites: 'Connected sites management',
}
function notifyPendingRequest(rid, actpage, dmu) {
    if(!chrome.notifications || !chrome.notifications.create || !rid){ return }
    try{
        let label = REQ_PAGE_LABELS[actpage] || 'Wallet request'
        // icon must be an absolute chrome-extension:// URL: a bare relative path
        // fails the create with "Unable to download all specified images" on the
        // Linux notification bridge (found live in the sandbox, Chrome 152)
        chrome.notifications.create('mnxreq-' + rid, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('image/icos/logo-128.png'),
            title: 'MoneyNex',
            message: (dmu || 'A website') + ' initiated a ' + label,
            priority: 1,
        }, () => {
            let err = chrome.runtime && chrome.runtime.lastError
            if(err){ console.warn('notifyPendingRequest: ', err.message) }
        })
    }catch(e){
        console.warn('notifyPendingRequest: ', e)
    }
}
function clearReqNotification(rid) {
    if(!chrome.notifications || !chrome.notifications.clear || !rid){ return }
    try{
        chrome.notifications.clear('mnxreq-' + rid, () => {
            let err = chrome.runtime && chrome.runtime.lastError
            if(err){ console.warn('clearReqNotification: ', err.message) }
        })
    }catch(e){}
}
if(chrome.notifications && chrome.notifications.onClicked){
    chrome.notifications.onClicked.addListener((nid) => {
        if(typeof nid != 'string' || nid.indexOf('mnxreq-') != 0){ return }
        clearReqNotification(nid.slice('mnxreq-'.length))
        focusPendingReqWindow(nid.slice('mnxreq-'.length))
    })
}
// Focus the request window (or the tab, in the tab-fallback open mode) a
// clicked notification belongs to. A missing registry entry means the request
// was already answered/closed — nothing to focus.
async function focusPendingReqWindow(rid) {
    try{
        let obj = await chrome.storage.session.get(PENDING_REQ_KEY)
        , tbl = (obj && obj[PENDING_REQ_KEY]) || {}
        , winId = null, tabId = null
        for(let k in tbl){
            if(!tbl[k] || tbl[k].rid !== rid){ continue }
            let key = '' + k
            if(key.indexOf('t') == 0 && tabId == null){ tabId = parseInt(key.slice(1)) }
            else if(winId == null){ winId = parseInt(key) }
        }
        if(winId != null){
            await chrome.windows.update(winId, { focused: true, drawAttention: true })
        }else if(tabId != null){
            let tab = await chrome.tabs.update(tabId, { active: true })
            if(tab && tab.windowId != null){
                await chrome.windows.update(tab.windowId, { focused: true })
            }
        }
    }catch(e){
        console.warn('focusPendingReqWindow: ', e)
    }
}

// per-origin approval queue (see openConnectApproval); failures propagate to the
// caller, the queue chain only keeps ordering
const connectApprovalQueues = {}
function queueConnectApproval(origin, fn) {
    let run = (connectApprovalQueues[origin] || Promise.resolve()).then(fn, fn)
    connectApprovalQueues[origin] = run.then(() => {}, () => {})
    return run
}

async function openConnectApproval(req, tabid) {
    let origin = (req && req.dmu) || ''
    if(!origin){
        return await openWalletPopupPageInNextTab(req, tabid)
    }
    // Serialize same-origin approvals: a second request arriving while the first
    // window is still being created (create takes longer than the gap between two
    // rapid dApp calls) must wait, then see the freshly registered window and
    // replace it — without the queue both requests pass the stale-window check and
    // two windows pile up (found as a real race in A5 sandbox testing).
    return await queueConnectApproval(origin, async () => {
        // Reclaim a still-pending approval window for the same origin (best effort:
        // it may already have been closed/answered by the user — remove throws then).
        let oldId = pendingConnectWins[origin]
        if(oldId){
            delete pendingConnectWins[origin]
            try{ await chrome.windows.remove(oldId) }catch(e){}
        }
        let win = await openWalletPopupPageInNextTab(req, tabid)
        if(win && win.id){ pendingConnectWins[origin] = win.id }
        return win
    })
}

// A3: request origin must come from the chrome MessageSender, never from the
// dmu self-reported by content. sender.origin (scheme+host+port, not derivable
// from a spoofable path) is preferred; sender.url parsing is the fallback.
// '' means "unknown origin" — callers must fail the request, not guess.
function senderOriginOf(sender) {
    if(sender && sender.origin){ return sender.origin }
    if(sender && sender.url){
        try { return new URL(sender.url).origin } catch(e){
            console.warn('senderOriginOf: unparseable sender.url: ', sender.url)
        }
    }
    return ''
}

// A3 connect authorization check — exact origin match against connect_sites
// ({origin: {host, connectedAt, ...}}; written by popup/login/login.js).
// Compat windows, both temporary:
// - connect_sites not written yet (0.3.x profile, migration hasn't run): the old
//   connect_domains bare-host allowlist authorizes as in 0.3.x (origin/host/bare
//   forms), so pre-migration data never stops working (§5-A3-1 read-side compat).
// - migrated records are keyed by bare host (0.3.x stored no scheme): match by
//   host, which reproduces 0.3.x behavior for exactly those migrated sites.
// Grants made from 0.4.0 on are exact-origin (scheme + port aware).
async function isConnectAuthorized(origin) {
    let obj = await chrome_storage_local.get('connect_sites')
    , sites = (obj && obj['connect_sites']) || null
    if(sites){
        if(sites[origin]){
            return true
        }
        let host = ''
        try { host = new URL(origin).host } catch(e){}
        return !!(host && sites[host])
    }
    let oldobj = await chrome_storage_local.get('connect_domains')
    , old = (oldobj && oldobj['connect_domains']) || []
    if(!old.length){
        return false
    }
    let host = ''
    try { host = new URL(origin).host } catch(e){}
    let bare = origin.replace(/^https?:\/\//, '')
    return old.indexOf(origin) >= 0 || old.indexOf(host) >= 0 || old.indexOf(bare) >= 0
}


chrome.runtime.onInstalled.addListener(async ({reason}) => {
    if (reason === 'install') {
        // First-run welcome: the wallet home opens as a normal tab. A2 scopes the
        // notification-window form to dApp-triggered request pages; onboarding is
        // not a request, and a request-sized window is the wrong first impression.
        await chrome.tabs.create({ url: 'popup/moneynex.html' })
    }
});

// [Sidepanel] MetaMask-aligned toolbar-icon invocation: clicking the action icon
// opens the wallet in Chrome's side panel (persists across tab switches until the
// user closes it — that is the "pinned" form), instead of the focus-loss popup.
// Mechanism is exactly MetaMask 13.x's: manifest declares the sidePanel permission
// + side_panel.default_path, and the background registers the click behavior via
// chrome.sidePanel.setPanelBehavior({openPanelOnActionClick}) (their pref is
// preferences.useSidePanelAsDefault; here it is the default, always on). The call
// is top-level so it re-runs on every service-worker start — the flag lives
// browser-side per extension session and must be re-asserted after browser
// restarts. default_popup stays declared as the graceful fallback: when the
// sidePanel API is unavailable (older kernel / setPanelBehavior throws) an icon
// click falls back to the original small popup. dApp-triggered request pages
// (openRequestPopupWindow's notification windows) and the install
// welcome tab are unrelated to this flag and keep their behavior.
// To restore the popup-only form, remove this single call.
if(chrome.sidePanel && chrome.sidePanel.setPanelBehavior){
    try{
        let behavior = chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
        if(behavior && behavior.catch){
            behavior.catch((e) => { console.warn('sidePanel.setPanelBehavior failed: ', e) })
        }
    }catch(e){
        console.warn('sidePanel.setPanelBehavior threw: ', e)
    }
}

// [Modernize-2] re-derive the badge on every service-worker start. Top-level so
// an idle-stopped worker re-runs it on the next event wake; placement at the
// very end of the file keeps it after the PENDING_REQ_KEY registry it reads.
updateRequestBadge()
