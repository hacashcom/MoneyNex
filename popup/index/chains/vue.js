var chainPageAppPtr = nil
, routePageChains = (clbk) => {

    if(chainPageAppPtr) {
        clearHpgwRefresher('chains')
        chainPageAppPtr.unmount()
        chainPageAppPtr = nil
    }
    let {app, ctx} = VueCreateApp('chains', vue_tpl_chains, {
        icfp: icfpath,
        chains: {},
        curid: 0,
    },{
        back(){
            pophpgw(()=>{
                clearHpgwRefresher('chains')
                app.unmount()
                if(chainPageAppPtr == app) {
                    chainPageAppPtr = nil
                }
            })
        },
        ctip(c){
            return chainTip(c)
        },
        cname(c){
            return chainName(c)
        },
        cremark(c){
            return chainRemark(c)
        },
        async load(){
            let t = this
            t.chains = await stoReadChainConfigs()
            t.curid = chainIdOf(await stoReadCurrentChain())
        },
        async swt(c){
            let ok = await wpcfm_open(`Switch to network <b>${this.ctip(c)}</b>?`, 'Switch')
            if(!ok) return
            await stoSaveCurrentChainId(c.id)
            await this.load()
            showWPtip('Network switched')
        },
        add(){
            routePageChainForm(nil, ()=>{
                pushhpgw('chainform')
            })
        },
        edit(c){
            routePageChainForm(c, ()=>{
                pushhpgw('chainform')
            })
        },
        async rmv(c){
            if(c.id == MAIN_CHAIN_ID) {
                return showWPerr('Mainnet cannot be removed')
            }
            let ok = await wpcfm_open(`Delete network <b>${this.ctip(c)}</b>?`, 'Delete', 'red')
            if(!ok) return
            let res = await stoRemoveChainConfig(c.id)
            if(res.err) {
                return showWPerr(res.err)
            }
            await this.load()
            showWPtip('Network deleted')
        }
    }, async(t)=>{
        clbk && clbk()
        await t.load()
    })
    setHpgwRefresher('chains', async()=>{
        ctx && await ctx.load()
    })
    chainPageAppPtr = app

}
