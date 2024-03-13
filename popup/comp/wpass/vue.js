
let {ctx: wpass} = VueCreateApp('wpass', vue_tpl_wpass, {
    show: no,
    cnsh: no,
    tip: '',
    okbtn: btncon_confirm,
    col: '',
    c1: nil,
    c2: nil,
    err: '',
    pswd: '',
}, {
    open(okcall, cancelcall){
        let t = this
        // t.okbtn = 'Confirm'
        t.pswd = '' // reset
        t.c1 = okcall
        t.c2 = cancelcall
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
    clear(){
        this.err = ''
    },
    cok(){
        let t = this
        , p = t.pswd
        , dops = async (p)=>{
            let md5 = MD5(p+salthcxwlt)
            , pmd5 = await stoReadPasskey()
            if(md5 != pmd5){
                t.err = "Password error"
            }else{
                // pass check ok !!!
                t.c1&&t.c1()
                t.hide()
                await stoSavePassword(p)
            }
        }
        if(p) {
            if(p.length < 8){
                t.err = "Minimum length 8"
            }else{
                dops( p ).then()
            }
        }else{
            t.err = "Please enter password"
        }

        // t.c1 && t.c1()
        // t.hide()
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
, wpass_open = async ()=>{
    return new _Promise((ret)=>{
        // open
        wpass.open(function(){
            ret(yes)
        }, function(){
            ret(no)
        })
        // auto focus
        _setTimeout(()=>{
            wpass.$refs.iptpw.focus()
        }, 500)
    })
}


// test
// _setTimeout(async ()=>{

//     await wpass_open()

// }, 100)
