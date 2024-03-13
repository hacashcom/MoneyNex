

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
                if(t.rdnbct>=600){
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
            let t = this
            , pk = t.importkey
            , echar = pk.replace(/[A-Za-z0-9\~\!\@\#\$\%\^\&\*\_\+\-\=\,\.\:\;]+/ig, '')
            , e1 = pk.length < 6
            , e2 = echar.length > 0
            // console.log(pk)
            if( e1 || e2) {
                return showWPerr(e2 
                    ? 'The format is incorrect and includes unsupported characters'
                    : 'The password length cannot be less than 6')
            }
            // console.log(pk)
            createaccount(t, pk)
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
            adr = acc.address
            await stoSaveAccount(acc, pass)
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
    
    
    function createaccount(t, stuff, iscreatenew) {
        t.crting = yes
        // let res = await sendMessage({
        //     action: msg_create_account_by,
        //     stuff,
        // })
        let res = JSON_parse(hacash_api.create_account_by(stuff))
        t.crting = false
        t.acc = res
        // console.log(res)
        if(iscreatenew) {
            t.backup = yes
        }else{
            t.toifhome().then()
        }
    }
    
    




}

