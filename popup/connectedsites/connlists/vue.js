
// Connected sites management (A3, doc/plan.cn.md appendix.3-2): mount id 'cnls';
// entries come from stoListConnectSites()
// ({origin, host, connectedAt, accountAtConnect, legacy} sorted newest first);
// Disconnect revokes via stoRemoveConnectSite(origin).
// Two hosts: the moneynex home ⋮ menu opens it as an in-page hpgw view, and the
// standalone popup/connectedsites.html remains directly reachable (its dismissal
// follows the project's standalone-page pattern window.close()).
var connlistsPageAppPtr = nil
, routePageConnlists = (adr, clbk) => {

    // re-open guard (same pattern as routePageChains): unmount the previous view
    if(connlistsPageAppPtr) {
        connlistsPageAppPtr.unmount()
        connlistsPageAppPtr = nil
    }

    let {app} = VueCreateApp('cnls', vue_tpl_connlists, {
        icfp: icfpath,
        adr: adr,
        sadr: '',
        sites: nil, // null = loading
    },{
        back(){
            let t = this
            // in-page (moneynex hpgw stack): pop back and unmount; standalone
            // page (pophpgw not bundled): close the window/tab
            if(typeof pophpgw === 'function'){
                pophpgw(()=>{
                    app.unmount()
                    if(connlistsPageAppPtr == app){ connlistsPageAppPtr = nil }
                })
                return
            }
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

    connlistsPageAppPtr = app

}
