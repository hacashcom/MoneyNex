var acinfLoadLib= no
, routePageAcinf = (addr, clbk) => {

    // alert(adrnum)
    if(!acinfLoadLib){
        acinfLoadLib = yes
        injectScript('../jslib/qrcode.min.js')
    }

    let {app} = VueCreateApp('acinf', vue_tpl_acinf, {
        icfp: icfpath,
        isrcd : no,
        myadr: '',
        adrs: {},
        adrn: 1,
        privkey: nil,
    },{
        back(){
            pophpgw(()=>{
                app.unmount()
            })
        }
        , cpadr() {
            copyToClipboard(this.myadr)
            showWPtip(copyoktip)
        }
        , cppvk() {
            copyToClipboard(this.privkey)
            showWPtip(copyoktip)
        }
        , async sprivk() {
            let t = this
            let ok = await wpass_open()
            if(!ok) {
                return
            }
            let ack = await stoReadAccount(t.myadr)
            let pvk = await stoUnlockAccount(ack)
            t.privkey = pvk
        }
        , async rmvadr() {


            let t = this
            if(! (await backup_privkey_open())){
                return
            }
            let ok = await wpass_open()
            if(!ok) {
                return
            }
            // do remove — 按本页展示的地址删（t.myadr），绝不删可变的 current 指针：
            // 其它窗口可能已把 current 切到别的账户
            let curadr = await stoRemoveAccount(t.myadr)
            if(!curadr){
                // 最后一个账户被拒删（no）/ 记录不存在或写后校验失败（nil）：
                // 状态未变，留在原地不重路由
                return
            }
            // reload page
            pophpgw(()=>{
                app.unmount()
                routePageMain(curadr)
            })
            // reinit page
        }
    }, async(t)=>{
        // let acc = await stoReadAccount(addr)
        t.myadr = addr
        clbk&&clbk()
        // qrcode
        _setTimeout(()=>{
            new QRCode("acinfqrcd", addr);
        },33)

        let adrmaps = await stoReadAccount()
        , adrnum = 0
        for(let i in adrmaps) {
            adrnum++; // count
            // console.log("for in ", adrmaps[i])
        }
        t.adrs = adrmaps
        t.adrn = adrnum

        // test
        // t.privkey = '5d37b709da5388406ce959f7b16c6f04ecd99b86e798cf5086f7059f5966e134'
        return
    })


}