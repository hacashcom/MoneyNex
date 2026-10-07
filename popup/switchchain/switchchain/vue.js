var routePageSwitchchain = (adr, clbk) => {

    let rawreq = rawChainConfigFromUrlQuery()
    let reqc = chainConfigFromUrlQuery()
    , mode = (urlquery.mode || 'addOrSwitch') + ''
    , update = (urlquery.update || 'ask') + ''
    , silentIfCurrent = urlquery.silentIfCurrent !== 'false' && urlquery.silent_if_current !== 'false'
    let {app} = VueCreateApp('swchn', vue_tpl_switchchain, {
        icfp: icfpath,
        dmu: urlquery.dmu,
        sadr: addrOmitted(adr || ''),
        cur: default_chain_configs[MAIN_CHAIN_ID],
        req: reqc,
        saved: nil,
        mode,
        update,
        exists: no,
        diff: no,
        alreadyCurrent: no,
        ing: no,
        err: '',
    },{
        nop(){
            returnDataToUserPage({err: 'User rejected network switch'}).then(()=>{
                window.close()
            })
        },
        ctip(c){
            return chainTip(c)
        },
        actionTitle(){
            let t = this
            if(t.mode == 'add') {
                if(t.exists && t.diff && t.update == 'never') {
                    return 'OK'
                }
                return t.diff ? 'Update Network' : 'Add Network'
            }
            if(t.diff && t.update != 'never') {
                return 'Update & Switch'
            }
            return t.exists ? 'Switch' : 'Add & Switch'
        },
        async switchOnly(){
            let t = this
            if(!t.saved) return
            await t.confirm(no)
        },
        async confirm(updateConfig){
            let t = this
            if(t.ing) return
            updateConfig = updateConfig !== no
            if(t.mode == 'switch' && !t.exists) {
                t.err = 'Chain not configured'
                await returnDataToUserPage({err: t.err, need_add: true, chain_id: t.req.id})
                return
            }
            if(t.req.id === MAIN_CHAIN_ID && updateConfig) {
                // Chain 0 is builtin and its endpoints are not dApp-negotiable:
                // the defaults must WIN over the request, or any site could
                // silently repoint the wallet's main-chain traffic by passing a
                // rpc in the switchchain request (found live 2026-10-05: the
                // suite's switch-back-to-0 carried a foreign rpc and the merge
                // order below let it replace the configured one).
                t.req = chainNormalize(Object.assign({}, t.req, default_chain_configs[MAIN_CHAIN_ID]))
            }
            if(!t.exists && t.mode == 'switch') {
                t.err = 'Chain not configured'
                return
            }
            if(updateConfig && !t.req.rpc) {
                t.err = 'RPC URL is required'
                return
            }
            t.ing = yes
            let target = t.saved || t.req
            , updated = no
            if(!t.exists || (t.diff && updateConfig && t.update != 'never')) {
                let res = await stoUpsertChainConfig(t.req)
                if(res.err) {
                    t.ing = no
                    t.err = res.err
                    return
                }
                target = res
                updated = yes
            }
            if(t.mode != 'add') {
                await stoSaveCurrentChainId(target.id)
            }
            await returnDataToUserPage({
                chain_id: target.id,
                chain: target,
                switched: t.mode != 'add' && !t.alreadyCurrent,
                added: !t.exists,
                updated,
            })
            window.close()
        }
    }, async(t)=>{
        clbk && clbk()
        t.cur = await stoReadCurrentChain()
        let cfgs = await stoReadChainConfigs()
        , ex = cfgs[t.req.id]
        t.saved = ex || nil
        t.alreadyCurrent = chainIdOf(t.cur) === t.req.id
        t.exists = !!ex
        t.diff = !!(ex && chainConfigHasRequestedDiff(ex, rawreq))
        if(t.alreadyCurrent && silentIfCurrent && t.mode != 'add' && !t.diff) {
            await returnDataToUserPage({
                chain_id: t.cur.id,
                chain: t.cur,
                switched: false,
                already_current: true,
            })
            return window.close()
        }
        if(t.mode == 'switch' && !ex) {
            t.err = 'Chain not configured'
            await returnDataToUserPage({err: t.err, need_add: true, chain_id: t.req.id})
            return window.close()
        }
        if(ex) {
            let merged = Object.assign({}, ex)
            for(let k of ['name', 'rpc', 'explorer', 'remark']) {
                if(rawreq[k] !== undefined && rawreq[k] !== '') {
                    merged[k] = rawreq[k]
                }
            }
            t.req = chainNormalize(merged)
        }
        if(t.exists && !t.diff && t.mode == 'add') {
            await returnDataToUserPage({
                chain_id: ex.id,
                chain: ex,
                added: false,
                already_configured: true,
            })
            return window.close()
        }
    })

}
