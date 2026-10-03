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
        t._passwordAttempt = nil
        // t.okbtn = 'Confirm'
        _clearTimeout(t._ht)
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
        t._passwordAttempt = nil
        t.cnsh = no
        _clearTimeout(t._ht)
        t._ht = _setTimeout(()=>{
            t.show = no
        },500)
    },
    clear(){
        this.err = ''
    },
    async cok(){
        let t = this
        , p = t.pswd
        , attempt = {}
        , dops = async (p)=>{
            t._passwordAttempt = attempt
            try {
            let md5 = MD5(p+salthcxwlt)
            , pmd5 = await stoReadPasskey()
            if(t._passwordAttempt !== attempt) { return }
            if(md5 != pmd5){
                t.err = "Wrong password"
            }else{
                let saved = await stoSavePassword(p)
                if(t._passwordAttempt !== attempt) { return }
                if(!saved) {
                    t.err = 'Wallet unlock failed. Refresh the wallet and try again.'
                    return
                }
                let callback = t.c1
                t.hide()
                callback&&callback()
            }
            } catch(e) {
                if(t._passwordAttempt === attempt) {
                    t.err = 'Wallet unlock failed. Refresh the wallet and try again.'
                }
            } finally {
                if(t._passwordAttempt === attempt) { t._passwordAttempt = nil }
            }
        }
        if(p) {
            if(p.length < 8){
                t.err = "Use at least 8 characters"
            }else{
                await dops(p)
            }
        }else{
            t.err = "Enter password"
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
