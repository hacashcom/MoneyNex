const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(current = 'B') {
    const state = { current, decrypts: [], methods: null };
    const context = vm.createContext({
        yes: true, no: false, nil: null, ctime: () => 1000000,
        $id: () => ({ classList: { add() {} } }), _setTimeout() {},
        chrome_storage_local: {}, chrome_storage_session: {},
        chrome_storage_sync: { async get(key) {
            return { [key]: key === 'accounts' ? { B: { cryptkey: 'fixture-B' } } : state.current };
        } },
        AES_decrypt(cipher) { state.decrypts.push(cipher); return 'key-for-' + cipher; },
        wpass_open: async () => true, icfpath: '', vue_tpl_acinf: '',
        VueCreateApp(name, template, data, methods) { state.methods = methods; return { app: {} }; },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup/login/login.js'), 'utf8'), context);
    context.stoReadPassword = async () => 'public-test-password-digest';
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup/index/acinf/vue.js'), 'utf8'), context);
    context.acinfLoadLib = true;
    return { state, context };
}

test('missing explicit account never falls back to the current account', async () => {
    for (const missing of [undefined, null, false, '']) {
        const f = fixture();
        assert.equal(await f.context.stoUnlockAccount(missing), null);
        assert.equal(f.state.decrypts.length, 0);
    }
});
test('a stale account details page does not display another account key', async () => {
    const f = fixture();
    f.context.routePageAcinf('A');
    const page = { myadr: 'A', privkey: null };
    await f.state.methods.sprivk.call(page);
    assert.equal(page.privkey, null);
    assert.equal(f.state.decrypts.length, 0);
});
test('no-argument calls still unlock the current account', async () => {
    const f = fixture();
    assert.equal(await f.context.stoUnlockAccount(), 'key-for-fixture-B');
    assert.deepEqual(f.state.decrypts, ['fixture-B']);
});
test('an explicit account stays selected when the current account differs', async () => {
    const f = fixture();
    assert.equal(await f.context.stoUnlockAccount({ cryptkey: 'fixture-A' }), 'key-for-fixture-A');
    assert.deepEqual(f.state.decrypts, ['fixture-A']);
});
test('a missing current account pointer fails without decrypting the account map', async () => {
    for (const pointer of [null, '', false, 0]) {
        const f = fixture(pointer);
        assert.equal(await f.context.stoUnlockAccount(), null);
        assert.equal(f.state.decrypts.length, 0);
    }
});
test('a dangling current account pointer stays rejected', async () => {
    const f = fixture('missing');
    assert.equal(await f.context.stoUnlockAccount(), null);
    assert.equal(f.state.decrypts.length, 0);
});
