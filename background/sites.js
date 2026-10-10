
/**
 * ============================================================================
 * B (Phase 3, REVISED): site-connection framework — the BACKGROUND is the
 * single source of truth for connect_sites changes, and keeps the tab↔origin
 * registry that lets the WALLET UI follow the active browser tab.
 *
 * The "Connected" indicator lives in the wallet page (the side panel stays
 * open while the user browses), MetaMask-style — no visual UI is injected
 * into web pages. Three cooperating pieces here:
 *
 * 1. Registry: content scripts self-register their tab on load
 *    (mnx_tab_register, TOP FRAME only — iframe frames don't register; a push
 *    reaches every frame of the tab anyway). Shape is { [tabId]: origin } —
 *    one origin per tab, the newest navigation wins. It lives in
 *    chrome.storage.session: an MV3 service worker is terminated after ~30s
 *    idle and an in-memory table would be empty in the restarted worker.
 *    chrome.tabs.query({url}) is NOT a substitute: matching by URL pattern
 *    needs the 'tabs' permission / host permissions, and widening the
 *    manifest's permission surface is off the table.
 *
 * 2. Push: every grant (connect approval page) and every revocation
 *    (connected-sites management in either host, the wallet indicator's exit)
 *    lands as a whole-table write of chrome.storage.local['connect_sites'].
 *    One storage.onChanged diff turns any of them into targeted pushes to the
 *    registered tab: revoked {origin} → the tab's matching frames fire the
 *    page-world 'disconnect' event (MoneyNex.on / MoneyNexDisconnect);
 *    granted → nothing is pushed to pages (the SDK exposes 'disconnect'
 *    only), but the wallet's own storage watcher re-queries and shows the bar.
 *
 * 3. Wallet queries: mnx_current_site answers "what site is this tab on and
 *    is it connected" (the wallet follows the active tab via
 *    chrome.tabs.onActivated, which needs no 'tabs' permission); and
 *    mnx_tab_invalidate drops a tab's entry when a navigation starts — the
 *    old origin must not outlive the page that registered it, or the bar
 *    would light up for the PREVIOUS site while the new page is loading.
 *    Both are extension-page-only: a web page must not be able to blind
 *    another tab's indicator or revoke a grant it doesn't own.
 * ============================================================================
 */

const MNX_SITES_TABS_KEY = 'mnx_connect_tabs'

// serialize read-modify-write on the registry (a page-load register racing an
// invalidate/purge must not resurrect each other's entries)
let sitesTabsLock = Promise.resolve()
function withSitesTabsLock(fn) {
    let run = sitesTabsLock.then(fn, fn)
    sitesTabsLock = run.then(() => {}, () => {})
    return run
}

function sitesTabsReadModify(modify) {
    return withSitesTabsLock(async () => {
        let obj = await chrome.storage.session.get(MNX_SITES_TABS_KEY)
        , tbl = (obj && obj[MNX_SITES_TABS_KEY]) || {}
        , used = modify(tbl)
        if(used !== false){
            await chrome.storage.session.set({ [MNX_SITES_TABS_KEY]: tbl })
        }
        return tbl
    }).catch(e => {
        console.warn('sitesTabs: ', e)
        return {}
    })
}

// only our own extension pages (the wallet UI) may drive the wallet-facing
// handlers below: content-script messages carry the web page's origin, our
// pages carry chrome-extension://<id>
function senderIsOwnPage(sender) {
    return !!(sender && sender.origin && sender.origin == 'chrome-extension://' + chrome.runtime.id)
}


// --- content-facing message handlers ----------------------------------------

// page load: remember this tab under its (sender-derived) origin. TOP FRAME
// ONLY — an iframe's site is not the tab's site, and the tab must map to
// exactly one origin (the newest navigation wins). Unknown origin / no tab
// (a popup page has none) is not an error — nothing to register.
messageHandler['mnx_tab_register'] = async function(req, sender, ok) {
    let origin = senderOriginOf(sender)
    , tabid = (sender && sender.tab && sender.tab.id) || 0
    , frameid = (sender && sender.frameId) || 0
    if(origin && /^https?:/.test(origin) && tabid && frameid === 0){
        await sitesTabsReadModify((tbl) => {
            tbl[tabid] = origin
        })
    }
    ok({})
}

// --- wallet-page-facing handlers ---------------------------------------------

// the wallet asks: what site is this tab on, and is it connected? Answers
// {origin, host, connected}; origin '' when the tab has no live registration
// (chrome:// page, freshly invalidated by a navigation, browser just
// restarted and the page hasn't reloaded…) — the wallet shows nothing.
messageHandler['mnx_current_site'] = async function(req, sender, ok) {
    let out = { origin: '', host: '', connected: false }
    if(senderIsOwnPage(sender)){
        let tabid = parseInt((req && req.tabid) || 0) || 0
        if(tabid){
            let tbl = await sitesTabsReadModify(() => false) // read-only
            , origin = tbl[tabid] || ''
            if(origin){
                out.origin = origin
                try { out.host = new URL(origin).host } catch(e){}
                out.connected = await isConnectAuthorized(origin)
            }
        }
    }
    ok(out)
}

