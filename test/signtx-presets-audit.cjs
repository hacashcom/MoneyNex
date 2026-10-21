'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const repo = path.resolve(__dirname, '..')
const presets = require('./signtx-review-presets.json')
const main = '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9'
const sdkKinds = Object.keys(presets).filter(key => /^sdk-kind-\d+$/.test(key))
assert.equal(sdkKinds.length, 35, 'the review catalog must cover all 35 SDK action kinds')
for (const key of ['large-asset-supply', 'inscription-type-200', 'tex-all-cells', 'pointer-from-to', 'ast-if-depth']) {
    assert(presets[key], `missing required review preset: ${key}`)
}

globalThis.window = { atob: globalThis.atob }
require(path.join(repo, 'jslib/hacash_sdk.js'))

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const wallet = vm.createContext({
    JSON_parse: JSON.parse,
    setTimeout,
    TextDecoder,
    nil: null,
    explorer_url: 'https://explorer.hacash.org',
    mnx_esc_html: escapeHtml,
})
for (const file of ['moneynx_sdk_facade.js', 'assetamt.js', 'msglayout.js', 'actionfacts.js', 'actiondisplay.js', 'actionrender.js', 'moneynx_txview.js', '../popup/actionview/actionview/vue.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, 'jslib', file), 'utf8'), wallet, { filename: file })
}

const deepFreeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
    return value
}

