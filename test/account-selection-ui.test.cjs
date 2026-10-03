const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.MNX_TEST_SOURCE_ROOT || path.join(__dirname, '..');
const pages = [
    ['index/home/vue.js', 'routePageMain', 'addr'],
    ['signtx/signtx/vue.js', 'routePageSignTx', 'adr'],
    ['transfer/sigtrs/vue.js', 'routePageSigTrs', 'adr'],
    ['raisefee/raisefee/vue.js', 'routePageRaiseFee', 'adr'],
];
for(const outcome of ['refused', 'error', 'success', 'cancelled', 'reopened']) {
    test(`password dialog: ${outcome} persistence gates approval`, async () => {
        let methods, finish, approvals = 0;
        const context = vm.createContext({
            yes: true, no: false, nil: null, vue_tpl_wpass: '', btncon_confirm: 'Confirm',
            _setTimeout() {}, _clearTimeout() {}, MD5: () => 'public-digest', salthcxwlt: 'public-salt',
            stoReadPasskey: async () => 'public-digest',
            stoSavePassword: () => new Promise((resolve, reject) => {
                finish = () => outcome === 'error' ? reject(Error('private diagnostics')) : resolve(outcome !== 'refused');
            }),
            VueCreateApp(name, template, data, handlers) { methods = handlers; return { ctx: {} }; },
        });
        vm.runInContext(fs.readFileSync(path.join(root, 'popup/comp/wpass/vue.js'), 'utf8'), context);
        const dialog = { ...methods, pswd: 'public-password', err: '', cnsh: true, c1: () => { approvals++; } };
        const pending = dialog.cok();
        await new Promise(setImmediate);
        const before = { approvals, visible: dialog.cnsh };
        if(outcome === 'cancelled') dialog.hide();
        if(outcome === 'reopened') dialog.open(() => { approvals++; });
        finish();
        await pending;
        assert.deepEqual(before, { approvals: 0, visible: true });
        assert.equal(approvals, outcome === 'success' ? 1 : 0);
        if(outcome === 'refused' || outcome === 'error') {
            assert.equal(dialog.cnsh, true);
            assert.equal(dialog.err, 'Wallet unlock failed. Refresh the wallet and try again.');
        }
        if(outcome === 'cancelled' || outcome === 'reopened') assert.equal(dialog.err, '');
    });
}
async function load(file, route) {
    const state = { methods: null, errors: [], refreshes: 0, unmounts: 0, routes: 0, hides: 0 };
    const context = vm.createContext({
        yes: true, no: false, nil: null, ctime: () => 1000000, minutes: 60,
        $id: () => ({ classList: { add() {} } }), _setTimeout() {}, _setInterval() {},
        chrome_storage_local: {}, chrome_storage_session: {}, chrome_storage_sync: {},
        vue_tpl_home: '', vue_tpl_signtx: '', vue_tpl_sigtrs: '', vue_tpl_raisefee: '', vue_tpl_init: '',
        icfpath: '', urlquery: { txbody: 'public-fixture', txobj: 'public-fixture' },
        window: { atob: () => '{"timestamp":1}' }, JSON_parse: JSON.parse,
        addrOmitted: address => address, mnx_dapp_reply: () => ({}),
        showWPerr: message => state.errors.push(message),
        $display_none: () => { state.hides++; }, MD5: () => 'public-digest',
        VueCreateApp(name, template, data, methods) {
            state.methods = methods;
            return { app: { unmount() { state.unmounts++; } }, ctx: {} };
        },
        SHA256: () => 'public-hash', swtgasAppObj: {},
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'popup/login/login.js'), 'utf8'), context);
    context.stoReadCurrentAccount = async () => null;
    context.stoReadPassword = async () => ({});
    context.stoSaveAccount = async () => 'saved';
    context.stoSaveRandomKey = async () => {};
    vm.runInContext(fs.readFileSync(path.join(root, 'popup', file), 'utf8'), context);
    await context[route]('A');
    context.refreshHomeTrsLog = async () => { state.refreshes++; };
    if(route === 'routePageInit') context.routePageMain = async () => { state.routes++; };
    return { context, state };
}
for(const outcome of ['refused', 'error', 'success']) {
    test(`unlock: ${outcome} password persistence gates hiding and navigation`, async () => {
        const { context, state } = await load('login/init/vue.js', 'routePageInit');
        context.stoReadPasskey = async () => 'public-digest';
        let finish;
        context.stoSavePassword = () => new Promise((resolve, reject) => {
            finish = () => outcome === 'error' ? reject(Error('private storage diagnostics')) : resolve(outcome === 'success');
        });
        const unlocking = state.methods.doulk.call({ ulkpass: 'public-password', acc: null });
        await new Promise(setImmediate);
        assert.equal(state.hides, 0);
        assert.equal(state.routes, 0);
        finish();
        await unlocking;
        assert.equal(state.hides, outcome === 'success' ? 1 : 0);
        assert.equal(state.routes, outcome === 'success' ? 1 : 0);
        assert.equal(state.unmounts, outcome === 'success' ? 1 : 0);
        assert.deepEqual(state.errors, outcome === 'success' ? [] : ['Wallet unlock failed. Refresh the wallet and try again.']);
    });
}
for (const [file, route, field] of pages) {
    for (const outcome of ['refused', 'error', 'success']) {
        test(`${route}: ${outcome} selection does not update the page before persistence`, async () => {
            const { context, state } = await load(file, route);
            let finish;
            context.stoSaveCurrentAccount = () => new Promise((resolve, reject) => {
                finish = () => outcome === 'error' ? reject(Error('private storage diagnostics')) : resolve(outcome === 'success');
            });
            const page = { [field]: 'A', sadr: 'A', adrswct: true, activeTab: 'collection',
                crtrs: async () => { state.refreshes++; }, ldbls: async () => { state.refreshes++; } };
            const pending = state.methods.swtcuraddr.call(page, 'B');
            const before = { address: page[field], picker: page.adrswct, refreshes: state.refreshes };
            finish();
            await pending;
            assert.deepEqual(before, { address: 'A', picker: true, refreshes: 0 });
            assert.equal(page[field], outcome === 'success' ? 'B' : 'A');
            assert.equal(page.adrswct, outcome !== 'success');
            assert.equal(state.errors.length, outcome === 'success' ? 0 : 1);
            if(outcome !== 'success') {
                assert.equal(state.refreshes, 0);
                assert.doesNotMatch(state.errors[0], /private storage diagnostics/);
            }
        });
    }
}
for (const outcome of ['refused', 'error', 'success']) {
    test(`account import: ${outcome} selection gates navigation and unmount`, async () => {
        const { context, state } = await load('login/init/vue.js', 'routePageInit');
        context.stoSaveCurrentAccount = async () => {
            if(outcome === 'error') throw Error('private storage diagnostics');
            return outcome === 'success';
        };
        await state.methods.toifhome.call({ newmode: true, acc: { address: 'B' } });
        assert.equal(state.routes, outcome === 'success' ? 1 : 0);
        assert.equal(state.unmounts, outcome === 'success' ? 1 : 0);
        assert.equal(state.errors.length, outcome === 'success' ? 0 : 1);
    });
}
