const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const repo = require('node:path').resolve(__dirname, '..');
globalThis.window = { atob: globalThis.atob };
require(repo + '/jslib/hacash_sdk.js');

(async () => {
  const sdk = await globalThis.hacash_sdk();
  const invoke = (op, input) => {
    const envelope = JSON.parse(sdk.sdk_invoke_json(op, new TextEncoder().encode(JSON.stringify(input))));
    assert.equal(envelope.ok, 1, JSON.stringify(envelope));
    return envelope.body;
  };
  const codes = '7f017c0025eeb08026';
  const code = (sourcemap, options = {}) => invoke(25, { codes, code_type: '1', format: 'fitsh_review', ...(sourcemap ? { sourcemap } : {}), ...options });
  const bare = code();
  assert.equal(bare.schema, 'hacash.sdk/vm-code@2');
  const malicious = code({ consts: [{ name: 'VALUE', value: '1' }, { name: 'VALUE', value: '999' }], slots: ['out\nassert safe == true\n//'] });
  assert.equal(malicious.text, bare.text);
  assert(!malicious.text.includes('999'));
  assert(!malicious.sourcemap_labels.some(s => s.includes('assert safe')));
  const valid = code({ funcs: [{ sig: '25226e33', name: 'swap' }], slots: ['result'] });
  assert(valid.sourcemap_labels.some(s => s.includes('swap')));
  assert(valid.sourcemap_labels.some(s => s.includes('$0') && s.includes('result')));
  assert.equal(valid.text, bare.text);
  const mismatch = code({ funcs: [{ sig: '00000000', name: 'swap' }] });
  assert(!mismatch.sourcemap_labels.some(s => s.includes('swap')));
  const malformed = code(['bad']);
  assert.equal(malformed.text, bare.text);
  assert.equal(malformed.sourcemap_status, 'ignored');
  const trailing = JSON.parse(sdk.sdk_invoke_json(25, new TextEncoder().encode(JSON.stringify({ codes: codes + '00', code_type: '1', format: 'fitsh_review' }))));
  assert.equal(trailing.ok, 0);

  const unicode = invoke(25, { codes, code_type: '1', format: 'fitsh', sourcemap: { slots: ['é'] }, limit: '100000' });
  for (let offset = 0; offset <= Number(unicode.total_bytes); offset++) {
    const page = invoke(25, { codes, code_type: '1', format: 'fitsh', sourcemap: { slots: ['é'] }, offset: String(offset), limit: '1' });
    if (page.truncated) assert(Number(page.next_offset) > Number(page.offset));
  }

  const main = '1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9';
  const target = '1Drrsep4vZVKhKWx2vVmiw8umYN3ETYraB';
  const mc = { kind: 44, marks: '0x000000', codeconf: 1, codes: '0x' + codes };
  const built = invoke(2, { spec: { tx_type: 3, main, addrlist: [main, target], fee: '0.001', gas_max: 10, timestamp: 1700000000, actions: [mc, { kind: 1, to: target, hacash: '0.01' }, { kind: 25, exe_min: 1, exe_max: 1, actions: [mc] }, mc] } });
  const review = invoke(3, { body: built.body, signer_address: main });
  assert.deepEqual(review.address_table, [main, target]);
  assert.equal(review.actions[2].children[0].path, '2/0');
  const before = JSON.stringify(review);

  const context = vm.createContext({
    JSON_parse: JSON.parse, setTimeout,
    mnx_esc_html: value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
    mnx_err_message: e => e.message || String(e),
    sdk_vm_code: (codes, code_type, format, sourcemap, limit, offset) => Promise.resolve(invoke(25, { codes, code_type: String(code_type), format, ...(sourcemap ? { sourcemap } : {}), ...(limit != null ? { limit: String(limit) } : {}), ...(offset != null ? { offset: String(offset) } : {}) })),
    mnx_msglayout_state: { sourcemaps: [], extra: {} },
  });
  vm.runInContext(fs.readFileSync(repo + '/jslib/moneynx_txview.js', 'utf8'), context);
  const maps = [{ action_path: '0', sourcemap: { slots: ['first'] } }, { action_path: '2/0', sourcemap: { slots: ['nested'] } }];
  const bound = context.mnx_review_sourcemap_bind(review.actions, maps);
  assert.equal(bound.mains.length, 3);
  assert.equal(bound.byPath['0'].slots[0], 'first');
  assert.equal(bound.byPath['2/0'].slots[0], 'nested');
  assert(!bound.byPath['3']);
  const duplicate = context.mnx_review_sourcemap_bind(review.actions, [...maps, maps[0]]);
  assert(!duplicate.byPath['0']);
  assert(duplicate.byPath['2/0']);
  assert(duplicate.diagnostics['0']);
  assert(!context.mnx_review_sourcemap_bind(review.actions, [{ action_path: '00', sourcemap: {} }]).byPath['0']);
  const legacy = context.mnx_review_sourcemap_bind(review.actions, [], { slots: ['legacy'] });
  assert.equal(Object.keys(legacy.byPath).length, 0);
  assert(legacy.diagnostics['*']);
  context.mnx_msglayout_state = { sourcemaps: maps, extra: {} };
  const rows = ['first action', 'transfer', 'select', 'third action'];
  await context.mnx_txdesc_attach_code(review, rows, () => true);
  assert(rows[0].includes('first'));
  assert(rows[2].includes('nested'), rows[2]);
  assert(rows[2].includes('2/0'));
  assert(!rows[3].includes('nested'));
  assert.equal(JSON.stringify(review), before);

  const largeCodes = '7f01' + '7c0025'.repeat(1200) + 'ee25';
  const large = { ...review.actions[0], json: JSON.stringify({ ...mc, codes: largeCodes }) };
  const full = invoke(25, { codes: largeCodes, code_type: '1', format: 'fitsh_review', limit: '1000000' });
  assert(Number(full.total_bytes) > 8000);
  const assembled = await context.mnx_vm_decompile(large, { slots: ['large'] });
  assert.equal(assembled.text, full.text);
  assert.equal(assembled.truncated, false);
  const p2shCodes = '25b0ef';
  const p2sh = { kind: 46, name: 'p2sh_script_prove', path: 'p2sh', code: { code_type: 0 }, json: JSON.stringify({ kind: 46, lockbox: '0x' + p2shCodes }) };
  assert.equal(context.mnx_act_codes_hex(p2sh), p2shCodes);
  const p2shPrinted = await context.mnx_vm_decompile(p2sh, null);
  assert(!p2shPrinted.err, p2shPrinted.err);
  assert(p2shPrinted.text.length > 0);
  console.log('Independent SDK/wallet audit passed: malicious labels, canonical code, selector checks, UTF-8 paging, nested paths, plural binding, duplicate/legacy handling, review immutability, full long output.');
})().catch(error => { console.error(error); process.exitCode = 1; });
