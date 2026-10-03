const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../popup/login/login.js'), 'utf8');
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function fixture() {
    const entered = deferred(), release = deferred();
    const state = { accounts: { Original: { cryptkey: 'original' } }, current_account: 'Original' };
    let reads = 0, writes = 0, queue = Promise.resolve();
    const locks = { request(name, callback) {
        assert.equal(name, 'moneynex-account-storage');
        const run = queue.then(callback);
        queue = run.catch(() => {});
        return run;
    } };
    const storage = {
        async get(key) {
            const snapshot = structuredClone({ [key]: state[key] });
            if(key === 'accounts' && ++reads === 1) {
                entered.resolve();
                await release.promise;
            }
            return snapshot;
        },
        async set(value) { writes++; Object.assign(state, structuredClone(value)); },
    };
    function page(lockManager = locks) {
        const context = vm.createContext({
            yes: true, no: false, nil: null, ctime: () => 1000000,
            $id: () => ({ classList: { add() {} } }), _setTimeout() {},
            navigator: { locks: lockManager },
            chrome_storage_local: {}, chrome_storage_session: {}, chrome_storage_sync: storage,
            AES_encrypt: key => 'cipher-' + key,
        });
        vm.runInContext(source, context);
        context.stoReadPassword = async () => 'public-test-digest';
        return context;
    }
    return { page, state, entered, release, reads: () => reads, writes: () => writes };
}
test('two page contexts preserve both concurrently imported accounts', async () => {
    const f = fixture(), a = f.page(), b = f.page();
    const first = a.stoSaveAccount({ address: 'A', private_key: 'fixture-A' });
    await f.entered.promise;
    const second = b.stoSaveAccount({ address: 'B', private_key: 'fixture-B' });
    await new Promise(setImmediate);
    f.release.resolve();
    assert.deepEqual(await Promise.all([first, second]), ['public-test-digest', 'public-test-digest']);
    assert.deepEqual(Object.keys(f.state.accounts).sort(), ['A', 'B', 'Original']);
});
test('another context cannot read the account table while a mutation holds the lock', async () => {
    const f = fixture(), a = f.page(), b = f.page();
    const first = a.stoSaveAccount({ address: 'A', private_key: 'fixture-A' });
    await f.entered.promise;
    const second = b.stoSaveAccount({ address: 'B', private_key: 'fixture-B' });
    await new Promise(setImmediate);
    const during = f.reads();
    f.release.resolve();
    await Promise.all([first, second]);
    assert.equal(during, 1);
});
test('unavailable Web Locks refuses mutations instead of using a page-only fallback', async () => {
    const f = fixture();
    f.release.resolve();
    const result = await f.page(null).stoSaveAccount({ address: 'A', private_key: 'fixture-A' });
    assert.equal(result, null);
    assert.equal(f.writes(), 0);
});
test('a failed mutation does not poison the next queued mutation', async () => {
    const f = fixture(), a = f.page();
    await assert.rejects(a.accMutate(async () => { throw Error('fixture failure'); }), /fixture failure/);
    assert.equal(await a.accMutate(async () => 'next'), 'next');
});
test('changing the current account rejects a missing target', async () => {
    const f = fixture();
    f.release.resolve();
    assert.equal(await f.page().stoSaveCurrentAccount('missing'), null);
    assert.equal(f.state.current_account, 'Original');
    assert.equal(f.writes(), 0);
});
test('changing the current account and deleting it share one lock', async () => {
    const f = fixture(), a = f.page(), b = f.page();
    f.state.accounts.A = { cryptkey: 'cipher-A' };
    const removing = a.stoRemoveAccount('A');
    await f.entered.promise;
    const selecting = b.stoSaveCurrentAccount('A');
    await new Promise(setImmediate);
    f.release.resolve();
    await Promise.all([removing, selecting]);
    assert.equal(f.state.accounts.A, undefined);
    assert.equal(f.state.current_account, 'Original');
});
