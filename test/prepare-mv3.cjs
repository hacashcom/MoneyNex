// Build a disposable storage probe, never an installable MoneyNex release.
// Run: node test/prepare-mv3.cjs. Load the printed folder in an empty,
// signed-out Chrome test profile, then open the extension's Options page.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

function bootstrap() {
    'use strict';
    const manifest = chrome.runtime.getManifest();
    if (manifest.name !== 'MoneyNex storage probe - TEST ONLY' ||
        manifest.host_permissions || manifest.content_scripts || manifest.key ||
        JSON.stringify(manifest.permissions) !== '["storage"]') {
        throw Error('Refusing a non-probe extension');
    }
    const prefix = 'mnx_probe_';
    // Only fixed fixture keys are exposed, including during cleanup.
    const keys = ['accounts', 'current_account', 'crptpskey', 'password'];
    const physical = key => {
        if (!keys.includes(key)) throw Error('Unexpected fixture key');
        return prefix + key;
    };
    function area(native) {
        return {
            async get(key) {
                const value = await native.get(physical(key));
                return { [key]: value[physical(key)] };
            },
            async set(values) {
                const mapped = {};
                for (const [key, value] of Object.entries(values)) mapped[physical(key)] = value;
                await native.set(mapped);
            },
            async remove(key) { await native.remove(physical(key)); },
        };
    }
    Object.assign(window, {
        yes: true, no: false, nil: null,
        ctime: () => Math.floor(Date.now() / 1000),
        $id: () => ({ classList: { add() {} } }),
        _setTimeout: () => {}, // Do not initialize the product UI.
        chrome_storage_sync: area(chrome.storage.sync),
        chrome_storage_session: area(chrome.storage.session),
        chrome_storage_local: area(chrome.storage.local),
        // Intentionally fake crypto and non-address fixtures; never use secrets.
        MD5: value => 'fixture-digest:' + value,
        AES_encrypt: (key, digest) => JSON.stringify({ key, digest }),
        AES_decrypt: (value, digest) => {
            const record = JSON.parse(value);
            return record.digest === digest ? record.key : null;
        },
        resetProbe: async () => {
            await chrome.storage.sync.remove(keys.map(physical));
            await chrome.storage.session.remove(keys.map(physical));
        },
    });
}

