// MoneyNex build config (merged: remote's cfg-module structure + local pipeline content).
// Note: hacash_sdk (wasm, ~1.1MB) is NOT concatenated into bundles — popup/tail/tail.html
// loads jslib/hacash_sdk.js via a separate <script> tag (one copy per extension, not N).
// The remote service modules wallet/rpc/tx/connectstore are NOT bundled: their content
// lives (hardened) in popup/login/login.js and jslib/moneynx_txview.js. Only the chain
// service is new functionality and ships as popup/chain/chain.js.
const bgd = './background/'
, ppd = './popup/'
;

module.exports = {
    auto_rebuild: false,
    refresh_rebuild: true,
    bgd,
    ppd,
    bgfls: [
        './jslib/crypto-js.4.1.1',
        './jslib/crypto-util',
        './jslib/message-types',
        `${bgd}init`,
        `${bgd}listener`,
        `${bgd}sites`, // B (Phase 3): site-connection notification framework (connect_sites diff → tab pushes)
        `${bgd}account`,
        `${bgd}main`,
    ],
    pppjslibs: [
        './jslib/crypto-util',
        './jslib/message-types',
        './jslib/elliptic.min',
        './jslib/moneynx_sdk_facade',
        './jslib/moneynx_txview',
        './jslib/msglayout',
        './jslib/assetamt',
        './jslib/importkey',
    ],
    popup_common: [
        [
            'comp/wptip',
            'comp/wpcfm',
            'comp/wpass',
            'comp/swtgas',
            'comp/pghead',
            'login/init',
        ],
        ['tokens', 'html', 'comp'] // add login; 'tokens' = design tokens wired first (B1; the single build.cfg line owned by workflow B)
    ],
    popup_services: [
        './popup/chain/chain',
    ],
    page_defs: {
        'moneynex': [
            [
                'index/home',
                'index/acinf',
                'index/dotrs',
                'index/chains',
                'index/chainform',
                'connectedsites/connlists', // in-page view (home ⋮ menu), same component as the standalone page
            ],
            ['index']
        ], // index
        'connect': [
            [
                'connect/conn'
            ],
            ['connect']
        ], // connect wallet
        'transfer': [
            [
                'transfer/sigtrs'
            ],
            ['transfer']
        ], // do transfer
        'signtx': [
            [
                'signtx/signtx'
            ],
            ['signtx']
        ], // sign tx
        'signtext': [
            [
                'signtext/signtext'
            ],
            ['signtext']
        ], // sign arbitrary text (rejects raw 32B hashes)
        'raisefee': [
            [
                'raisefee/raisefee'
            ],
            ['raisefee']
        ], // raise fee
        'actionview': [
            [
                'actionview/actionview'
            ],
            ['actionview']
        ], // full action review (read-only)
        'connectedsites': [
            [
                'connectedsites/connlists'
            ],
            ['connectedsites']
        ], // connected sites management (A3; mount id cnls, doc/plan.cn.md appendix.3-2)
        'switchchain': [
            [
                'switchchain/switchchain'
            ],
            ['switchchain']
        ], // dapp-requested network switch approval
    },
}
