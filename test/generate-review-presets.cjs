'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const elliptic = require('../jslib/elliptic.min.js')

globalThis.window = { atob: globalThis.atob }
require(path.join(__dirname, '../jslib/hacash_sdk.js'))

;(async () => {
  const sdk = await globalThis.hacash_sdk()
  const invoke = (op, input) => {
    const result = JSON.parse(sdk.sdk_invoke_json(op, new TextEncoder().encode(input)))
    if (result.ok !== 1) throw new Error(JSON.stringify(result))
    return result.body
  }
  const fixtures = require('../../../../hacash/rust/fullnode/sdk/tests/fixtures/action-descriptions.json')
  const presets = JSON.parse(fs.readFileSync(path.join(__dirname, 'signtx-review-presets.json'), 'utf8'))
  const main = '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9'
  const addressTable = [main, '1Drrsep4vZVKhKWx2vVmiw8umYN3ETYraB', 'bJASBXHo5SbNWJWbfACqZVNmi2j2hhCpe']
  const selected = new Map()
  for (const fixture of fixtures.cases) {
    if (fixture.sdk_profile && !selected.has(fixture.kind) && fixture.json) selected.set(fixture.kind, fixture)
  }
  if (selected.size !== fixtures.sdk_profile_total) throw new Error(`expected ${fixtures.sdk_profile_total} SDK kinds, found ${selected.size}`)
  for (const [kind, fixture] of selected) {
    const action = JSON.parse(fixture.json)
    if (kind === 1044) action.signers = [addressTable[1]]
    if (kind === 1041) action.chains = [0, 1]
    if (kind === 1042) { action.start = 0; action.end = 0 }
    const actions = [action]
    if ([1025, 1026, 1041, 1042, 1043, 1044].includes(kind)) {
      actions.push({ kind: 1, to: 1, hacash: '1:248' })
    }
    const spec = `{"tx_type":3,"main":${JSON.stringify(main)},"addrlist":${JSON.stringify(addressTable)},"fee":"0.001","gas_max":10,"timestamp":1700000000,"actions":${JSON.stringify(actions)}}`
    const built = invoke(2, `{"spec":${spec}}`)
    const review = invoke(3, JSON.stringify({ body: built.body, signer_address: main }))
    if (review.main !== main || Number(review.actions[0].kind) !== kind || review.protocol_valid !== true) {
      throw new Error(`SDK kind ${kind} did not inspect as a protocol-valid request: ${JSON.stringify(review.topology_violations)}`)
    }
    presets[`sdk-kind-${kind}`] = { label: `${fixture.name} · kind ${kind}`, body: built.body }
  }
  const buildPreset = (key, label, actionJson) => {
    const kind = Number(JSON.parse(actionJson).kind)
    const extraAction = [22, 32].includes(kind) ? `,${JSON.stringify({ kind: 1, to: 1, hacash: '1:248' })}` : ''
    // Keep fixture JSON as source text: parsing an embedded u64 through JS
    // Number would round 9007199254740993 before the SDK ever sees it.
    const spec = `{"tx_type":3,"main":${JSON.stringify(main)},"addrlist":${JSON.stringify(addressTable)},"fee":"0.001","gas_max":10,"timestamp":1700000000,"actions":[${actionJson}${extraAction}]}`
    const built = invoke(2, `{"spec":${spec}}`)
    const review = invoke(3, JSON.stringify({ body: built.body, signer_address: main }))
    if (Number(review.actions[0].kind) !== kind || review.protocol_valid !== true) throw new Error(`${key} failed protocol-valid inspect: ${JSON.stringify(review.topology_violations)}`)
    presets[key] = { label, body: built.body }
  }
  const buildPresetBody = actionJson => {
    const spec = `{"tx_type":3,"main":${JSON.stringify(main)},"addrlist":${JSON.stringify(addressTable)},"fee":"0.001","gas_max":10,"timestamp":1700000000,"actions":[${actionJson},${JSON.stringify({ kind: 1, to: 1, hacash: '1:248' })}]}`
    const built = invoke(2, `{"spec":${spec}}`)
    const review = invoke(3, JSON.stringify({ body: built.body, signer_address: main }))
    if (Number(review.actions[0].kind) !== 1025 || review.protocol_valid !== true) throw new Error('message layout fixture failed protocol-valid inspect')
    return built.body
  }
  const special = new Map(fixtures.cases.map((fixture) => [fixture.fixture_id, fixture]))
  buildPreset('large-asset-supply', 'Asset · exact u64 supply', special.get('asset_create.large_supply').json)
  buildPreset('inscription-type-200', 'Inscription · engraved type 200', special.get('hacd_insc_push.type_200').json)
  buildPreset('tex-all-cells', 'TEX · all defined cell variants', special.get('tex_cell_execute.standard').json)
  buildPreset('pointer-from-to', 'Transfer · address pointer from/to', special.get('transfer_hac_from_to.pointers_zero').json)
  buildPreset('ast-if-depth', 'AST · nested condition / if / else', '{"kind":26,"cond":{"kind":25,"exe_min":1,"exe_max":1,"actions":[{"kind":25,"exe_min":1,"exe_max":1,"actions":[{"kind":1,"to":1,"hacash":"1:248"}]}]},"br_if":{"kind":25,"exe_min":1,"exe_max":1,"actions":[{"kind":1,"to":2,"hacash":"2:248"}]},"br_else":{"kind":25,"exe_min":0,"exe_max":1,"actions":[{"kind":1,"to":1,"hacash":"3:248"}]}}')

  // Public fixture keys only: one valid local signature, one invalid signature
  // from a required signer, and one required signer with no signature.
  const secret = label => createHash('sha256').update(label).digest('hex')
  const ec = new elliptic.ec('secp256k1')
  const mainSecret = secret('123456')
  const invalidSecret = secret('mnx-review-invalid-signature')
  const absentSecret = secret('mnx-review-absent-signature')
  const pub = value => ec.keyFromPrivate(value, 'hex').getPublic(true, 'hex')
  const address = public_key => invoke(13, `{"public_key":${JSON.stringify(public_key)}}`).address
  const actualMain = address(pub(mainSecret))
  if (actualMain !== main) throw new Error('public local fixture key no longer derives the test genesis address')
  const invalidAddress = address(pub(invalidSecret))
  const absentAddress = address(pub(absentSecret))
  const mixedBuilt = invoke(2, JSON.stringify({ spec: {
    tx_type: 3, main, addrlist: addressTable, fee: '0.001', gas_max: 10, timestamp: 1700000000,
    actions: [{ kind: 1, to: main, hacash: '1:248' }, { kind: 1044, signers: [invalidAddress, absentAddress] }],
  } }))
  const request = invoke(5, JSON.stringify({ body: mixedBuilt.body, signer_address: main }))
  const signature = ec.sign(Buffer.from(request.digest, 'hex'), mainSecret, { canonical: true })
  const proof = {
    public_key: pub(mainSecret),
    signature: signature.r.toArrayLike(Buffer, 'be', 32).toString('hex') + signature.s.toArrayLike(Buffer, 'be', 32).toString('hex'),
  }
  const transaction = invoke(10, JSON.stringify({ body: mixedBuilt.body }))
  transaction.signatures = [
    { public_key: proof.public_key, signature: proof.signature },
    { public_key: pub(invalidSecret), signature: '00'.repeat(64) },
  ]
  const mixedEncoded = invoke(11, JSON.stringify({ transaction }))
  const mixedReview = invoke(3, JSON.stringify({ body: mixedEncoded.body, signer_address: main }))
  if (mixedReview.protocol_valid !== true || !mixedReview.valid_signers.includes(main) ||
      !mixedReview.invalid_signers.includes(invalidAddress) || !mixedReview.missing_signers.includes(absentAddress)) {
    throw new Error(`mixed signature fixture mismatch: ${JSON.stringify({ valid: mixedReview.valid_signers, invalid: mixedReview.invalid_signers, missing: mixedReview.missing_signers })}`)
  }
  presets['signature-status-mixed'] = { label: 'Signature status · valid, invalid, missing', body: mixedEncoded.body }

  const messageAction = special.get('message.standard')
  if (!messageAction) throw new Error('message.standard fixture missing')
  const messageBody = buildPresetBody(messageAction.json)
  presets['message-layout-review'] = {
    label: 'Message · parsed layout (review only)',
    body: messageBody,
    msgid: 0,
    msglayout: [['magic4', 'header'], ['ascii', 'memo', 1]],
  }

  fs.writeFileSync(path.join(__dirname, 'signtx-review-presets.json'), JSON.stringify(presets, null, 2) + '\n')
  console.log(`wrote ${selected.size} SDK kind presets and ${Object.keys(presets).length - selected.size} existing/special presets`)
})().catch(error => { console.error(error); process.exitCode = 1 })
