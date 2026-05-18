var acccurkey = 'current_account'
, accstokey = 'accounts'
, accpasswd = 'password'
, accpsskey = 'crptpskey'
, randomkey = 'randomkey'
, salthcxwlt = 'salthcxwlt'
, randomString = ctime(yes)+''
, recordRandomString = s=>{
    randomString += s
    if(randomString.length > 1024) {
        randomString = SHA256(randomString)
    }
    return randomString
}
, stoSavePassword = async (passwd) => {
    let pmd5 = MD5(passwd)
    , psk = MD5(passwd+salthcxwlt)
    , sv = {}
    , spsk = await stoReadPasskey()
    if(spsk && spsk!=psk) {
        return nil
    }
    if(!spsk){
        await stoSavePasskey(passwd)
    }
    sv[accpasswd] = {
        md5: pmd5,
        time: ctime(),
    }
    await chrome_storage_session.set(sv)
    return pmd5
}
, stoReadPassword = async (ex) => {
    let ps = await chrome_storage_session.get(accpasswd)
    , tar = ps[accpasswd] || {}
    return ex ? tar : tar.md5
}
, stoDoLock = async () => {
    await chrome_storage_session.remove(accpasswd)
}
, stoSavePasskey = async (passwd) => {
    let pmd5 = MD5(passwd+salthcxwlt)
    , sv = {}
    sv[accpsskey] = pmd5
    await chrome_storage_sync.set(sv)
    return pmd5
}
, stoReadPasskey = async () => {
    let ps = await chrome_storage_sync.get(accpsskey)
    return ps[accpsskey]
}
, stoSaveAccount = async (acc, passwd) => {
    let pmd5
    if(passwd) {
        pmd5 = await stoSavePassword(passwd)
    }else{
        pmd5 = await stoReadPassword()
    }
    let accs = await chrome_storage_sync.get(accstokey)
    accs = accs[accstokey] || {}
    accs[acc.address] = {
        cryptkey: AES_encrypt(acc.private_key, pmd5)
    }
    let sv = {}
    sv[accstokey] = accs
    await chrome_storage_sync.set(sv)
}
, stoReadAccount = async (addr) => {
    let ary = await chrome_storage_sync.get(accstokey)
    , tar = ary[accstokey] || {}
    return addr ? tar[addr] : tar
}
, stoSaveCurrentAccount = async (addr) => {
    let sv = {}
    sv[acccurkey] = addr
    await chrome_storage_sync.set(sv)
}
, stoReadCurrentAccount = async () => {
    let obj = await chrome_storage_sync.get(acccurkey)
    return obj[acccurkey]
}
, stoRemoveCurrentAccount = async () => {
    let cur = await stoReadCurrentAccount()
    let accs = await stoReadAccount()
    if(!accs[cur]){
        return no
    }
    let next = nil
    for(let k in accs){
        if(k!=cur){
            next = k
            break
        }
    }
    if(!next){
        return no
    }
    delete accs[cur]
    let sv = {}
    sv[accstokey] = accs
    await chrome_storage_sync.set(sv)
    await stoSaveCurrentAccount(next)
    return next
}
, stoUnlockAccount = async (accsv) => {
    let pmd5 = await stoReadPassword()
    if(!pmd5){
        return nil
    }
    if(!accsv) {
        let adr = await stoReadCurrentAccount()
        accsv = await stoReadAccount(adr)
    }
    return AES_decrypt(accsv.cryptkey, pmd5)
}
, stoSaveRandomKey = async (stuff) => {
    let sv = {}
    , kk = SHA256(stuff)
    sv[randomkey] = kk
    await chrome_storage_local.set(sv)
    return kk
}
, stoReadRandomKey = async () => {
    let obj = await chrome_storage_local.get(randomkey)
    return obj[randomkey]
}
, stoLocalRead = async (key, fallback) => {
    let obj = await chrome_storage_local.get(key)
    return obj[key] || fallback
}
, stoLocalSave = async (key, val) => {
    let sv = {}
    sv[key] = val
    await chrome_storage_local.set(sv)
    return val
}
, addrOmitted = a => a.substring(0, 9)+'...'+a.slice(-8)
;
