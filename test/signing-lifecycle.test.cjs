const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function fixture() {
    const prepared = deferred(), entered = deferred();
    const state = { unlocked: true, reads: 0, proofs: 0, attaches: 0 };
    const context = vm.createContext({
        nil: null,
        stoUnlockAccount: async () => { state.reads++; return state.unlocked ? 'public-key-placeholder' : null; },
        sdk_tx_prepare_signature: async () => { entered.resolve(); return prepared.promise; },
        mnx_signing_proof: () => { state.proofs++; return { publicFixture: true }; },
        sdk_tx_attach_signature: async () => { state.attaches++; return { publicFixture: true }; },
        mnx_err: error => ({ err: error.message }),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../jslib/moneynx_txview.js'), 'utf8'), context);
    return { state, context, prepared, entered };
}
test('does not decrypt an account while SDK preparation is pending', async () => {
    const f = fixture();
    const pending = f.context.stoCurAccLocalSignTx('fixture', 'signer', {}, 'origin');
    await f.entered.promise;
    const readsWhilePending = f.state.reads;
    f.prepared.resolve({ id: 'public-request' });
    await pending;
    assert.equal(readsWhilePending, 0);
});
test('locking during preparation prevents proof creation and attachment', async () => {
    const f = fixture();
    const pending = f.context.stoCurAccLocalSignTx('fixture', 'signer', {}, 'origin');
    await f.entered.promise;
    f.state.unlocked = false;
    f.prepared.resolve({ id: 'public-request' });
    const result = await pending;
    assert.equal(result.err, 'Account unlocking failed');
    assert.equal(f.state.proofs, 0);
    assert.equal(f.state.attaches, 0);
});
test('SDK preparation failure never requests a decrypted key', async () => {
    const f = fixture();
    const pending = f.context.stoCurAccLocalSignTx('fixture', 'signer', {}, 'origin');
    await f.entered.promise;
    f.prepared.reject(Error('Preparation rejected'));
    const result = await pending;
    assert.equal(result.err, 'Preparation rejected');
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.proofs, 0);
});
test('an unlocked successful request still signs and attaches once', async () => {
    const f = fixture();
    const request = { id: 'public-request' };
    f.prepared.resolve(request);
    const result = await f.context.stoCurAccLocalSignTx('fixture', 'signer', {}, 'origin');
    assert.equal(result.request, request);
    assert.equal(result.result.publicFixture, true);
    assert.equal(f.state.reads, 1);
    assert.equal(f.state.proofs, 1);
    assert.equal(f.state.attaches, 1);
});
