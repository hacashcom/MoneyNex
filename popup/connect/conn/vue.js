
var routePageConn = (adr, clbk) => {

    let {app} = VueCreateApp('conn', vue_tpl_conn, {
        icfp: icfpath,
        adr: adr,
        sadr: '',
        dmu: urlquery.dmu,
    },{
        nop(){
            window.close()
        },
        async doconn(){
            let t = this
            , dms = await stoAppendConnectDomains(t.dmu)
            console.log(dms)
            await returnDataToUserPage({address: adr})
            window.close()
        }
    }, async(t)=>{
        t.sadr = addrOmitted(adr)
        clbk && clbk()
    });


}