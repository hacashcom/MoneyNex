MoneyNex Open Platform SDK Interface Documentation
===

> This document is a third-party access development guide and SDK interface description for the Hacash ecosystem wallet MoneyNex, which is intended for developers of trading platforms, mining services, or other tools in the Hacash ecosystem

Through the open interface of the MoneyNex wallet, functions such as obtaining the user's address, initiating a transfer, signing a transaction or inscribed HACD can be achieved, and the corresponding data can be returned, bringing users a more convenient and secure product experience.

Make sure you have the latest version of MoneyNex installed in the latest version of chrome, especially because some experimental APIs may require the latest version from Github to support them. Let's get started!

### Interface mode

The MoneyNex plugin wallet supports the SDK interface in the form of attaching JS code to a web page, by injecting `window. MoneyNex` global object to provide functionality.

When you open the web console, you see the following printed message, which means that the SDK of the wallet is normally supported:

```
hacash api runtime ok.
MoneyNex SDK ok.
```

This means that both Hacash's API and MoneyNex's SDK are ready to use.

### Check wallets

The front-end page of a third-party website can check whether the user has installed the MoneyNex wallet (hereinafter referred to as the wallet) in the form of registering callbacks, checking global variables, and obtaining wallet information such as icons and version numbers. There are two main ways:

1. Register the 'MoneyNexInit' callback function

Add the following code to any web page:


```js
window.MoneyNexInit = function(wallet_info, money_nex) {
    console.log(wallet_info， window.MoneyNex.info) // Wallet Info
    console.log(money_nex, window.MoneyNex) // SDK Object
    // do something
    // ...
}
```

Once the wallet is ready, it will check the `window. MoneyNexInit` global function and call this function to notify the consumer of the status of the wallet to be ready for the SDK to be available. At this point, you can start to get the wallet address, initiate a transfer, and other operations.

2. Check the `MoneyNex` global object at regular intervals

If you miss or are inconvenient to register the MoneyNexInit global function due to front-end architecture issues, you can also check the `MoneyNex` global object at any time to determine if the SDK is already available:

```js
setTimeout(function(){
    if(window.MoneyNex){
        console.log(MoneyNex, MoneyNex.info)
    }else{
        alert("not find MoneyNex wallet")
    }
}, 1200)

```

window.MoneyNex object is available, which means that the wallet SDK is available.

### SDK API List

The SDK interface of the wallet is almost always registered in the form of an asynchronous callback of `MoneyNex.api_name(params, function(data){})`. Here's a list of available APIs:

1. `wallet` obtains the current primary address of the user's wallet, and returns an Error if it is not authorized
2. `connect` initiates authorization to connect to the wallet, and returns the user's wallet information after success
3. `transfer` initiates various transactions and signs broadcasts, returning transaction information

### Get the user's wallet address / Check if the wallet is authorized to be connected

Before obtaining the customer's address for the first time, the user needs to manually authorize the website (subject to the domain name), call the 'wallet' interface to check whether it has been authorized, and if so, return the user's wallet address and other information:

```js
MoneyNex.wallet({}, acc => {
    console.log(acc) // {address: '1LRi6Wn38...'}

    if(!acc || !acc.address){
        alert("The user is not connected to the wallet")
    }

    // connected ok
    let user_addr = acc.address
})
```

### Initiate authorization connection

```js
MoneyNex.connect({}, acc => {
    console.log(acc) // {address: '1LRi6Wn38...'}
    let user_addr = acc.address
})
```

Call the connect interface, the wallet will open an authorization page connected to the wallet, and when the user completes the authorization, the wallet will notify the success through a callback. If the user cancels or does not click Confirm Authorization, the callback function will not be called.

### Initiate transactions such as HAC transfers

```js
let txobj = JSON.stringify({
    actions: [{
        kind: 1, // HAC transfer
        to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
        amount: '1:248'
    }/*{kind: 6, ....}*/]
})
txobj = encodeURIComponent(btoa(txobj))
// call api
MoneyNex.transfer({txobj}, (a, b) => {
    trsw.innerHTML = JSON.stringify(a)
    console.log(a, b)
})

```

By encoding the JSON data describing the transaction and passing it to the SDK, you can initiate the creation of a transaction such as a transfer, request the user's signature, and broadcast it to the Hacash blockchain for packaging and confirmation. After the signature is successful, the transaction information will be return back as follows:

```js
{
    description: ['1ARE89cbY5UnVv8UT14p1WiCMEh21YLfQT as executed account and pay 0.00011HAC tx fee', 'Transfer 1HAC to 19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod'],
    ret: 0,
    success: true,
    txbody: "020065f198e800674e11e34c472ebfba2d34528fccd8aba826f2c4f3010b000100010061f6092ccb33aae47d219f801a7fa41a4649fdb9f8010100000000",
    txfee: "ㄜ11:243",
    txhash: "90ce0536b9cfd37a9d11e2d99980da4d21179affb705fce3ca4e3d1f4f96ce24",
    txhashfee: "6e9640bda5f4a3ba65a5b86745f3dc30f05a7c6525bf4477ba42d64041578c9d"
}
```

The callback API returns information such as the transaction description, hash, and transaction body.

The currently supported trading `actions` are:

1. HAC transfer:

```js
{
    kind: 1, // HAC transfer
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    amount: '1:248'
}
```

2. HACD transfer:

```js
{
    kind: 6,
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    diamond: 'AAABBB,WWWWTT'
}
```

2. HACD inscription:

```js
{
    kind: 32,
    diamond: 'AAABBB,WWWWTT', // one or more max 200
    inscription: 'First HACD inscription!' 
}
```

The above transaction construction adopts Hacash's readable contract technology, a variety of transfers can be combined at will and signed at one time, which will be wrapped in a single transaction and confirmed by the block, and all transfers and inscriptions will take effect at the same time.

More transaction 'action' categories are in development.

