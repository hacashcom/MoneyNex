// Real page-target WASM roundtrip. Uses only deterministic test key 1; no wallet
// account, stored secret, network access, or transaction broadcast is involved.
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')
const elliptic = require('../jslib/elliptic.min.js')

;(async () => {
    const sandbox = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, WebAssembly, URL, Response, fetch, setTimeout, clearTimeout, atob, btoa }
    sandbox.window = { atob }
    vm.createContext(sandbox)
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../jslib/hacash_sdk.js'), 'utf8'), sandbox)
    assert.equal(typeof sandbox.hacash_sdk, 'function', 'page-target SDK factory is missing')
    const sdk = await sandbox.hacash_sdk()
    const invoke = (id, payload) => {
        const raw = sdk.sdk_invoke_json(id, new TextEncoder().encode(JSON.stringify(payload || {})))
        const envelope = JSON.parse(raw)
        if(envelope.ok !== 1) throw Object.assign(new Error(envelope.msg || 'SDK failure'), {code:envelope.code, detail:envelope.detail})
        return envelope.body
    }
    const version = invoke(1, {})
    assert.equal(version.schema, 'hacash.sdk/sdk-version@1')
    assert.equal(String(version.abi.major), '2')
    assert.ok(Number(version.abi.minor) >= 8, `TEX requires ABI 2.8+, got ${version.abi.minor}`)
    assert.equal(sdk.sdk_transport_version(), 11)

    const privateKey = '0'.repeat(63) + '1'
    const ec = new elliptic.ec('secp256k1')
    const key = ec.keyFromPrivate(privateKey, 'hex')
    const publicKey = key.getPublic(true, 'hex')
    const {address} = invoke(13, {public_key:publicKey})
    const authorization = {
        schema: 'hacash.tex/authorization@1',
        address,
        cells: [
            {cellid:1, haczhu:'100000000'},
            {cellid:25, chainid:0},
        ],
    }
    const built = invoke(26, {authorization})
    assert.equal(built.schema, 'hacash.tex/bundle@1')
    assert.equal(built.authorization.address, address)
    assert.equal(built.repeatable, true)
    assert.equal(built.execution_guaranteed, false)
    const inspect = invoke(27, {authorization})
    assert.equal(inspect.authorization.address, address)
    assert.deepEqual(inspect.chain_id_condition, [{operator:'eq',value:'0'}])
    assert.equal(inspect.payments[0].cellid, 1)
    assert.match(inspect.cells[0].description, /1 HAC \(100000000 zhu\)/)

    // Exercise the wallet facade's lossless parser with an amount beyond
    // Number.MAX_SAFE_INTEGER. The SDK description and canonical cell must
    // retain the same atomic-unit value all the way into the approval model.
    const largeAuthorization = {
        schema: 'hacash.tex/authorization@1', address,
        cells: [
            {cellid:1, haczhu:'9007199254740993'},
            {cellid:7, asset:{serial:'9007199254740993',amount:'9007199254740993'}},
            {cellid:8, asset:{serial:'9007199254740993',amount:'9007199254740993'}},
            {cellid:25, chainid:0},
        ],
    }
    const largeRaw = sdk.sdk_invoke_json(27, new TextEncoder().encode(JSON.stringify({authorization:largeAuthorization})))
    assert.match(largeRaw, /9007199254740993/)
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../jslib/moneynx_sdk_facade.js'), 'utf8'), sandbox)
    const losslessInspection = await sandbox.sdk_tex_inspect(largeAuthorization)
    assert.equal(losslessInspection.cells[0].cell.haczhu, '9007199254740993')
    assert.match(losslessInspection.cells[0].description, /90071992\.54740993 HAC \(9007199254740993 zhu\)/)
    assert.equal(losslessInspection.cells[1].cell.asset.serial, '9007199254740993')
    assert.equal(losslessInspection.cells[1].cell.asset.amount, '9007199254740993')
    assert.equal(losslessInspection.cells[2].cell.asset.serial, '9007199254740993')
    assert.equal(losslessInspection.cells[2].cell.asset.amount, '9007199254740993')

    const request = invoke(28, {authorization, signer_address:address, origin:'https://test.invalid'})
    assert.equal(request.purpose, 'tex_authorization')
    assert.ok(request.request_binding && request.review_binding && request.body_hash)
    const digest = Buffer.from(request.digest, 'hex')
    const signature = ec.sign(digest, privateKey, {canonical:true})
    const pad = value => value.toString(16).padStart(64, '0')
    const proof = {
        schema:'hacash.sdk/signature-proof@1',
        request_id:request.id,
        request_binding:request.request_binding,
        public_key:publicKey,
        signature:pad(signature.r) + pad(signature.s),
        algorithm:'secp256k1-rfc6979-sha256',
    }
    const signed = invoke(29, {authorization, request, proof})
    assert.equal(signed.schema, 'hacash.tex/signed-bundle@1')
    assert.ok(/^0x[0-9a-f]+$/i.test(signed.action))
    const verified = invoke(30, {action:signed.action})
    assert.equal(verified.ok, true)
    assert.equal(verified.address, address)
    assert.throws(() => invoke(30, {action:signed.action.slice(0, -2)}))
    assert.throws(() => invoke(29, {authorization, request, proof:{...proof, signature:'00'.repeat(64)}}))

    // Run the actual approval page controller using the real wallet facade
    // and WASM SDK. Signing uses deterministic test key 1 only.
    const pageSource = fs.readFileSync(path.join(__dirname, '../popup/signtex/signtex/vue.js'), 'utf8')
    const pageAuthorization = authorization
    const answers = []
    let pageModel, mounted
    Object.assign(sandbox, {
        urlquery:{mlkey:'ml-real-wasm',dmu:'https://test.invalid'}, icfpath:'', nil:null,
        vue_tpl_signtex:'', pgheadAppObj:{}, addrOmitted:value=>value,
        mnx_chain_context:async()=>({expected_chain_id:0,current_height:'100',has_height:true}),
        chrome_storage_session:{get:async()=>({'ml-real-wasm':{authorization:pageAuthorization}})},
        mnx_dapp_reply:()=>({answerOnce:async v=>answers.push(v),closeWin:()=>{},cancelAndClose:async m=>answers.push({ret:1,err:m}),nop:()=>{}}),
        VueCreateApp(id, template, data, methods, onMounted){
            pageModel=Object.assign({},data)
            for(const [name,fn] of Object.entries(methods)) pageModel[name]=fn.bind(pageModel)
            mounted=onMounted
            return {app:pageModel}
        },
        wpcfm_open:async()=>true,
        stoReadCurrentAccount:async()=>address,
        stoCurAccDoSign:async digestHex=>{
            const sig=ec.sign(Buffer.from(digestHex,'hex'),privateKey,{canonical:true})
            return {pubkey:publicKey,signature:pad(sig.r)+pad(sig.s)}
        },
        setTimeout:()=>1, clearTimeout:()=>{}, AbortController,
    })
    vm.runInContext(pageSource, sandbox)
    sandbox.routePageSignTex(address)
    await mounted(pageModel)
    assert.equal(pageModel.error,'')
    assert.equal(pageModel.cells.length,2)
    await pageModel.sign()
    assert.equal(answers.length,1)
    assert.equal(answers[0].success,true)
    assert.equal(answers[0].signed_authorization.schema,'hacash.tex/signed-bundle@1')
    assert.equal(invoke(30,{action:answers[0].signed_authorization.action}).ok,true)
    console.log(`real TEX approval page roundtrip passed: ABI ${version.abi.major}.${version.abi.minor}, transport ${sdk.sdk_transport_version()}, deterministic test key, large-integer preservation, build/inspect/prepare/attach/verify`)
})().catch(e => { console.error(e); process.exitCode = 1 })
