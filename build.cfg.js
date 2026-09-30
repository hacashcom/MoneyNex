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
            'login/init',
        ],
        ['html', 'comp'] // add login
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
        'switchchain': [
            [
                'switchchain/switchchain'
            ],
            ['switchchain']
        ], // dapp-requested network switch approval
    },
}
