
// wphelp — shared "?" help sheet: an explanation paragraph plus a single OK
// button. Unlike wpcfm (a two-button confirm), a help hint has no decision to
// make; any page's <button>?</button> opens it via wphelp_open(text).
let {ctx: wphelp} = VueCreateApp('wphelp', vue_tpl_wphelp, {
    show: no,
    cnsh: no,
    tip: '',
}, {
    open(tip){
        let t = this
        _clearTimeout(t._ht)
        t.tip = tip
        t.show = yes
        _setTimeout(()=>{
            t.cnsh = yes
        },21)
    },
    hide(){
        let t = this
        t.cnsh = no
        _clearTimeout(t._ht)
        t._ht = _setTimeout(()=>{
            t.show = no
        },500)
    },
    cok(){
        let t = this
        t.c1 && t.c1()
        t.hide()
    }
})
, wphelp_open = (tip)=>{
    return new _Promise((ret)=>{
        wphelp.open(tip)
        // Resolves on dismiss; a help hint has no cancel branch.
        wphelp.c1 = function(){ ret(yes) }
    })
}
