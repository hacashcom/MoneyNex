const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert/strict')

const source = fs.readFileSync(path.join(__dirname, '../popup/signtex/signtex/vue.js'), 'utf8')
const address = '1' + '1'.repeat(33)

const routing = fs.readFileSync(path.join(__dirname, '../jslib/message-types.js'), 'utf8')
const listener = fs.readFileSync(path.join(__dirname, '../background/listener.js'), 'utf8')
const background = fs.readFileSync(path.join(__dirname, '../background/init.js'), 'utf8')
const contentApi = fs.readFileSync(path.join(__dirname, '../content/hacash_api.min.js'), 'utf8')
const buildCfg = fs.readFileSync(path.join(__dirname, '../build.cfg.js'), 'utf8')
assert.match(routing, /optkey_sign_tex\s*=\s*["']signtex["']/)
assert.match(routing, /optkey_list_to_popup[\s\S]*optkey_sign_tex/)
assert.match(contentApi, /"signtex"/)
assert.match(listener, /isConnectAuthorized\(origin\)/)
assert.match(background, /authorization:\s*1/)
assert.match(buildCfg, /'signtex':[\s\S]*\['signtex'\]/)
const authorization = { schema: 'hacash.tex/authorization@1', address, cells: [{ cellid: 25, chainid: 0 }, { cellid: 1, haczhu: '100000000' }] }

function harness(overrides = {}) {
    const calls = { answers: [], signed: 0, attached: 0 }
    let model, mounted
    const base = {
        urlquery: { mlkey: 'ml-test', dmu: 'https://example.test' },
        mnx_sdk_ready: async () => {}, mnx_sdk_version_info: {abi:{minor:8}}, queryLatestHeight: async () => '100',
        icfpath: '', nil: null, vue_tpl_signtex: '', pgheadAppObj: {},
        VueCreateApp(id, template, data, methods, onMounted) {
            model = Object.assign({}, data)
            for(const [key, fn] of Object.entries(methods)) model[key] = fn.bind(model)
            mounted = onMounted
            return { app: model }
        },
        mnx_dapp_reply: () => ({
            answerOnce: async value => { calls.answers.push(value) },
            closeWin: () => {}, cancelAndClose: async message => calls.answers.push({ret:1,err:message,code:'user_canceled'}), nop: () => {},
        }),
        addrOmitted: value => value,
        chrome_storage_session: { get: async () => ({ 'ml-test': { authorization } }) },
        sdk_tex_build: async auth => ({ schema:'hacash.tex/bundle@1', authorization:auth, address:auth.address, repeatable:true, execution_guaranteed:false }),
        sdk_tex_inspect: async auth => ({ schema:'hacash.tex/inspection@1', authorization:auth, cells:[
            {index:0,cellid:25,cell:{cellid:25,chainid:0},category:'condition',description:'Require chain ID equal to 0'},
            {index:1,cellid:1,cell:{cellid:1,haczhu:'100000000'},category:'pay',description:'Pay 1 HAC into TEX escrow'},
        ], chain_id_condition:[{operator:'eq',value:'0'}], height_conditions:[], payments:[], receipts:[], unknown_conditions:[] }),
        mnx_chain_context: async () => ({ expected_chain_id:0, current_height:'100', has_height:true }),
        stoReadCurrentAccount: async () => address,
        wpcfm_open: async () => true,
        stoCurAccDoSign: async () => { calls.signed++; return {pubkey:'02aa', signature:'11'.repeat(64)} },
        sdk_tex_prepare_signature: async () => ({ schema:'hacash.sdk/signing-request@1', id:'r', purpose:'tex_authorization', signer_address:address, digest:'22'.repeat(32), body_hash:'33', review_binding:'44', request_binding:'55' }),
        sdk_tex_attach_signature: async (auth, request, proof) => { calls.attached++; assert.equal(proof.request_binding, '55'); return {schema:'hacash.tex/signed-bundle@1', authorization:auth, action:'0x' + 'aa'} },
        sdk_tex_verify: async action => ({ok:action === '0x' + 'aa'}),
        mnx_signing_proof: () => { throw new Error('must not request secret key') },
        mnx_err_message: e => String(e.message || e),
        setTimeout: () => 1, clearTimeout: () => {}, AbortController,
        fetch: async url => ({ok:true, json:async()=>url.endsWith('/status') ? {chain_id:0} : {height:'100'}}),
        ...overrides,
    }
    vm.createContext(base)
    vm.runInContext(source, base)
    base.routePageSignTex(address)
    return { app:model, ready: () => mounted(model), calls }
}

;(async () => {
    let h = harness()
    await h.ready()
    assert.equal(h.app.review.cells.length, 2)
    await h.app.sign()
    assert.equal(h.calls.signed, 1)
    assert.equal(h.calls.attached, 1)
    assert.equal(h.calls.answers[0].success, true)

    h = harness({ wpcfm_open: async () => false })
    await h.ready()
    await h.app.sign()
    assert.equal(h.calls.signed, 0)
    assert.equal(h.calls.answers.length, 1)
    assert.equal(h.calls.answers[0].code, 'user_canceled')

    h = harness({ stoReadCurrentAccount: async () => 'different-account' })
    await h.ready()
    await h.app.sign()
    assert.equal(h.calls.signed, 0)
    assert.match(h.calls.answers[0].err, /account changed/)

    h = harness({ mnx_chain_context: async () => ({ expected_chain_id:1, current_height:'100', has_height:true }) })
    await h.ready()
    assert.match(h.app.error, /mismatched network/)
    assert.equal(h.calls.answers.length, 1)
    assert.equal(h.calls.answers[0].code, 'sign_refused')

    h = harness({ sdk_tex_inspect: async auth => ({authorization:auth,cells:[{cellid:1,category:'pay'}],chain_id_condition:[],height_conditions:[],unknown_conditions:[]}) })
    await h.ready()
    assert.match(h.app.error, /chain guard/)

    h = harness({ sdk_tex_build: async () => ({ schema:'wrong' }) })
    await h.ready()
    assert.match(h.app.error, /did not return canonical authorization contents/)

    const futureInspect = auth => ({ schema:'hacash.tex/inspection@1', authorization:auth, cells:[
        {index:0,cellid:25,cell:{cellid:25,chainid:0},category:'condition',description:'Require chain ID equal to 0'},
        {index:1,cellid:24,cell:{cellid:24,height:'101'},category:'condition',description:'Require block height at least 101'},
    ], chain_id_condition:[{operator:'eq',value:'0'}], height_conditions:[{operator:'at_least',value:'101'}], payments:[], receipts:[], unknown_conditions:[] })
    h = harness({ sdk_tex_inspect: async auth => futureInspect(auth) })
    await h.ready()
    assert.match(h.app.windowState, /Scheduled/)
    await h.app.sign()
    assert.equal(h.calls.answers[0].success, true)

    const expiredInspect = auth => ({...futureInspect(auth), height_conditions:[{operator:'at_most',value:'99'}]})
    h = harness({ sdk_tex_inspect: async auth => expiredInspect(auth) })
    await h.ready()
    assert.match(h.app.error, /expired/)

    const contradictoryInspect = auth => ({...futureInspect(auth), height_conditions:[{operator:'at_least',value:'110'},{operator:'at_most',value:'105'}]})
    h = harness({ sdk_tex_inspect: async auth => contradictoryInspect(auth) })
    await h.ready()
    assert.match(h.app.error, /contradictory/)

    let chainReads = 0
    h = harness({ mnx_chain_context: async () => ({ expected_chain_id: chainReads++ ? 1 : 0, current_height:'100', has_height:true }) })
    await h.ready()
    await h.app.sign()
    assert.equal(h.calls.signed, 0)
    assert.match(h.calls.answers[0].err, /network changed/)

    let selectedReads = 0
    h = harness({ stoReadCurrentChain: async () => ({id: selectedReads++ < 2 ? 0 : 1, rpc:'https://node.test'}) })
    await h.ready()
    await h.app.sign()
    assert.equal(h.calls.signed, 0)
    assert.match(h.calls.answers[0].err, /network|chain ID/)

    h = harness({ sdk_tex_attach_signature: async () => ({schema:'hacash.tex/signed-bundle@1',authorization,action:'0x' + 'aa'}) })
    await h.ready()
    await h.app.sign()
    assert.equal(h.calls.answers[0].success, true)
    console.log('signtex approval audit passed: local review/sign, cancellation, account/network binding, malformed SDK output, chain guard, proof binding')
})().catch(e => { console.error(e); process.exitCode = 1 })