function runner() {
    'use strict';
    const result = document.getElementById('result');
    const buttons = [...document.querySelectorAll('button')];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (value, message) => { if (!value) throw Error(message); };
    const deferred = () => {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        return { promise, resolve };
    };
    async function within(promise, ms = 10000) {
        let timer;
        try {
            return await Promise.race([promise, new Promise((_, reject) => {
                timer = setTimeout(() => reject(Error('Probe timed out')), ms);
            })]);
        } finally { clearTimeout(timer); }
    }
    async function frame() {
        const element = document.createElement('iframe');
        element.hidden = true;
        const loaded = new Promise(resolve => { element.onload = resolve; });
        element.src = 'frame.html';
        document.body.append(element);
        try {
            await within(loaded);
            assert(typeof element.contentWindow.accMutate === 'function', 'Candidate did not load');
            return { element, api: element.contentWindow };
        } catch (error) { element.remove(); throw error; }
    }
    const account = name => ({ address: name, private_key: 'PUBLIC-FIXTURE-' + name });
    const password = 'PUBLIC-FIXTURE-PASSWORD';
    async function cleanFrames(action) {
        let a, b;
        try { a = await frame(); b = await frame(); return await action(a, b); }
        finally { a?.element.remove(); b?.element.remove(); }
    }
    async function imports(conflicting) {
        await resetProbe();
        return cleanFrames(async (a, b) => {
            const entered = deferred(), release = deferred();
            const nativeGet = a.api.chrome_storage_sync.get;
            let first = true;
            a.api.chrome_storage_sync.get = async key => {
                const value = await nativeGet(key);
                if (first && key === 'crptpskey') {
                    first = false; entered.resolve(); await release.promise;
                }
                return value;
            };
            const saving = a.api.stoSaveAccount(account('A'), password);
            saving.catch(() => {});
            try {
                await within(entered.promise);
                const other = b.api.stoSaveAccount(account('B'), conflicting ? password + '-OTHER' : password);
                other.catch(() => {});
                await delay(100);
                const held = await navigator.locks.query();
                assert(held.held.some(x => x.name === 'moneynex-account-storage'), 'Missing active lock');
                assert(held.pending.some(x => x.name === 'moneynex-account-storage'), 'Missing cross-page waiter');
                release.resolve();
                const values = await within(Promise.all([saving, other]));
                assert(Boolean(values[0]) && Boolean(values[1]) === !conflicting, 'Unexpected save results');
                const records = await a.api.stoReadAccount();
                assert(Object.keys(records).sort().join(',') === (conflicting ? 'A' : 'A,B'), 'Incorrect account map');
                const digest = await a.api.stoReadPassword();
                assert(Object.values(records).every(x => JSON.parse(x.cryptkey).digest === digest), 'Password mismatch');
            } finally { release.resolve(); }
        });
    }
    async function selection() {
        await resetProbe();
        return cleanFrames(async (a, b) => {
            await a.api.stoSaveAccount(account('A'), password);
            await a.api.stoSaveAccount(account('B'), password);
            await a.api.stoSaveCurrentAccount('A');
            await b.api.stoRemoveAccount('A');
            assert(await a.api.stoSaveCurrentAccount('A') === null, 'Selected a removed account');
            assert(await b.api.stoReadCurrentAccount() === 'B', 'Invalid current pointer');
            await a.api.stoDoLock();
            assert(await b.api.stoReadPassword() == null, 'Other page retained stored session');
            // This observes stored state only, not revocation of already-issued keys.
        });
    }
    async function expiry() {
        return cleanFrames(async (a, b) => {
            const entered = deferred(), release = deferred();
            let late = 0;
            const active = a.api.accMutate(async () => { entered.resolve(); await release.promise; });
            active.catch(() => {});
            try {
                await within(entered.promise);
                const values = await within(Promise.all([a, b].map(x => x.api.accMutate(() => { late++; }))));
                assert(values.every(x => x === null), 'Waiters did not expire');
                const locks = await navigator.locks.query();
                assert(locks.held.some(x => x.name === 'moneynex-account-storage'), 'Active write lost its lock');
                assert(!locks.pending.some(x => x.name === 'moneynex-account-storage'), 'Expired waiter still queued');
                release.resolve(); await within(active);
                assert(await within(b.api.accMutate(() => 'fresh')) === 'fresh' && late === 0, 'Late callback or failed recovery');
            } finally { release.resolve(); }
        });
    }
    async function interruptedWrite(stage) {
        await resetProbe();
        return cleanFrames(async (a, b) => {
            const reached = deferred();
            const adapter = stage === 'password' ? a.api.chrome_storage_session : a.api.chrome_storage_sync;
            const set = adapter.set;
            adapter.set = async values => {
                await set(values); // Real Chrome storage has acknowledged this write.
                if (Object.hasOwn(values, stage)) {
                    reached.resolve();
                    return new Promise(() => {}); // Destroy the frame at this known partial state.
                }
            };
            a.api.stoSaveAccount(account('A'), password).catch(() => {});
            await within(reached.promise);
            a.element.remove();
            const records = await b.api.stoReadAccount();
            const session = await b.api.stoReadPassword();
            assert(Boolean(records.A) === (stage === 'accounts'), 'Unexpected partial account state');
            assert(Boolean(session) === (stage !== 'crptpskey'), 'Unexpected partial session state');
            assert(Boolean(await b.api.stoReadPasskey()), 'Missing acknowledged verifier');
            assert(!await b.api.stoReadCurrentAccount(), 'Partial setup selected an account');
            const prior = records.A?.cryptkey;
            assert(await within(b.api.stoSaveAccount(account('B'), password + '-OTHER')) === null, 'Wrong password accepted');
            assert(Boolean(await within(b.api.stoSaveAccount(account('A'), password))), 'Same-password retry failed');
            const recovered = await b.api.stoReadAccount();
            assert(Object.keys(recovered).join(',') === 'A', 'Retry corrupted the account map');
            assert(!prior || prior === recovered.A.cryptkey, 'Retry changed retained ciphertext');
        });
    }
    async function run(action) {
        buttons.forEach(x => { x.disabled = true; });
        result.textContent = 'Running public-fixture checks...';
        try { await action(); }
        catch (error) { result.textContent = JSON.stringify({ status: 'FAIL', error: error.message }, null, 2); }
        finally { buttons.forEach(x => { x.disabled = false; }); }
    }
    document.getElementById('run').onclick = () => run(async () => {
        assert(location.protocol === 'chrome-extension:' && navigator.locks, 'Requires installed disposable MV3 extension');
        const checks = [];
        for (const [name, action] of [
            ['Concurrent imports preserve both records', () => imports(false)],
            ['Conflicting first passwords are refused', () => imports(true)],
            ['Selection and stored lock state across pages', selection],
            ['Acquisition expiry and no late execution', expiry],
            ...['crptpskey', 'password', 'accounts'].map(stage => ['Frame destruction after ' + stage, () => interruptedWrite(stage)]),
        ]) {
            result.textContent = 'Running: ' + name;
            await action(); checks.push(name);
        }
        const worker = await within(chrome.runtime.sendMessage({ type: 'probe-ping' }));
        assert(typeof worker?.instance === 'string', 'Test worker unavailable');
        const report = { status: 'PASS', checks, workerStarted: true,
            scope: 'Production storage functions, native Web Locks, native Chrome sync/session storage, prefixed fixture keys, fake crypto. Frame destruction is not browser crash or power loss. Test worker is not the MoneyNex worker. Full popup and production worker remain untested.' };
        result.textContent = JSON.stringify(report, null, 2);
    });
    document.getElementById('checkpoint').onclick = () => run(async () => {
        await resetProbe();
        await cleanFrames(async a => {
            assert(Boolean(await a.api.stoSaveAccount(account('RESTART'), password)), 'Could not save checkpoint');
            await a.api.stoSaveCurrentAccount('RESTART');
        });
        result.textContent = 'Checkpoint saved. Close this page, reload ONLY this test extension in chrome://extensions, reopen Options, and click Check after extension reload. Do not run the suite or save another checkpoint first.';
    });
    document.getElementById('resume').onclick = () => run(async () => {
        await cleanFrames(async a => {
            const records = await a.api.stoReadAccount();
            assert(Object.keys(records).join(',') === 'RESTART', 'Checkpoint missing; prepare it first');
            assert(await a.api.stoReadCurrentAccount() === 'RESTART', 'Current pointer not retained');
            assert(!await a.api.stoReadPassword(), 'Session still present; reload the test extension first');
            assert(await a.api.stoSavePassword(password + '-OTHER') === null, 'Wrong password accepted');
            assert(Boolean(await a.api.stoSavePassword(password)), 'Checkpoint unlock failed');
            assert(await a.api.stoUnlockAccount(records.RESTART) === 'PUBLIC-FIXTURE-RESTART', 'Fixture recovery failed');
        });
        result.textContent = 'PASS: checkpoint retained and fixture unlocked after session loss. Manual extension reload only; not a browser crash, power-loss or production worker test.';
    });
}

