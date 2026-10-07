
// Connected sites management page (A3, doc/plan.cn.md appendix.3-2):
// mount id 'cnls'; entries come from stoListConnectSites()
// ({origin, host, connectedAt, accountAtConnect, legacy} sorted newest first);
// Disconnect revokes via stoRemoveConnectSite(origin). Styling is a skeleton —
// workflow B re-skins in M2. The home ⋮ menu entry is B's template work
// (appendix.3-4); this page is directly reachable at popup/connectedsites.html.
var routePageConnlists = (adr, clbk) => {

    let {app} = VueCreateApp('cnls', vue_tpl_connlists, {
        icfp: icfpath,
        adr: adr,
        sadr: '',
        sites: nil, // null = loading
    },{
        back(){
            // Standalone tab opened from home ⋮ via chrome_tabs_create: the
            // moneynex hpgw page-stack (pophpgw) is not bundled into this page
            // (it lives in popup/index/index.js, only in popup/moneynex.js), so
            // dismissal follows the project's standalone-page pattern
            // (switchchain/actionview/login-init window.close()).
            window.close()
        },
        fmttime(ts){
            let d = new Date(ts * 1000)
            , p2 = n => (n < 10 ? '0' : '') + n
            return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
                + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
        },
        async refresh(){
            let t = this
            t.sites = await stoListConnectSites()
        },
        async dscn(s){
            let t = this
            let ok = await wpcfm_open(`Disconnect <b>${s.host}</b>? The site will have to request connection again.`, 'Disconnect', 'red')
            if(!ok){
                return
            }
            let rest = await stoRemoveConnectSite(s.origin)
            if(rest === nil){
                // Another window revoked it first: resync and say so instead of
                // pretending this click did it
                await t.refresh()
                showWPerr('Site is already disconnected')
                return
            }
            t.sites = rest
            showWPtip('Disconnected ' + s.host)
        }
    }, async(t)=>{
        t.sadr = addrOmitted(adr)
        await t.refresh()
        clbk && clbk()
    });

}
