const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NOW = 1_000_000, MAX_AGE = 36 * 60 * 60;
const PUBLIC_TEST_DIGEST = 'a'.repeat(32);
function load(record) {
    const state = { password: record, removed: 0, decrypts: 0, encrypts: 0, writes: 0 };
    const context = vm.createContext({
        yes: true, no: false, nil: null, ctime: () => NOW,
        $id: () => ({ classList: { add() {} } }), _setTimeout() {},
        chrome_storage_local: {},
        chrome_storage_session: {
            async get() { return { password: structuredClone(state.password) }; },
            async remove(key) { assert.equal(key, 'password'); state.password = undefined; state.removed++; },
        },
        chrome_storage_sync: { async get() { return { accounts: {} }; }, async set() { state.writes++; } },
        AES_decrypt() { state.decrypts++; return 'public-test-placeholder'; },
        AES_encrypt() { state.encrypts++; return 'public-test-ciphertext'; },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup/login/login.js'), 'utf8'), context);
    return { context, state };
}

test('valid sessions retain both password-read return shapes', async () => {
    const { context } = load({ md5: PUBLIC_TEST_DIGEST, time: NOW - MAX_AGE + 1 });
    assert.equal(await context.stoReadPassword(), PUBLIC_TEST_DIGEST);
    assert.equal((await context.stoReadPassword(true)).time, NOW - MAX_AGE + 1);
});

test('expiry is enforced at the boundary without initializing a page', async () => {
    for (const age of [MAX_AGE, MAX_AGE + 1]) {
        const { context, state } = load({ md5: PUBLIC_TEST_DIGEST, time: NOW - age });
        assert.equal(await context.stoReadPassword(), null);
        assert.equal(state.removed, 1);
        assert.equal(Object.keys(await context.stoReadPassword(true)).length, 0);
    }
});

test('malformed timestamps, future timestamps and invalid digests fail closed', async () => {
    for (const record of [
        { md5: PUBLIC_TEST_DIGEST }, { md5: PUBLIC_TEST_DIGEST, time: '1000000' },
        { md5: PUBLIC_TEST_DIGEST, time: NOW + 1 }, { md5: PUBLIC_TEST_DIGEST, time: NaN },
        { md5: PUBLIC_TEST_DIGEST, time: -1 }, { md5: PUBLIC_TEST_DIGEST, time: NOW - 0.5 },
        { md5: 'invalid', time: NOW }, 'not-a-record',
    ]) {
        const { context, state } = load(record);
        assert.equal(await context.stoReadPassword(), null);
        assert.equal(state.removed, 1);
    }
});

test('expired session cannot reach account decryption', async () => {
    const { context, state } = load({ md5: PUBLIC_TEST_DIGEST, time: NOW - MAX_AGE });
    assert.equal(await context.stoUnlockAccount({ cryptkey: 'public-test-ciphertext' }), null);
    assert.equal(state.decrypts, 0);
});

test('expired session cannot encrypt or save an imported account without a password', async () => {
    const { context, state } = load({ md5: PUBLIC_TEST_DIGEST, time: NOW - MAX_AGE });
    assert.equal(await context.stoSaveAccount({ address: 'public-test-address', private_key: 'public-test-placeholder' }), null);
    assert.equal(state.encrypts, 0); assert.equal(state.writes, 0);
});

test('missing session remains locked and a valid session still decrypts', async () => {
    const missing = load(undefined);
    assert.equal(await missing.context.stoReadPassword(), null);
    const valid = load({ md5: PUBLIC_TEST_DIGEST, time: NOW });
    assert.equal(await valid.context.stoUnlockAccount({ cryptkey: 'public-test-ciphertext' }), 'public-test-placeholder');
    assert.equal(valid.state.decrypts, 1);
});
