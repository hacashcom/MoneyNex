
var routePageConn = (adr, clbk) => {

    // Single-reply contract (shared helper): reply {address} once then close; cancel/failure must
    // also reply {err} or the DApp's connect request hangs forever.
    let {isAnswered, answerOnce, closeWin, cancelAndClose} = mnx_dapp_reply('Connection request')

    let {app} = VueCreateApp('conn', vue_tpl_conn, {
        icfp: icfpath,
        adr: adr,
        sadr: '',
        dmu: urlquery.dmu,
    },{
        nop(){
            if(isAnswered()){ closeWin(); return }
            cancelAndClose('User canceled the connection request')
        },
        async doconn(){
            let t = this
            , dms = await stoAppendConnectDomains(t.dmu)
            console.log(dms)
            await answerOnce({address: adr})
            closeWin()
        }
    }, async(t)=>{
        t.sadr = addrOmitted(adr)
        clbk && clbk()
    });


}
