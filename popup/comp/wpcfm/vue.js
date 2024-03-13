
let {ctx: wpcfm} = VueCreateApp('wpcfm', vue_tpl_wpcfm, {
    show: no,
    cnsh: no,
    tip: '',
    okbtn: 'OK',
    col: '',
    c1: nil,
    c2: nil,
}, {
    open(tip, okbtn, okcall, cancelcall, colset){
        let t = this
        t.tip = tip
        t.okbtn = okbtn||'OK'
        t.c1 = okcall
        t.c2 = cancelcall
        t.col = colset||''
        t.show = yes
        _setTimeout(()=>{
            t.cnsh = yes
        },21)
    },
    hide(){
        let t = this
        t.cnsh = no
        _setTimeout(()=>{
            t.show = no
        },500)
    },
    cok(){
        let t = this
        t.c1 && t.c1()
        t.hide()
    },
    ccl(){
        let t = this
        t.c2 && t.c2()
        t.hide()
    },
    cbg(){
        this.hide()
    }
})
, wpcfm_open = async (tip, ok, color)=>{
    return new _Promise((ret)=>{
        wpcfm.open(tip, ok, function(){
            ret(yes)
        }, function(){
            ret(no)
        }, color)
    })
}
, backup_privkey_open = async ()=>{
    return (await wpcfm_open(`If you don't back up your private key, you risk losing all your assets permanently`, 
    'I have backed up the private key', 
    'red'))
}

// test
// _setTimeout(()=>{

//     wpcfm.open('hahaha', 'Confirm', function(){
//         alert('yes!')
//     }, function(){
//         // alert('no')
//     })

// }, 100)