function worker() {
    const instance = crypto.randomUUID();
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id === chrome.runtime.id && message?.type === 'probe-ping') respond({ instance });
    });
}

const source = fs.readFileSync(path.join(__dirname, '../popup/login/login.js'));
const scripts = {
    'bootstrap.js': '(' + bootstrap.toString() + ')();\n',
    'runner.js': '(' + runner.toString() + ')();\n',
    'worker.js': '(' + worker.toString() + ')();\n',
    'candidate.js': source,
};
for (const [name, content] of Object.entries(scripts)) new vm.Script(String(content), { filename: name });
const output = fs.mkdtempSync(path.join(__dirname, 'mv3-probe-'));
const manifest = {
    manifest_version: 3, name: 'MoneyNex storage probe - TEST ONLY', version: '0.0.1',
    description: 'Disposable public fixtures only. No wallet, signing or network requests.',
    permissions: ['storage'], background: { service_worker: 'worker.js' },
    action: { default_popup: 'runner.html' }, options_page: 'runner.html',
    content_security_policy: { extension_pages: "default-src 'none'; script-src 'self'; object-src 'none'; frame-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'" },
};
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>MoneyNex storage probe - TEST ONLY</title>';
const files = { ...scripts,
    'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
    'frame.html': html + '<script src="bootstrap.js"></script><script src="candidate.js"></script></html>',
    'runner.html': html + '<h1>MoneyNex storage probe - TEST ONLY</h1><p>Use an empty, signed-out Chrome test profile. No real keys or funds. Only prefixed public fixtures are written. Crypto is mocked; storage and Web Locks are native. Open Options for a full-page view.</p><button id="run">Run storage checks</button><button id="checkpoint">Save reload checkpoint</button><button id="resume">Check after extension reload</button><pre id="result">NOT RUN</pre><script src="bootstrap.js"></script><script src="runner.js"></script></html>',
};
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content);
fs.writeFileSync(path.join(output, 'provenance.json'), JSON.stringify({
    status: 'PREPARED_NOT_EXECUTED',
    source: 'popup/login/login.js',
    files: Object.entries(files).map(([name, content]) => ({ name, sha256: crypto.createHash('sha256').update(content).digest('hex') })),
}, null, 2) + '\n');
console.log('Prepared NOT EXECUTED disposable MV3 probe: ' + output);
console.log('Load unpacked only in an empty, signed-out test profile. Never load over MoneyNex.');
console.log('No installation, browser access or test execution was performed by this builder.');
