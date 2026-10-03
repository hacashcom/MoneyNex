const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(process.env.MNX_TEST_SOURCE_ROOT || path.join(__dirname, '..'), 'popup/login/login.js'), 'utf8');
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function fixture() {
    const entered = deferred(), release = deferred();
    const state = { accounts: { Original: { cryptkey: 'original' } }, current_account: 'Original' };
    let reads = 0, writes = 0, queue = Promise.resolve();
    const locks = { request(name, options, callback) {
        assert.equal(name, 'moneynex-account-storage');
        if(typeof options === 'function') { callback = options; options = {}; }
        const signal = options.signal;
        let rejectAbort;
        const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
        const abort = () => rejectAbort(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        if(signal?.aborted) abort();
        const run = queue.then(() => {
            signal?.removeEventListener('abort', abort);
            if(signal?.aborted) throw signal.reason;
            return callback();
        });
        queue = run.catch(() => {});
        return Promise.race([run, aborted]);
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
    function page(lockManager = locks, overrides = {}) {
        const context = vm.createContext({
            AbortController, setTimeout, clearTimeout,
            yes: true, no: false, nil: null, ctime: () => 1000000,
            $id: () => ({ classList: { add() {} } }), _setTimeout() {},
            navigator: { locks: lockManager },
            chrome_storage_local: {}, chrome_storage_session: {}, chrome_storage_sync: storage,
            AES_encrypt: key => 'cipher-' + key,
            ...overrides,
        });
        vm.runInContext(source, context);
        context.stoReadPassword = async () => 'public-test-digest';
        return context;
    }
    return { page, locks, state, entered, release, reads: () => reads, writes: () => writes };
}

function passwordFixture() {
    const f = fixture(), entered = deferred(), release = deferred();
    const sync = {}, session = {}, writes = [];
    let verifierReads = 0;
    const md5 = value => require('node:crypto').createHash('md5').update(value).digest('hex');
    function area(data, name) {
        return {
            async get(key) {
                const snapshot = structuredClone({ [key]: data[key] });
                if(key === 'crptpskey' && ++verifierReads === 1) {
                    entered.resolve(); await release.promise;
                }
                return snapshot;
            },
            async set(value) { writes.push(name); Object.assign(data, structuredClone(value)); },
        };
    }
    function page(overrides = {}) {
        const ctx = f.page(f.locks, {
            MD5: md5,
            AES_encrypt: (key, digest) => JSON.stringify({ key, digest }),
            chrome_storage_sync: area(sync, 'sync'), chrome_storage_session: area(session, 'session'),
            ...overrides,
        });
        // Reload to restore the actual password reader overridden by the account fixture.
        vm.runInContext(source, ctx);
        return ctx;
    }
    return { page, sync, session, writes, entered, release, md5 };
}

for(const pair of ['account/account', 'password/password', 'account/password']) {
    test(`concurrent initial ${pair} writes accept only one distinct password`, async () => {
        const f = passwordFixture(), a = f.page(), b = f.page();
        function start(page, kind, label) {
            return kind === 'account' ? page.stoSaveAccount({ address: label, private_key: 'public-' + label }, 'public-password-' + label)
                : page.stoSavePassword('public-password-' + label);
        }
        const kinds = pair.split('/');
        const first = start(a, kinds[0], 'A');
        await f.entered.promise;
        const second = start(b, kinds[1], 'B');
        await new Promise(setImmediate);
        f.release.resolve();
        const results = await Promise.all([first, second]);
        assert.equal(results.filter(Boolean).length, 1);
        assert.equal(f.sync.crptpskey, f.md5('public-password-Asalthcxwlt'));
        assert.equal(f.session.password.md5, f.md5('public-password-A'));
        for(const account of Object.values(f.sync.accounts || {})) {
            assert.equal(JSON.parse(account.cryptkey).digest, f.session.password.md5);
        }
        assert.equal(f.sync.accounts?.B, undefined);
    });
}

for(const kind of ['account', 'password']) {
    test(`expired ${kind} acquisition does not write a verifier or session before the lock`, async () => {
        const f = passwordFixture(), time = clock(), a = f.page(time), b = f.page(time);
        f.release.resolve();
        const entered = deferred(), release = deferred();
        const held = a.accMutate(async () => { entered.resolve(); await release.promise; });
        await entered.promise;
        const waiting = kind === 'account' ? b.stoSaveAccount({ address: 'B', private_key: 'public-B' }, 'public-password-B')
            : b.stoSavePassword('public-password-B');
        await new Promise(setImmediate);
        const before = f.writes.length;
        time.expire();
        const result = await waiting;
        release.resolve();
        await held;
        assert.equal(result, null);
        assert.equal(before, 0);
        assert.equal(f.writes.length, 0);
    });
}

test('matching passwords preserve both concurrent account imports', async () => {
    const f = passwordFixture(), a = f.page(), b = f.page();
    const first = a.stoSaveAccount({ address: 'A', private_key: 'public-A' }, 'public-password');
    await f.entered.promise;
    const second = b.stoSaveAccount({ address: 'B', private_key: 'public-B' }, 'public-password');
    f.release.resolve();
    assert.ok((await Promise.all([first, second])).every(Boolean));
    assert.deepEqual(Object.keys(f.sync.accounts).sort(), ['A', 'B']);
});

test('unavailable shared locking prevents password, session and account writes', async () => {
    const f = passwordFixture(), a = f.page({ navigator: { locks: null } });
    f.release.resolve();
    assert.equal(await a.stoSavePassword('public-password'), null);
    assert.equal(await a.stoSaveAccount({ address: 'A', private_key: 'public-A' }, 'public-password'), null);
    assert.equal(f.writes.length, 0);
});

function clock() {
    const timers = new Map();
    let id = 0;
    return {
        setTimeout(fn, ms) { assert.equal(ms, 5000); timers.set(++id, fn); return id; },
        clearTimeout(id) { timers.delete(id); },
        expire() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
        pending: () => timers.size,
    };
}

for(const samePage of [true, false]) {
    test(`expired ${samePage ? 'same-page' : 'cross-page'} waiter never executes after the holder finishes`, async () => {
        const f = fixture(), time = clock(), a = f.page(undefined, time);
        const b = samePage ? a : f.page(undefined, time);
        const entered = deferred(), release = deferred();
        const first = a.accMutate(async () => { entered.resolve(); await release.promise; return 'held'; });
        await entered.promise;
        let calls = 0;
        const second = b.accMutate(() => { calls++; });
        time.expire();
        assert.equal(await second, null);
        assert.equal(calls, 0);
        release.resolve();
        assert.equal(await first, 'held');
        assert.equal(await b.accMutate(() => 'next'), 'next');
        assert.equal(calls, 0);
        assert.equal(time.pending(), 0);
    });
}

test('an active write retains its lock beyond the acquisition deadline', async () => {
    const f = fixture(), time = clock(), a = f.page(undefined, time), b = f.page(undefined, time);
    const entered = deferred(), release = deferred();
    const first = a.accMutate(async () => { entered.resolve(); await release.promise; return 'written'; });
    await entered.promise;
    assert.equal(time.pending(), 0);
    time.expire();
    let enteredSecond = false;
    const second = b.accMutate(() => { enteredSecond = true; return 'second'; });
    await new Promise(setImmediate);
    assert.equal(enteredSecond, false);
    release.resolve();
    assert.deepEqual(await Promise.all([first, second]), ['written', 'second']);
    assert.equal(time.pending(), 0);
});

test('a granted callback failure propagates and clears the timer', async () => {
    const f = fixture(), time = clock(), a = f.page(undefined, time);
    await assert.rejects(a.accMutate(() => { time.expire(); throw Error('write failed'); }), /write failed/);
    assert.equal(time.pending(), 0);
    assert.equal(await a.accMutate(() => 'recovered'), 'recovered');
});

for(const synchronous of [true, false]) {
    test(`${synchronous ? 'synchronous' : 'asynchronous'} lock request failure propagates and clears the timer`, async () => {
        const f = fixture(), time = clock();
        const a = f.page({ request() {
            if(synchronous) throw Error('unavailable');
            return Promise.reject(Error('unavailable'));
        } }, time);
        await assert.rejects(a.accMutate(() => assert.fail('must not write')), /unavailable/);
        assert.equal(time.pending(), 0);
    });
}

test('missing AbortController refuses mutation without requesting a lock', async () => {
    const f = fixture(), a = f.page({ request() { assert.fail('must not request'); } }, { AbortController: undefined });
    assert.equal(await a.accMutate(() => assert.fail('must not write')), null);
});
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
