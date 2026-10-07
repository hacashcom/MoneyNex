// moneynx_pghead — shared header behavior for the standalone request pages
// (signtx/signtext/sigtrs/raisefee/switchchain/conn), user decision 2026-10-06:
//   - LEFT: clickable account switcher — lists EXISTING accounts only, no
//     create/import affordance (that stays home-only)
//   - RIGHT: burger menu — network switching among EXISTING networks only,
//     no add-network entry (management stays in home/chains)
// Pages register via VueCreateApp(..., extds={mixins:[mnx_pghead]}). Component
// data/methods win the merge, so signtx/sigtrs keep their in-place account
// switch (swtcuraddr) — the mixin delegates to it when present, otherwise
// switches the stored current account and reloads the page.
//
// Required helpers all come from each page's bundled login.js (stoReadAccount/
// stoReadCurrentAccount/stoSaveCurrentAccount/addrOmitted) and chain.js
// (stoReadChainConfigs/stoReadCurrentChain/stoSaveCurrentChainId).
var mnx_pghead = {
    data() {
        return {
            adrswct: false,
            netswct: false,
            adrmaps: {},     // addr -> label, existing accounts only
            pgh_nets: [],    // [{id, name}], existing networks only
            pgh_curcid: 0,
            pgh_adr: '',     // current account full address (title/display on static-badge pages)
            pgh_sadr: '',    // abbreviated address
        }
    },
    created() {
        // Static-badge header display values: read the current account once, read-only;
// a failure never interrupts the page's main flow
        try {
            stoReadCurrentAccount().then((cur) => {
                this.pgh_adr = cur || ''
                this.pgh_sadr = cur ? addrOmitted(cur) : ''
                if(!this.adr){ this.adr = this.pgh_adr; this.sadr = this.pgh_sadr }
            }).catch(() => {})
        } catch(e) {}
    },
    methods: {
        async pgh_open_adr() {
            let t = this
            t.adrmaps = await stoReadAccount()
            let cur = await stoReadCurrentAccount()
            t.pgh_adr = cur || ''
            t.pgh_sadr = cur ? addrOmitted(cur) : ''
            t.adrswct = true
            t.netswct = false
        }
        , async pgh_swt_adr(a) {
            let t = this
            t.adrswct = false
            // the page has a live switcher (signtx/sigtrs swtcuraddr: refreshes the tx context in place)
            if(a && t.adr && typeof t.swtcuraddr === 'function' && a !== t.adr){
                return t.swtcuraddr(a)
            }
            if(!a || a === t.pgh_adr){ return }
            await stoSaveCurrentAccount(a)
            window.location.reload()
        }
        , async pgh_open_net() {
            let t = this
            let cfgs = await stoReadChainConfigs()
            t.pgh_nets = Object.keys(cfgs).map((k) => cfgs[k]).sort((a, b) => a.id - b.id)
            let cur = await stoReadCurrentChain()
            t.pgh_curcid = (cur && parseInt(cur.id)) || 0
            t.netswct = true
            t.adrswct = false
        }
        , async pgh_swt_net(id) {
            let t = this
            t.netswct = false
            id = parseInt(id)
            if(!id && id !== 0){ return }
            if(id === t.pgh_curcid){ return }
            await stoSaveCurrentChainId(id)
            window.location.reload()
        }
    }
}

window.MNX_PGHEAD = mnx_pghead