// the wallet saw tabs.onUpdated(status 'loading') for the followed tab: the
// page that registered this origin is going away — drop the entry so no
// stale origin can answer queries for the incoming page (it re-registers at
// document_idle).
messageHandler['mnx_tab_invalidate'] = async function(req, sender, ok) {
    if(senderIsOwnPage(sender)){
        let tabid = parseInt((req && req.tabid) || 0) || 0
        if(tabid){
            await sitesTabsReadModify((tbl) => {
                delete tbl[tabid]
            })
        }
    }
    ok({})
}

// wallet indicator's exit icon: revoke a site. Extension-page-only (a page
// must not be able to revoke another site — that path doesn't exist anymore;
// pages only ever receive notifications). The resulting connect_sites write
// goes through the same onChanged diff as every other revocation, which is
// what actually notifies the site's frames and fires the SDK event.
messageHandler['mnx_site_disconnect_origin'] = async function(req, sender, ok) {
    if(senderIsOwnPage(sender)){
        let origin = (req && req.origin) || ''
        if(origin){
            await sitesRevoke(origin)
        }
    }
    ok({})
}


// --- revocation write ---------------------------------------------------------
// Find the connect_sites key that authorizes `origin`: the exact origin key,
// or — for records migrated from 0.3.x — the bare-host key. Returns '' when
// nothing matches.
async function sitesFindKey(sites, origin) {
    if(sites[origin] != null){ return origin }
    let host = ''
    try { host = new URL(origin).host } catch(e){}
    if(host && sites[host] != null){ return host }
    return ''
}

async function sitesRevoke(origin) {
    return await withSitesTabsLock(async () => {
        let obj = await chrome_storage_local.get('connect_sites')
        , sites = (obj && obj['connect_sites']) || null
        if(!sites){ return false }
        let key = await sitesFindKey(sites, origin)
        if(!key){ return false } // already disconnected
        delete sites[key]
        let sv = {}
        sv['connect_sites'] = sites
        await chrome_storage_local.set(sv)
        return true
    }).catch(e => {
        console.warn('sitesRevoke: ', e)
        return false
    })
}


// --- storage diff → push -------------------------------------------------------
// The single notification path for ALL connect_sites changes, whoever wrote
// them (connect approval, management pages, the wallet indicator). Membership
// diff of the old/new tables; value changes don't matter (keys are grants).
chrome.storage.onChanged.addListener((changes, area) => {
    if(area != 'local' || !changes['connect_sites']){ return }
    let oldv = changes['connect_sites'].oldValue || {}
    , newv = changes['connect_sites'].newValue || {}
    for(let key in oldv){
        if(!(key in newv)){
            sitesNotify(key, 'mnx_site_revoked').catch(() => {})
        }
    }
    for(let key in newv){
        if(!(key in oldv)){
            // granted: nothing to push into pages (the SDK has no 'connect'
            // event; the page's own need_connect flow drove the grant), but
            // keep the symmetric call so granted tabs get a no-op ping that
            // also purges dead entries on the way
            sitesNotify(key, 'mnx_site_granted').catch(() => {})
        }
    }
})

// push to every tab registered under `key` or its bare-host alias (a legacy
// "example.com" key covers "https://example.com" and "http://example.com:8080"
// alike); the push reaches all frames of the tab — each frame's content
// script decides by its own origin whether the event applies to it. Dead tab
// ids are purged from the registry on the way.
async function sitesNotify(key, action) {
    let tbl = await sitesTabsReadModify((t) => { return false }) // read-only
    , targets = []
    for(let tabid in tbl){
        let origin = tbl[tabid]
        if(origin == key){
            targets.push(tabid)
            continue
        }
        let host = ''
        try { host = new URL(origin).host } catch(e){}
        if(host && host == key){
            targets.push(tabid)
        }
    }
    if(!targets.length){ return }
    await Promise.all(targets.map(async (tabid) => {
        try{
            await chrome.tabs.sendMessage(parseInt(tabid), { action: action, origin: key })
        }catch(e){
            // tab closed or its content script is gone: drop it from the
            // registry so the list can't grow without bound
            await sitesTabsReadModify((t) => {
                delete t[tabid]
            })
        }
    }))
}

// tab closed: drop its registration (the notify-side purge only runs when a
// push actually fails, which a plain tab close never triggers)
chrome.tabs.onRemoved.addListener((tabId) => {
    sitesTabsReadModify((tbl) => {
        delete tbl[tabId]
    }).catch(() => {})
})


// --- cold-start re-sync ---------------------------------------------------------
// After a browser restart the session registry is empty while dapp tabs from
// the previous session are still open — their content scripts only re-register
// on their NEXT page load, so the wallet's indicator would stay dark for
// already-connected sites. One ping sweep on worker start makes every live
// content script register again. Only runs when the registry is actually
// empty (a mid-session idle-termination restart reads it back from session
// storage and skips the sweep). tabs.query({}) without a URL filter needs no
// 'tabs' permission (id-only results).
;(async function(){
    try{
        let tbl = await sitesTabsReadModify(() => false)
        if(Object.keys(tbl).length){ return }
        let tabs = await chrome.tabs.query({})
        await Promise.all(tabs.map(async (t) => {
            try{
                await chrome.tabs.sendMessage(t.id, { action: 'mnx_tab_recheck' })
            }catch(e){
                // no content script in that tab — normal for most pages
            }
        }))
    }catch(e){
        console.warn('sites startup ping: ', e)
    }
})()