;(async () => {
    const sdk = await globalThis.hacash_sdk()
    const invokeJson = (op, inputJson) => {
        const envelope = JSON.parse(sdk.sdk_invoke_json(op, new TextEncoder().encode(inputJson)))
        assert.equal(envelope.ok, 1, `SDK operation ${op}: ${JSON.stringify(envelope)}`)
        return envelope.body
    }
    const invoke = (op, input) => invokeJson(op, JSON.stringify(input))
    const reviews = new Map()
    for (const key of Object.keys(presets)) {
        const entry = presets[key]
        const body = typeof entry === 'string' ? entry : entry && entry.body
        if (typeof body !== 'string') continue
        const review = invoke(3, { body, signer_address: main })
        assert.equal(review.schema, 'hacash.sdk/review@7', `${key} review schema`)
        if (key.startsWith('sdk-kind-') || key === 'large-asset-supply' || key === 'inscription-type-200' || key === 'tex-all-cells' || key === 'pointer-from-to' || key === 'ast-if-depth' || key === 'signature-status-mixed') {
            assert.equal(review.protocol_valid, true, `${key} must be protocol-valid: ${JSON.stringify(review.topology_violations)}`)
        }
        assert(Array.isArray(review.actions) && review.actions.length > 0, `${key} must inspect at least one action`)
        const before = JSON.stringify(review)
        deepFreeze(review)
        const context = { review, asset_text: atoms => ({ text: String(atoms), unit: '', known: false }) }
        const models = wallet.mnx_review_presentations(review, context)
        assert.equal(models.length, review.actions.length, `${key} model count`)
        const sign = models.map((model, i) => wallet.mnx_action_line_html(model, i, { main, abbrev_main: true })).join('\n')
        const details = review.actions.map((action, i) => wallet.mnx_actv_render_action(action, 0, {}, { review, height_clock: null }, models[i]).join('')).join('\n')
        const plain = models.map(model => wallet.mnx_action_plain_text(model)).join('\n')
        assert(sign.length > 0 && details.length > 0 && plain.length > 0, `${key} must render in Sign, actual Details, and plainText`)
        for (const [i, action] of review.actions.entries()) {
            if (action.description) {
                const sdkText = wallet.mnx_esc_html(action.description)
                const detailLines = wallet.mnx_actv_render_action(action, 0, {}, { review, height_clock: null }, models[i])
                assert(detailLines.every(line => /^<div class="avact(?: |")/.test(line) && line.endsWith('</div>')), `${key} each v-html entry must contain one complete action node`)
                const nodeDetails = detailLines.join('')
                assert(nodeDetails.includes(`<summary>SDK description</summary><pre class="avpre">${sdkText}</pre>`), `${key} Details must keep the exact SDK description separately escaped`)
            }
        }
        assert.equal(JSON.stringify(review), before, `${key} rendering must not mutate/freeze the SDK review`)
        reviews.set(key, { body, review, models, sign, details, plain })
    }

    for (const key of sdkKinds) assert(reviews.has(key), `${key} was not inspected`)
    assert.match(reviews.get('large-asset-supply').plain, /9007199254740993/, 'large supply must retain exact u64 text')
    assert.match(reviews.get('large-asset-supply').review.actions[0].json, /"supply":9007199254740993/, 'SDK canonical JSON must preserve the exact u64 token')
    assert.match(reviews.get('inscription-type-200').plain, /type 200/i, 'inscription engraved_type must survive')
    assert.match(reviews.get('tex-all-cells').plain, /cell/i, 'TEX cell descriptions must be present')
    assert.equal(reviews.get('tex-all-cells').models[0].fields.length, 23, 'all defined TEX cells must be represented')
    const pointer = reviews.get('pointer-from-to')
    assert.match(pointer.plain, /address pointer \d+> = \S{25,}/, 'resolved pointer must retain identity and address')
    const unresolvedBuilt = invoke(2, { spec: {
        tx_type: 3, main, addrlist: [main], fee: '0.001', timestamp: 1700000000,
        actions: [{ kind: 'transfer_hac_to', to: 235, hacash: '1:248' }],
    } })
    const unresolvedReview = invoke(3, { body: unresolvedBuilt.body, signer_address: main })
    assert.equal(unresolvedReview.protocol_valid, true, 'offline protocol_valid does not validate runtime address-table dereferences')
    const unresolvedModels = wallet.mnx_review_presentations(unresolvedReview, { review: unresolvedReview })
    const unresolvedSign = wallet.mnx_action_line_html(unresolvedModels[0], 0, { main, abbrev_main: true })
    const unresolvedDetails = wallet.mnx_actv_render_action(unresolvedReview.actions[0], 0, {}, { review: unresolvedReview }, unresolvedModels[0]).join('')
    const unresolvedPlain = wallet.mnx_action_plain_text(unresolvedModels[0])
    assert.match(unresolvedSign, /address pointer 235: unresolved/i, 'Sign must not misrepresent out-of-table pointer as main')
    assert.match(unresolvedDetails, /address pointer 235: unresolved/i, 'Details must mark out-of-table pointer as unresolved')
    assert.match(unresolvedPlain, /<address pointer 235>/, 'plainText must retain the explicit protocol reference')
    assert.match(unresolvedPlain, /to <address pointer 235>$/, 'explicit to pointer must not silently become main in plainText')
    const ast = reviews.get('ast-if-depth')
    for (const marker of ['condition', 'if-branch', 'else-branch']) {
        assert(ast.sign.includes(marker), `Sign must label ${marker}`)
        assert(ast.details.includes(marker), `Details must retain single-node ${marker} branch labels`)
        assert(ast.plain.includes(marker), `plainText must label ${marker}`)
    }
    assert.match(ast.plain, /0\/\d+\/\d+/, 'nested AST output must keep original SDK paths')
    const signatureReview = reviews.get('signature-status-mixed').review
    const invalidSigner = signatureReview.invalid_signers[0]
    const missingSigner = signatureReview.missing_signers[0]
    assert.equal(wallet.mnx_tx_signer_status(signatureReview, main), 'valid')
    assert.equal(wallet.mnx_tx_signer_status(signatureReview, invalidSigner), 'invalid')
    assert.equal(wallet.mnx_tx_signer_status(signatureReview, missingSigner), 'missing')

    // Exercise the message/msgparse compatibility pipeline with a real SDK
    // action. The pretty parser is a presentation enrichment only: it cannot
    // change the inspected transaction or leak into the DApp callback text.
    const messageHex = '3c3ec3a93c696d673e'
    const messageBuilt = invoke(2, { spec: {
        tx_type: 3, main, addrlist: [main, '1Drrsep4vZVKhKWx2vVmiw8umYN3ETYraB'],
        fee: '0.001', gas_max: 10, timestamp: 1700000000,
        actions: [{ kind: 1025, data: '0x' + messageHex }, { kind: 1, to: 1, hacash: '1:248' }],
    } })
    const messageReview = invoke(3, { body: messageBuilt.body, signer_address: main })
    assert.equal(messageReview.protocol_valid, true, 'real message+transfer review topology')
    const messageBefore = JSON.stringify(messageReview)
    const messageHash = messageReview.tx_hash
    const msgState = wallet.mnx_msglayout_state
    const goodLayout = [['magic4', 'meta'], ['ascii', 'unsafe', 5]]
    msgState.tables = wallet.mnx_msglayout_normalize({ msgid: 0, msglayout: goodLayout })
    msgState.extra = { msgid: 0, msglayout: goodLayout }
    const goodBind = wallet.mnx_msglayout_bind(messageReview.actions, msgState.tables)
    assert.equal(goodBind.errors.length, 0, 'valid message layout binds without error')
    const messageSign = wallet.parseTxDesc(messageReview).join('\n')
    assert(messageSign.includes('&lt;img&gt;') && !messageSign.includes('<img>'), 'message layout user text is HTML escaped')
    assert(messageSign.includes('&lt;&gt;é'), `UTF-8 magic text is preserved and escaped: ${messageSign}`)
    assert(messageSign.includes('0x' + messageHex), 'original message payload remains visible in Sign')
    const messageDetails = wallet.mnx_actv_render_action(messageReview.actions[0], 0, {}, {
        review: messageReview, byArrayIndex: goodBind.byArrayIndex, arrayIndex: 0,
    }, wallet.mnx_review_presentations(messageReview, { review: messageReview })[0]).join('')
    assert(messageDetails.includes('&lt;img&gt;') && messageDetails.includes('0x' + messageHex), 'Details keeps parsed fields and original raw payload')
    const callbackText = wallet.mnx_txdesc_plain(messageReview).join('\n')
    assert(!callbackText.includes('img') && !callbackText.includes('unsafe') && !callbackText.includes('meta'), 'DApp plainText excludes msgparse presentation labels/content')
    assert.equal(messageReview.tx_hash, messageHash, 'layout rendering does not change the transaction hash')
    assert.equal(JSON.stringify(messageReview), messageBefore, 'message layout rendering does not mutate the SDK Review')

    const badLayout = [['hex4', 'short']]
    msgState.tables = wallet.mnx_msglayout_normalize({ msgid: 0, msglayout: badLayout })
    const badBind = wallet.mnx_msglayout_bind(messageReview.actions, msgState.tables)
    assert(badBind.errors.some(error => /covered 4 of 9 bytes/.test(error)), `length mismatch is reported: ${JSON.stringify(badBind.errors)}`)
    const fallbackMessage = wallet.parseTxDesc(messageReview).join('\n')
    assert(msgState.display_err.includes('covered 4 of 9 bytes'), 'Sign-facing layout error is retained')
    assert(!fallbackMessage.includes('class="mf"') && fallbackMessage.includes('0x' + messageHex), 'malformed layout fails closed to the full original HEX')
    assert.equal(messageReview.tx_hash, messageHash)
    assert.equal(JSON.stringify(messageReview), messageBefore)

    // The tx JSON codec must preserve both wire AddrOrList variants, including
    // List([primary]) whose body hash differs from Single(primary).
    const pointerBody = reviews.get('pointer-from-to').body
    const decoded = invoke(10, { body: pointerBody })
    assert.equal(decoded.schema, 'hacash.sdk/transaction-json@2')
    assert(Array.isArray(decoded.addrlist), 'the pointer preset should preserve its address list')
    const encoded = invoke(11, { transaction: decoded })
    assert.equal(encoded.body, pointerBody, 'decode/encode must preserve the exact unsigned body')
    const listOne = invoke(2, { spec: { tx_type: 3, main, addrlist: [main], fee: '0.001', timestamp: 1700000000, actions: [{ kind: 1, to: main, hacash: '0.01' }] } })
    const single = invoke(2, { spec: { tx_type: 3, main, fee: '0.001', timestamp: 1700000000, actions: [{ kind: 1, to: main, hacash: '0.01' }] } })
    const listDecoded = invoke(10, { body: listOne.body })
    const singleDecoded = invoke(10, { body: single.body })
    assert(Array.isArray(listDecoded.addrlist), 'List([primary]) must decode as a list')
    assert.equal(singleDecoded.addrlist, main, 'Single(primary) must decode as a string')
    assert.notEqual(listOne.unsigned_body_hash, single.unsigned_body_hash, 'Single and List-one wire forms must remain distinct')
    assert.equal(invoke(11, { transaction: listDecoded }).body, listOne.body)
    assert.equal(invoke(11, { transaction: singleDecoded }).body, single.body)

    // raisefee rebuild must preserve SAT u64 atoms through SDK decode, the
    // wallet's lossless ActionSpec adapter, and SDK build (no Number roundtrip).
    const largeSatBuild = invoke(2, { spec: {
        tx_type: 3, main, fee: '0.001', timestamp: 1700000000,
        actions: [{ kind: 'transfer_sat_to', to: main, satoshi: '9007199254740993' }],
    } })
    const largeSatDecoded = invoke(10, { body: largeSatBuild.body })
    assert.match(largeSatDecoded.actions[0].json, /"satoshi":9007199254740993/)
    const largeSatSpecs = wallet.mnx_txjson_to_spec(largeSatDecoded)
    assert.equal(largeSatSpecs[0].satoshi, '9007199254740993', 'wallet raise-fee ActionSpec must preserve SAT u64 atoms as decimal text')
    const largeSatRebuilt = invoke(2, { spec: {
        tx_type: largeSatDecoded.tx_type, main: largeSatDecoded.main, fee: '0.002',
        timestamp: largeSatDecoded.timestamp, gas_max: largeSatDecoded.gas_max,
        addrlist: largeSatDecoded.addrlist, actions: largeSatSpecs,
    } })
    const largeSatReDecoded = invoke(10, { body: largeSatRebuilt.body })
    assert.match(largeSatReDecoded.actions[0].json, /"satoshi":9007199254740993/, 'rebuilt raise-fee request must keep the exact SAT amount')

    console.log(`Real wasm preset audit passed: ${sdkKinds.length} SDK kinds, ${reviews.size} inspect/render cases, deep AST/TEX/large-u64/pointer variants, frozen Review, and Single/List addrlist roundtrips.`)
})().catch(error => {
    console.error(error)
    process.exitCode = 1
})
