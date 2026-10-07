
var routePageConn = (adr, clbk) => {

    // Single-reply contract (shared helper): reply {address} once then close; cancel/failure must
    // also reply {err} or the DApp's connect request hangs forever.
    let {isAnswered, answerOnce, closeWin, cancelAndClose} = mnx_dapp_reply('Connection request')

    // A3 defensive validation of the request contract. tid/did/dmu arrive via the
    // background-built URL (dmu is always derived from the message sender there,
    // never from content). A request failing validation must render an explicit
    // error and must not become confirmable — it is never silently accepted nor
    // silently canceled (§5-A3-4; the polished error layout is workflow B's, the
    // logic here is A's).
    //   dmu: full http(s) origin
    //   tid: positive integer — source tab id the reply is delivered to
    //   did: positive integer — request id of the page-side callback channel
    let dmuok = no
    try {
        let u = new URL(urlquery.dmu)
        dmuok = (u.protocol == 'http:' || u.protocol == 'https:') && !!u.host
    } catch(e){}
    let tid = parseInt(urlquery.tid)
    , did = parseInt(urlquery.did)
    , reqok = !!(dmuok && tid > 0 && did > 0)

    let {app} = VueCreateApp('conn', vue_tpl_conn, {
        icfp: icfpath,
        adr: adr,
        sadr: '',
        dmu: urlquery.dmu || '',
        reqok: reqok,
        reqerr: reqok ? '' : (
            !urlquery.dmu ? 'Invalid connection request: missing site origin' :
            !dmuok ? 'Invalid connection request: bad site origin' :
            'Invalid connection request: bad tab or request id'
        ),
    },{
        nop(){
            if(isAnswered()){ closeWin(); return }
            cancelAndClose('User canceled the connection request')
        },
        async doconn(){
            let t = this
            // UI-level unreachable (error is shown instead of the confirm flow);
            // guards code-level confirmation attempts on a malformed request
            if(!t.reqok){
                showWPerr(t.reqerr)
                return
            }
            // A3: grant by exact origin into connect_sites (connect_domains is
            // retired; append no longer defaults to 'hacash.com')
            await stoAppendConnectSite(t.dmu, adr)
            await answerOnce({address: adr})
            closeWin()
        }
    }, async(t)=>{
        t.sadr = addrOmitted(adr)
        if(!t.reqok){
            // persistent, visible error — the user sees exactly why nothing is confirmable
            showWPerr(t.reqerr)
        }
        clbk && clbk()
    });


}
