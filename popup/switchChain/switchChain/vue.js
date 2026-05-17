var routePageSwitchChain = (adr, clbk) => {

    let reqc = chainConfigFromUrlQuery()
    let {app} = VueCreateApp('swchn', vue_tpl_switchChain, {
        icfp: icfpath,
        dmu: urlquery.dmu,
        sadr: addrOmitted(adr || ''),
        cur: default_chain_configs[MAIN_CHAIN_ID],
        req: reqc,
        exists: no,
        diff: no,
        ing: no,
        err: '',
    },{
        nop(){
            returnDataToUserPage({err: 'User rejected chain switch'}).then(()=>{
                window.close()
            })
        },
        ctip(c){
            return chainTip(c)
        },
        async confirm(){
            let t = this
            if(t.ing) return
            if(t.req.id === MAIN_CHAIN_ID) {
                t.req = chainNormalize(Object.assign({}, default_chain_configs[MAIN_CHAIN_ID], t.req))
            }
            if(!t.req.rpc) {
                t.err = 'RPC URL is required'
                return
            }
            t.ing = yes
            let res = await stoUpsertChainConfig(t.req)
            if(res.err) {
                t.ing = no
                t.err = res.err
                return
            }
            await stoSaveCurrentChainId(t.req.id)
            await returnDataToUserPage({
                chain_id: t.req.id,
                chain: t.req,
                switched: true,
            })
            window.close()
        }
    }, async(t)=>{
        clbk && clbk()
        t.cur = await stoReadCurrentChain()
        let cfgs = await stoReadChainConfigs()
        , ex = cfgs[t.req.id]
        if(ex) {
            t.req = chainNormalize(Object.assign({}, ex, t.req, {
                rpc: t.req.rpc || ex.rpc,
                explorer: t.req.explorer || ex.explorer,
                name: t.req.name || ex.name,
                remark: t.req.remark || ex.remark,
            }))
        }
        t.exists = !!ex
        t.diff = !!(ex && (ex.rpc != t.req.rpc || ex.name != t.req.name || ex.explorer != t.req.explorer || ex.remark != t.req.remark))
    })

}
