

;let swtgasAppObj = {
    render: vue_tpl_swtgas(),
    data() {
        return {
            // icfp: icfpath,
            // gas use
            gsus: 1,
            bgas: 0.0001,
            setgas: '',
            rcmgas: '',
            // 
            swtfns: [],
        }
    },
    // mounted(e){ 
    //     m && (m(this))
    // },
    methods: {
        dectwo(n) {
            n = n+''
            let k = n.indexOf('.')
            if(k<1){
                return parseFloat(n)
            } 
            let sz = n.length
            , x = sz
            for(let i=k+1;i<sz;i++){
                if(n.charAt(i)!='0'){
                    // alert(i)
                    x = i+2
                    break
                }
            }
            if(x > sz) {
                x = sz
            }
            return parseFloat(n.slice(0,x))
        },
        get() {
            let t = this
            , gas = parseFloat(t.rcmgas)
            if(!gas || gas < t.bgas){
                gas = t.bgas
            }
            if(t.gsus==2) {
                gas *= 4
            }else if(t.gsus==3) {
                gas *= 12
            }else if(t.gsus==4) {
                gas = parseFloat(hac_mei_unit(t.setgas)) || 0
            }
            return t.dectwo(gas)
        },
        doswt(g) {
            let t = this
            t.gsus = g
            // call
            for(let i in t.swtfns) {
                t.swtfns[i](t.get(), g)
            }
        },
        swt(fn){
            let t = this
            t.swtfns.push(fn)
        },
        setb(bgas) {
            let t = this
            t.bgas = bgas || 0.0001
            // t.doswt(1)
        },
        async req(txsz, opts) {
            txsz = txsz || 166
            let t = this
            let res = await reqFeasibleFee(txsz, opts)
            t.rcmgas = parseFloat(res && res.feasible)
            if(!isFinite(t.rcmgas)){
                // 拿不到建议费（网络失败/网关异常）：保持最低费继续，但必须让用户知道，
                // 否则一笔低于地板价的交易会被静默广播然后被节点拒绝
                showWPerr('Fee suggestion unavailable (network?) — using minimum fee')
            }else if(t.rcmgas > t.bgas){
                t.bgas = t.rcmgas
            }
            return t.bgas
        }
    }
};
