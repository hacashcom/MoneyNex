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
async function load(file, route) {
    const state = { methods: null, errors: [], refreshes: 0, unmounts: 0, routes: 0 };
    const context = vm.createContext({
        yes: true, no: false, nil: null, ctime: () => 1000000, minutes: 60,
        $id: () => ({ classList: { add() {} } }), _setTimeout() {}, _setInterval() {},
        chrome_storage_local: {}, chrome_storage_session: {}, chrome_storage_sync: {},
        vue_tpl_home: '', vue_tpl_signtx: '', vue_tpl_sigtrs: '', vue_tpl_raisefee: '', vue_tpl_init: '',
        icfpath: '', urlquery: { txbody: 'public-fixture', txobj: 'public-fixture' },
        window: { atob: () => '{"timestamp":1}' }, JSON_parse: JSON.parse,
        addrOmitted: address => address, mnx_dapp_reply: () => ({}),
        showWPerr: message => state.errors.push(message),
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
