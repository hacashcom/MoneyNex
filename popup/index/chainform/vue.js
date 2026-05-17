var routePageChainForm = (chain, clbk, saved) => {

    let rawchain = chain
    chain = chainNormalize(chain || {})
    let isedit = !!rawchain && (rawchain.id !== undefined || rawchain.chain_id !== undefined)
    let {app} = VueCreateApp('chainform', vue_tpl_chainform, {
        icfp: icfpath,
        isedit,
        id: isedit ? chain.id + '' : '',
        name: isedit ? chain.name : '',
        rpc: isedit ? chain.rpc : '',
        explorer: isedit ? chain.explorer : '',
        remark: isedit ? chain.remark : '',
    },{
        back(){
            pophpgw(()=>{
                app.unmount()
            })
        },
        async save(){
            let t = this
            , id = parseInt(t.id)
            if(isNaN(id) || id < 0) {
                return showWPerr('Chain ID format invalid')
            }
            if(id === MAIN_CHAIN_ID && !t.isedit) {
                return showWPerr('Mainnet already exists')
            }
            if(!t.rpc) {
                return showWPerr('RPC URL is required')
            }
            if(!/^https?:\/\//i.test(t.rpc)) {
                return showWPerr('RPC URL must start with http:// or https://')
            }
            let cfg = chainNormalize({
                id,
                name: t.name,
                rpc: t.rpc,
                explorer: t.explorer,
                remark: t.remark,
                builtin: id === MAIN_CHAIN_ID,
            })
            let res = await stoUpsertChainConfig(cfg)
            if(res.err) {
                return showWPerr(res.err)
            }
            if(chainIdOf(await getCurrentChain()) === id) {
                await stoReadCurrentChain()
            }
            saved && await saved(cfg)
            showWPtip('Network saved')
            this.back()
        }
    }, async()=>{
        clbk && clbk()
    })

}
