var routePageSignTex = (adr, clbk) => {
    async function currentTexContext(){
        if(typeof stoReadCurrentChain !== 'function') return await mnx_chain_context()
        let before = await stoReadCurrentChain()
        if(!before || !/^https?:\/\//.test(String(before.rpc || ''))) throw new Error('The selected network RPC is unavailable')
        let chainId = String(before.id)
        if(!/^\d+$/.test(chainId)) throw new Error('The selected network has an invalid chain ID')
        let rpc = String(before.rpc).replace(/\/+$/, '')
        let ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 5000)
        let get = async path => {
            let response = await fetch(rpc + path, {method:'GET',cache:'no-store',signal:ctrl.signal})
            if(!response.ok) throw new Error('Selected network RPC returned HTTP ' + response.status)
            let data = await response.json()
            if(!data || data.err || data.error || (data.ret != null && Number(data.ret) !== 0)) throw new Error('Selected network RPC query failed')
            return data
        }
        let height
        try {
            let status = await get('/status')
            if(status.chain_id == null || !/^\d+$/.test(String(status.chain_id)) || BigInt(status.chain_id).toString() !== BigInt(chainId).toString()) throw new Error('Selected network RPC reports a different chain ID')
            let latest = await get('/query/latest')
            if(latest.height == null || !/^\d+$/.test(String(latest.height))) throw new Error('Selected network RPC returned an invalid block height')
            height = String(latest.height)
        } finally { clearTimeout(timer) }
        let after = await stoReadCurrentChain()
        if(!after || String(before.id) !== String(after.id) || String(before.rpc) !== String(after.rpc)){ throw new Error('The selected network changed while the authorization was being reviewed') }
        return { expected_chain_id: after.id, current_height: height, has_height: true }
    }
    function assertTexNotExpired(context, conditions){
        if(!conditions || !conditions.length) return
        if(!context.has_height) throw new Error('The current chain height is unavailable')
        let height = BigInt(context.current_height)
        for(let c of conditions){
            if(c.value == null || (c.operator !== 'at_most' && c.operator !== 'at_least')) throw new Error('This authorization contains an unsupported height condition')
            if(c.operator === 'at_most' && height > BigInt(c.value)) throw new Error('This authorization has expired')
        }
    }
    let {answerOnce, closeWin, cancelAndClose, nop} = mnx_dapp_reply('TEX authorization signing', 'User canceled the TEX authorization')
    let {app} = VueCreateApp('sgtex', vue_tpl_signtex, {
        icfp: icfpath,
        dmu: urlquery.dmu,
        adr,
        sadr: addrOmitted(adr || ''),
        auth: null,
        review: null,
        cells: [],
        unknown: [],
        error: '',
        loading: true,
        signing: false,
        end: false,
        ende: false,
        payments: [],
        receipts: [],
        window: {min: null, max: null},
        windowState: 'No height bounds',
        expiryEstimate: 'No height-based expiry condition',
        context: {},
        nop,
    }, {
        async loadAuthorization() {
            await mnx_sdk_ready()
            let abiMinor = parseInt(mnx_sdk_version_info && mnx_sdk_version_info.abi && mnx_sdk_version_info.abi.minor, 10)
            if(!Number.isFinite(abiMinor) || abiMinor < 8) throw new Error('TEX authorization signing requires Hacash SDK ABI 2.8 or newer')
            let key = urlquery.mlkey
            if(!key){ throw new Error('Missing TEX authorization request') }
            let stored = await chrome_storage_session.get(key)
            let extra = stored && stored[key]
            let authorization = extra && extra.authorization
            if(!authorization || authorization.schema !== 'hacash.tex/authorization@1' || !Array.isArray(authorization.cells)){
                throw new Error('The authorization request is malformed or uses an unsupported schema')
            }
            let built = await sdk_tex_build(authorization)
            if(!built || !built.authorization || built.authorization.schema !== 'hacash.tex/authorization@1' || !Array.isArray(built.authorization.cells)) throw new Error('The SDK did not return canonical authorization contents')
            this.auth = built.authorization
            let review = await sdk_tex_inspect(this.auth)
            if(!built || built.schema !== 'hacash.tex/bundle@1' || built.address !== authorization.address || built.authorization.address !== authorization.address || built.repeatable !== true || built.execution_guaranteed !== false){
                throw new Error('The SDK returned a mismatched canonical TEX bundle')
            }
            if(!review.authorization || review.authorization.address !== authorization.address || !Array.isArray(review.cells)){ 
                throw new Error('The SDK could not provide a complete TEX authorization review')
            }
            if(review.unknown_conditions && review.unknown_conditions.length || review.cells.some(cell => cell.category === 'unknown')){
                throw new Error('This authorization contains conditions the wallet cannot safely explain')
            }
            this.review = review
            this.cells = review.cells
            this.unknown = review.unknown_conditions || []
            this.payments = (review.payments || []).map(fact => ({...fact, description:(review.cells.find(cell => cell.index === fact.index) || {}).description || ''}))
            this.receipts = (review.receipts || []).map(fact => ({...fact, description:(review.cells.find(cell => cell.index === fact.index) || {}).description || ''}))
            this.context = await currentTexContext()
            let conditions = review.chain_id_condition || []
            let hasPayments = review.cells.some(cell => cell.category === 'pay')
            if(hasPayments && !conditions.some(c => c.operator === 'eq')){
                throw new Error('Payments require an explicit chain guard; this authorization has none')
            }
            for(let c of conditions){
                if(c.operator !== 'eq' || c.value == null || BigInt(c.value).toString() !== BigInt(this.context.expected_chain_id).toString()){
                    throw new Error('This authorization contains an unsupported or mismatched network condition')
                }
            }
            if(Array.isArray(review.height_conditions) && review.height_conditions.length){
                if(!this.context.has_height){ throw new Error('The current chain height is unavailable; height conditions cannot be reviewed safely') }
                assertTexNotExpired(this.context, review.height_conditions)
                let limits = review.height_conditions.reduce((a, c) => { if(c.operator === 'at_most') a.max = a.max == null || BigInt(c.value) < a.max ? BigInt(c.value) : a.max; else a.min = a.min == null || BigInt(c.value) > a.min ? BigInt(c.value) : a.min; return a }, {min:null,max:null})
                if(limits.min != null && limits.max != null && limits.min > limits.max) throw new Error('This authorization has contradictory height conditions')
                this.window = {min: limits.min == null ? null : limits.min.toString(), max: limits.max == null ? null : limits.max.toString()}
                this.windowState = limits.min != null && BigInt(this.context.current_height) < limits.min ? 'Scheduled: begins at the minimum height' : 'Currently within the height window'
                if(limits.max != null){
                    let remaining = limits.max - BigInt(this.context.current_height)
                    let days = remaining > 0n ? remaining / 288n : 0n
                    this.expiryEstimate = (days > 0n ? '~' + days.toString() + ' days' : 'less than 1 day') + ' at 288 blocks/day; the maximum height is authoritative'
                }
            }
        },
        async sign() {
            if(this.signing || this.error || !this.review) return
            this.signing = true
            let accepted = await wpcfm_open('This authority can execute repeatedly and cannot be revoked after signing. Once a payment becomes affordable, it may execute again. Get cells describe what the account can receive from escrow; they do not grant payment authority. Continue?', 'Approve TEX authority')
            if(!accepted){ cancelAndClose('User rejected the TEX authorization'); return }
            try {
                let current = await stoReadCurrentAccount()
                if(current !== this.adr || this.auth.address !== this.adr){ throw new Error('The selected account changed after review; reopen this request to review it again') }
                let ctx = await currentTexContext()
                if(String(ctx.expected_chain_id) !== String(this.context.expected_chain_id)) throw new Error('The selected network changed after review; reopen this request')
                if(Array.isArray(this.review.height_conditions) && this.review.height_conditions.length){
                    if(!ctx.has_height) throw new Error('The current chain height is unavailable; reopen this request')
                    assertTexNotExpired(ctx, this.review.height_conditions)
                }
                let request = await sdk_tex_prepare_signature(this.auth, this.adr, urlquery.dmu)
                if(!request || request.schema !== 'hacash.sdk/signing-request@1' || request.purpose !== 'tex_authorization' || request.signer_address !== this.adr || !request.digest || !request.request_binding || !request.body_hash || !request.review_binding) throw new Error('The SDK returned an invalid TEX signing request')
                let signed = await stoCurAccDoSign(request.digest)
                if(signed.err) throw new Error(signed.err)
                let proof = {
                    schema: 'hacash.sdk/signature-proof@1',
                    request_id: request.id,
                    request_binding: request.request_binding,
                    public_key: signed.pubkey,
                    signature: signed.signature,
                    algorithm: 'secp256k1-rfc6979-sha256',
                }
                if(await stoReadCurrentAccount() !== this.adr) throw new Error('The selected account changed while signing; the signature was discarded')
                let postSignContext = await currentTexContext()
                if(String(postSignContext.expected_chain_id) !== String(this.context.expected_chain_id)) throw new Error('The selected network changed while signing; discard this approval and review again')
                assertTexNotExpired(postSignContext, this.review.height_conditions)
                let bundle = await sdk_tex_attach_signature(this.auth, request, proof)
                if(!bundle || bundle.schema !== 'hacash.tex/signed-bundle@1' || bundle.authorization.address !== this.adr) throw new Error('The SDK returned a mismatched signed TEX bundle')
                let verified = await sdk_tex_verify(bundle.action)
                if(!verified || verified.ok !== true) throw new Error('The SDK could not verify the TEX signature')
                if(await stoReadCurrentAccount() !== this.adr) throw new Error('The selected account changed before approval completed')
                let finalContext = await currentTexContext()
                if(String(finalContext.expected_chain_id) !== String(this.context.expected_chain_id)) throw new Error('The selected network changed before approval completed')
                assertTexNotExpired(finalContext, this.review.height_conditions)
                await answerOnce({ret: 0, success: true, authorization: this.auth, signed_authorization: bundle, proof, review_binding: request.review_binding, address: this.adr})
                this.end = true
                setTimeout(this.nop, 2500)
                setTimeout(() => this.ende = true, 150)
            } catch(e) {
                this.error = mnx_err_message(e)
                await answerOnce({ret: 1, err: this.error, code: 'sign_refused'})
            } finally { this.signing = false }
        }
    }, async t => {
        clbk && clbk()
        try { await t.loadAuthorization() }
        catch(e) { t.error = mnx_err_message(e); await answerOnce({ret: 1, err: t.error, code: 'sign_refused'}) }
        t.loading = false
    }, nil, { components: { pghead: pgheadAppObj } })
}
