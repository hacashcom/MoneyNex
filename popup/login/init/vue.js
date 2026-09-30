const ACC_INIT_MV_NUM = 600;

var routePageInit = async (sc, force) => {

    // await chrome_storage_sync.clear()
    // await chrome_storage_local.clear()
    // await chrome_storage_session.clear()

    let pgname = 'init'
    // check current account
    let curadr = await stoReadCurrentAccount()
    , passwd = await stoReadPassword(yes)
    , psoverout = (passwd.time||0) + 36*60*60 < ctime()
    if(curadr && psoverout===true){
        await stoDoLock() // clear password
    }
    // Read-only review: the All Actions page is self-contained and needs no unlock.
    // NOTE: the signing page (txbody) must NOT bypass the lock screen — a locked wallet
    // would reach dosign with no way to unlock and always fail with 'Account unlocking
    // failed'; it must go through the unlock view below, then routePageMain -> sign page.
    if(!force && urlquery.key && typeof routePageActionView === 'function'){
        return await routePageActionView(curadr || '', loginSwitchCloseAll)
    }
    // console.log(curadr, passwd, psoverout)
    // console.log(`if(curadr && psoverout===false) force=`, force)
    if(curadr && psoverout===false && !force) {
        return await routePageMain(curadr, loginSwitchCloseAll)
    }
    // console.log(`VueCreateApp('init'`)
    // start mount
    let {app} = VueCreateApp(pgname, vue_tpl_init, {
        pgi: 1, // 1:create 2.import
        lgix: 0,
        lgiy: 0,
        crting: no,
        importkey: '',
        acc: nil,
        backup: no,
        setpass: no,
        // setpass: yes,
        newmode: !!force,
        unlock: no,
        pass1: '',
        pass2: '',
        ulkpass: '',
        rdnstr: '---',
        rdnbct: 0,
    }, {    
        logom3d(e) {
            let t = this
            , x = e.clientX - (windowWidth/2)
            , y = e.clientY - 150
            , bei = 20
            t.lgix = -(x/bei)
            t.lgiy = -(y/bei)
        },
        async mousemove(e){
            // generate private key
            let t = this
            , culkey = recordRandomString((e._vts+'').substring(9) + e.screenX + e.screenY)
            // init first
            if(!t.rdnstr){
                if(t.rdnbct>=ACC_INIT_MV_NUM){
                    t.rdnstr = culkey
                    await stoSaveRandomKey(SHA256(culkey))
                }
                t.rdnbct += 1
            }
            // ani
            t.logom3d(e)
        },
        clswd(){
            window.close()
            // chrome.runtime.sendMessage({ action: 'close' }, function(req) {
            //     console.log(`sendMessage({ action: 'close' } back!!! `, req)
            //     // window.close()
            // })
        },
        async create() {
            let t = this
            , pks = SHA256(recordRandomString(''))
            _setTimeout(createaccount, 15, t, pks, true)
        },
        cleanerr(){
            hideWPtip()
        },
        cprvk(){
            let t = this
            , pvk = t.acc.private_key
            ;
            copyToClipboard(pvk)
            showWPtip(copyoktip)
        },
        importpk(){
            // 1) 64-hex private key (drop whitespace, optional 0x)
            // 2) BIP39 English mnemonic (12/15/18/21/24 + checksum) -> seed[0:32]
            // 3) otherwise password: privkey = SHA256(stuff)
            let t = this
            , r = mnx_resolve_import_secret(t.importkey)
            , pk = r.stuff
            if(r.err){
                return showWPerr(r.err)
            }
            if(r.kind === 'password'){
                let echar = pk.replace(/[A-Za-z0-9\s\~\!\@\#\$\%\^\&\*\_\+\-\=\,\.\:\;]+/ig, '')
                , e1 = pk.length < 6
                , e2 = echar.length > 0
                if( e1 || e2) {
                    return showWPerr(e2 
                        ? 'The format is incorrect and includes unsupported characters'
                        : 'The password length cannot be less than 6')
                }
            }
            createaccount(t, pk, no, r.rawkey)
        },
        async dobnk(){
            if(! (await backup_privkey_open())){
                return
            }
            // next
            await this.toifhome()
        },
        async toifhome() {
            let t = this
            if(t.newmode) {
                await initroutetohome(t.acc)
            }else{
                t.setpass = yes
            }
        },
        async dopass(){
            let t = this
            if(t.pass1.length<8) {
                return showWPerr('Enter at least 8 characters')
            }
            if(t.pass1 != t.pass2) {
                return showWPerr('Password not macth')
            }
            // save password
            await initroutetohome(t.acc, t.pass1)
        },
        pskup(e){
            // console.log(e)
            if(e.code == 'Enter') {
                this.doulk().then()
            }
        },
        async doulk() {
            // await chrome_storage_sync.clear()
            // await chrome_storage_local.clear()
            var t = this
            , p = t.ulkpass
            if(!p) {
                return showWPerr('Please enter your password')
            }
            let pm = MD5(p+salthcxwlt)
            , psk = await stoReadPasskey()
            if(psk != pm){
                return showWPerr('Password error')
            }
            // unlock success / update password
            await stoSavePassword(p)
            $display_none(btlginit)

            // ok
            await initroutetohome(t.acc, p)
        },
    }, async (t)=>{
        let key = await stoReadRandomKey()
        // console.log(key)
        if(key){
            t.rdnstr = key
            await recordRandomString(key)
        }else{
            t.rdnstr = nil
        }
        // if goto lock page
        let gotolockpage = curadr && psoverout===true && !force
        if(gotolockpage) {
            t.unlock = yes
            // auto focus
            _setTimeout(()=>{
                t.$refs.iptpw.focus()
            }, 50)
        }
        sc&&sc()
        
        
        // test
        // t.create()
    })

    async function initroutetohome(acc, pass) {
        let adr
        if(acc){
            let saved = await stoSaveAccount(acc, pass)
            if(!saved){
                // 会话已锁且没有可用口令：账户未落盘，也绝不把 current_account
                // 指向一个不存在的记录（否则后续签名会一直解锁失败）
                showWPerr('Wallet is locked — unlock first, then retry')
                return
            }
            adr = acc.address
            await stoSaveCurrentAccount(adr)
        }else{
            adr = await stoReadCurrentAccount()
        }
        // console.log(await stoReadPassword())
        // console.log(await stoReadAccount())
        // console.log(await stoReadCurrentAccount())

        // route to home
        await routePageMain(adr)
        app.unmount()
        // save key
        let rdk = SHA256(recordRandomString(''))
        await stoSaveRandomKey(rdk)
    }
    
    
    function createaccount(t, stuff, iscreatenew, rawkey) {
        t.crting = yes
        // SDK: privkey 默认 = SHA256(口令)（与旧 wasm create_account_by 派生一致）；
        // rawkey=true 表示 stuff 已是 64-hex 私钥（直接导入，或由助记词 BIP39 seed 得到）。
        let keyhex = rawkey ? stuff : SHA256(stuff)
        mnx_derive_address(keyhex).then(res => {
            t.crting = false
            t.acc = res
            // console.log(res)
            if(iscreatenew) {
                t.backup = yes
            }else{
                t.toifhome().then()
            }
        }, e => {
            t.crting = false
            showWPerr(mnx_err_message(e))
        })
    }
    
    




}

