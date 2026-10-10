

;let pgheadAppObj = {
    render: vue_tpl_pghead(),
    props: {
        // the page's live account (signtx/sigtrs/raisefee keep it in sync when
        // switching in place); static pages leave them empty and the component
        // falls back to its own read of current_account (pgh_adr/pgh_sadr)
        adr: { default: '' },
        sadr: { default: '' },
    },
    emits: ['swt'],
    data() {
        return {
            adrswct: false,
            netswct: false,
            adrmaps: {},     // addr -> record, existing accounts only
            pgh_nets: [],    // [{id, name}], existing networks only
            pgh_curcid: 0,
            pgh_adr: '',     // current account full address (read once, display)
            pgh_sadr: '',    // abbreviated address
        }
    },
    computed: {
        cur() {
            return this.adr || this.pgh_adr
        },
    },
    created() {
        // Read-only display values: read the current account once; a failure
        // never interrupts the page's main flow
        try {
            stoReadCurrentAccount().then((cur) => {
                this.pgh_adr = cur || ''
                this.pgh_sadr = cur ? addrOmitted(cur) : ''
            }).catch(() => {})
        } catch(e) {}
    },
    methods: {
        async open_adr() {
            let t = this
            t.adrmaps = await stoReadAccount()
            let cur = await stoReadCurrentAccount()
            t.pgh_adr = cur || ''
            t.pgh_sadr = cur ? addrOmitted(cur) : ''
            t.adrswct = true
            t.netswct = false
        },
        cpadr() {
            // home-header parity: the copy chip copies the full address of the
            // account this page is serving
            copyShowTip(this.adr || this.pgh_adr || '')
        },
        async swt_adr(a) {
            let t = this
            t.adrswct = false
            // live pages bind @swt (signtx/sigtrs/raisefee refresh the request
            // in place); unbound pages get the default save + reload
            if(typeof t.$props.onSwt === 'function'){
                return t.$emit('swt', a)
            }
            if(!a || a === t.pgh_adr){ return }
            await stoSaveCurrentAccount(a)
            window.location.reload()
        },
        async open_net() {
            let t = this
            let cfgs = await stoReadChainConfigs()
            t.pgh_nets = Object.keys(cfgs).map((k) => cfgs[k]).sort((a, b) => a.id - b.id)
            let cur = await stoReadCurrentChain()
            t.pgh_curcid = (cur && parseInt(cur.id)) || 0
            t.netswct = true
            t.adrswct = false
        },
        async swt_net(id) {
            let t = this
            t.netswct = false
            id = parseInt(id)
            if(!id && id !== 0){ return }
            if(id === t.pgh_curcid){ return }
            await stoSaveCurrentChainId(id)
            window.location.reload()
        },
    }
};
