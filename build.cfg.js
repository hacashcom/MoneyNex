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
        './jslib/hacash_sdk',
        `${bgd}init`,
        `${bgd}listener`,
        `${bgd}account`,
        `${bgd}main`,
    ],
    pppjslibs: [
        './jslib/crypto-util',
        './jslib/message-types',
        './jslib/hacash_sdk',
    ],
    popup_common: [
        [
            'comp/wptip',
            'comp/wpcfm',
            'comp/wpass',
            'comp/swtgas',
            'login/init',
        ],
        ['html', 'comp'],
    ],
    popup_services: [
        './popup/wallet/wallet',
        './popup/chain/chain',
        './popup/rpc/rpc',
        './popup/tx/tx',
        './popup/connectstore/connectstore',
    ],
    page_defs: {
        moneynex: [
            [
                'index/home',
                'index/acinf',
                'index/dotrs',
                'index/chains',
                'index/chainform',
            ],
            ['index'],
        ],
        switchchain: [
            [
                'switchchain/switchchain',
            ],
            ['switchchain'],
        ],
        connect: [
            [
                'connect/conn',
            ],
            ['connect'],
        ],
        transfer: [
            [
                'transfer/sigtrs',
            ],
            ['transfer'],
        ],
        signtx: [
            [
                'signtx/signtx',
            ],
            ['signtx'],
        ],
        raisefee: [
            [
                'raisefee/raisefee',
            ],
            ['raisefee'],
        ],
    },
}
