
/**
 * ============================================================================
 * B (Phase 3, REVISED): site registration + wallet→page event delivery.
 * Bundled into content/content.min.js (after content/content), so it shares the
 * define.js helpers and runs in the content-script (isolated) world.
 *
 * NO visual UI is injected into web pages anymore — the "Connected" indicator
 * moved INSIDE the wallet UI: the wallet page (a persistent side panel)
 * follows the active browser tab and shows the site it currently displays,
 * MetaMask-style. What remains here is the page-facing half of the framework:
 *
 * 1. Tab registration (top frame): the tabId→origin registry lives in the
 *    BACKGROUND (chrome.storage.session, MV3-restart-safe). Iframe frames do
 *    not register (the tab maps to exactly one origin — the top page's), but
 *    notification pushes reach every frame of the tab anyway, and each frame
 *    decides by its own origin whether an event applies to it.
 * 2. Page-world event delivery: wallet→page events ride the hidden event div
 *    (hacash_api_event_element, created in content/content.js) via the same
 *    attribute+click bridge as the request API. hacash_api.min.js (page
 *    world) binds it and serves MoneyNex.on('disconnect') + the
 *    MoneyNexDisconnect CustomEvent.
 * 3. Cold-start re-registration: after a browser restart the background's
 *    session registry is empty; its startup ping sweep (mnx_tab_recheck)
 *    makes live tabs register again without a reload.
 *
 * This script never decides connection state by itself — the background is
 * the single source of truth for connect_sites changes.
 * ============================================================================
 */

// --- page-world event bridge ----------------------------------------------
var mnx_site_origin = location.origin

function mnxFirePageEvent(name, detail) {
    try{
        var evdiv = $id(optkey_evt_id)
        if(!evdiv){ return }
        $attr(evdiv, 'sdk_event', JSON_stringify({ event: name, detail: detail || {} }))
        evdiv.click()
    }catch(e){
        console.warn('mnxFirePageEvent: ', e)
    }
}

// strict frame attribution: the notification origin is the connect_sites
// storage key — an exact origin for grants made on 0.4.0+, a bare host for
// records migrated from 0.3.x. Mirror the background matcher
// (isConnectAuthorized) so a legacy revocation still notifies exactly the
// frames it connected: one tab can host several origins (top page +
// cross-origin iframes all receive the push), each frame answers for itself.
function mnxEventAppliesToFrame(key) {
    return key == mnx_site_origin || key == location.host
}


// --- runtime messaging -------------------------------------------------------
// fire-and-forget content→background; errors (SW gone) are non-fatal by design
function mnxSendRuntime(msg) {
    try{
        chrome.runtime.sendMessage(msg, function(){
            void (chrome.runtime && chrome.runtime.lastError)
        })
    }catch(e){
        console.warn('mnxSendRuntime: ', e)
    }
}

// runtime messages from the background (push) — keep clear of the request-reply
// listener above (that one only touches messages carrying a did)
chrome.runtime.onMessage.addListener(function(message){
    if(!message || typeof message.action != 'string'){ return }
    if(message.action == 'mnx_site_revoked'){
        if(message.origin && mnxEventAppliesToFrame(message.origin)){
            mnxFirePageEvent('disconnect', { origin: message.origin })
        }
    }else if(message.action == 'mnx_tab_recheck'){
        // background cold-start sweep: the session registry forgot this tab —
        // register again (idempotent in the background registry)
        mnxSendRuntime({ action: 'mnx_tab_register' })
    }
    // mnx_site_granted carries no page-world event: the SDK exposes
    // 'disconnect' only, and reconnection is driven by the page's own
    // need_connect flow.
})


// --- boot: register -----------------------------------------------------------
// The top frame registers the tab (the background keeps one origin per tab);
// iframe frames send too and are ignored there — keeping the sender-side
// uniform makes the content bundle frame-agnostic.
mnxSendRuntime({ action: 'mnx_tab_register' })
