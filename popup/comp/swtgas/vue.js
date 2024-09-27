

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
                if(t.setgas.indexOf(':')>0){
                    gas = t.setgas
                }else{
                    gas = parseFloat(t.setgas)||0
                }
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
        async req(txsz) {
            txsz = txsz || 166
            let t = this
            t.rcmgas = parseFloat((await reqFeasibleFee(txsz)).feasible)
            // console.log('gas req ret = ', t.rcmgas)
            if(t.rcmgas > t.bgas){
                t.bgas = t.rcmgas
            }
            return t.bgas
        }
    }
};