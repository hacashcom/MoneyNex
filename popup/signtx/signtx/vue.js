
var routePageSignTx = (adr, clbk) => {

    let txbody = urlquery.txbody||''
    if(!txbody){
        return alert('tx body must give!')
    }
    let params = {}
    , sa = 'sign_addr'
    // console.log(txbody)
    // ok
    let {app} = VueCreateApp('sgtx', vue_tpl_signtx, {
        icfp: icfpath,
        dmu: urlquery.dmu,
        end: no,
        ende: no,
        ing: no,
        lding: yes,
        adr: adr,
        sadr: addrOmitted(adr),
        adrswct: no,
        adrmaps: {},
        txres: {},
        txsgck: {},
        txdesc: [],
        txerr: nil,
        // swtgas app
        // gasw: nil,
    },{
        nop() {
            window.close()
        }
        // check trs
        , async crtrs() {
            let t = this
            t.lding = yes
            params[sa] = t.adr
            // console.log(txobj)
            // await sleep(500)
            let resp = await checkTx(txbody, params)
            t.txsgck = resp.need_sign_address
            console.log(resp)
            t.lding = no
            t.txres = resp
            t.txdesc = parseTxDesc(resp)
            // deal err
            t.txerr = resp.error || nil
            // req
        }   
        , async cfim() {
            let t = this
            if(t.txerr){
                return
            }
            if( ! await wpcfm_open('Once the transaction is signed, it cannot be reversed, can it be confirmed?', 'Confirm')  ) {
                return
            }
            // do sign
            t.dosign().then()
        }
        , async openadrswct() {
            let t = this
            t.adrmaps = await stoReadAccount()
            t.adrswct = yes
        }
        ,async swtcuraddr(adr) {
            let t = this
            t.adr = adr
            t.sadr = addrOmitted(adr)
            t.adrswct = no
            await stoSaveCurrentAccount(adr)
            await t.crtrs() // refresh tx
        }
        , async dosign(){
            let t = this
            // , gasset = t.gasw.get()
            if(t.ing) return
            t.ing = yes;
            // console.log(gasset,"HAC gas")
            let signobj = await stoCurAccDoSign(t.txres.sign_hash)
            console.log("signobj", signobj)
            if(signobj.err) {
                t.txerr = signobj.err
                t.ing = yes;
                return
            }
            // req new tx body
            params.sign_pubkey = signobj.pubkey
            params.sign_data = signobj.signature
            let resp = await checkTx(txbody, params)
            t.txsgck = resp.need_sign_address
            console.log(resp)
            // success return
            await returnDataToUserPage(t.txres)
            // ok
            t.ing = no
            t.end = yes
            // _setTimeout(t.nop, 2500)
            _setTimeout(_=>t.ende=1, 150)
            // ok
            // showWPtip("Tx submitted successfully!")
            // close window
            // window.href = './moneynex.html'
        }
    }, async(t)=>{
        clbk && clbk()   
        // t.gasw = t.$refs.swtgas
        // t.gasw.swt(gas => {
        //     // console.log(gas)
        //     txobj.fee = gas+''
        //     t.crtrs().then()
        // })
        // console.log("t.gasw ", t.gasw , t.$refs)
        await t.crtrs()
        // await t.agas.req()
        // console.log()
    }/*, nil, {
        components: {
            swtgas: swtgasAppObj,
        },
    }*/);


}


function parseTxDesc(tx) {
    let txdesc = []
    if(!tx || !tx.description){
        return []
    }
    // parse 1[a-km-zA-HJ-NP-Z0-9]{26,33}
    let parse = (i, v) => {
        let li = v.replace(/(\s[0-9\.]+)HAC\s/g, ` <b class="amt">$1</b> HAC `)
            .replace(/([a-km-zA-HJ-NP-Z1-9]{28,34})/g, ` <a class="addr" href="https://explorer.hacash.org/address/$1" target="_blank" title="$1">$1</a> `)
        return `<span>${1+i}</span> ${li}`
    }
    let desc = tx.description
    for(let i in desc){
        let li = desc[i]
        txdesc.push(parse(parseInt(i), li))
    }
    return txdesc
}