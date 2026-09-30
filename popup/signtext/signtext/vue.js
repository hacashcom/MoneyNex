

var routePageSignText = (adr, clbk) => {

    // Single-reply contract (shared helper): reply to the DApp once (success data or {err}), then close.
    // Cancel / confirm-reject / sign failure must all reply {err} before closing, or the DApp waits forever.
    let {isAnswered, answerOnce, closeWin, cancelAndClose} = mnx_dapp_reply('Signing request')
    // Whether input "looks like a raw 32B hash / key-like data": hex-64 (0x/0X prefix and any whitespace allowed),
    // or 43-char pure base64/url-base64 (a 32B payload encodes to exactly 43 chars, optional single '=' padding).
    // Such text is always refused — never endorse an unreadable hash/authorization string as "meaningful text".
    function looksLikeRawDigest(s){
        let t = String(s || '').trim()
        if(!t){ return no }
        let compact = t.replace(/\s+/g, '').replace(/^0x/i, '')
        if(/^[0-9a-fA-F]{64}$/.test(compact)){ return yes }
        // 43×6=258 bits = 32B + 2 redundant bits: any 43-char pure base64 can only decode to a 32-byte payload
        let b64 = compact.replace(/=+$/, '')
        if(b64.length === 43 && /^[A-Za-z0-9+/_-]{43}$/.test(b64)){ return yes }
        return no
    }

    let {app} = VueCreateApp('sgtxt', vue_tpl_signtext, {
        icfp: icfpath,
        dmu: urlquery.dmu,
        end: no,
        ende: no,
        ing: no,
        lding: yes,
        adr: adr,
        text: '',
        digest: '',
        texterr: '',
    },{
        nop() {
            if(isAnswered()){ closeWin(); return }
            cancelAndClose('User canceled the signing request')
        }
        // Text written to session storage by background (multi-line text doesn't fit a URL)
        , async loadtext() {
            let t = this
            let text = ''
            try {
                if(urlquery.mlkey && typeof chrome_storage_session !== 'undefined'){
                    let obj = await chrome_storage_session.get(urlquery.mlkey)
                    let extra = obj && obj[urlquery.mlkey]
                    text = (extra && extra.text) || ''
                    // Cleanup after use (don't leave sensitive plaintext in session storage)
                    chrome_storage_session.remove(urlquery.mlkey)
                }
            } catch(e) {}
            if(!text && urlquery.text){ text = decodeURIComponent(urlquery.text) }
            t.text = String(text || '')
        }
        // Security checks + digest computation:
        // Red line 1: refuse to sign a raw 32-byte hash (hex/base64 variants, prevents use as an unknown endorsement).
        // Red line 2: refuse text that is too short / too long.
        // Digest = SHA-256(text), a completely different signing domain from transactions (sha3-256 tx body), so a
        // text signature can mathematically never be replayed as a transaction signature.
        , async checktext() {
            let t = this
            let s = t.text
            if(looksLikeRawDigest(s)){
                t.texterr = 'Refusing to sign a raw 32-byte hash: never endorse unknown transactions or authorizations'
                t.digest = ''
                return
            }
            if(s.length < 8 || s.length > 4096){
                t.texterr = 'Text length must be between 8 and 4096 characters'
                t.digest = ''
                return
            }
            t.texterr = ''
            t.digest = SHA256(s)
        }
        , async cfim() {
            let t = this
            if(t.texterr || !t.digest){
                return
            }
            if( ! await wpcfm_open('Once signed, the signature cannot be revoked and represents your approval of the entire text above. Confirm?', 'Confirm') ) {
                cancelAndClose('User canceled the signing request')
                return
            }
            t.dosign().then()
        }
        , async dosign(){
            let t = this
            if(t.ing) return
            t.ing = yes
            // digest = SHA-256(text) (32B hex); pure-JS ECDSA, signed locally
            let sv = await stoCurAccDoSign(t.digest)
            let signerr = sv.err
            if(signerr) {
                t.texterr = signerr
                t.ing = no
                // Terminal failure: notify the DApp (user unlocks/resolves and re-initiates after close)
                answerOnce({ret: 1, err: signerr, code: 'sign_failed'}).then(()=>{
                    _setTimeout(closeWin, 800)
                })
                return
            }
            await answerOnce({
                ret: 0,
                success: true,
                text: t.text,
                digest: t.digest,
                public_key: sv.pubkey,
                signature: sv.signature,
                address: t.adr,
            })
            t.ing = no
            t.end = yes
            _setTimeout(t.nop, 2500)
            _setTimeout(_=>t.ende=1, 150)
        }
    }, async (t)=>{
        clbk && clbk()
        await t.loadtext()
        await t.checktext()
        t.lding = no
    });


}
