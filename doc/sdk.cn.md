MoneyNex 开放平台 SDK 接口文档
===

> 本文档是 Hacash 生态钱包 MoneyNex 的第三方接入开发指引和 SDK 接口说明，为 Hacash 生态的交易平台、矿业服务或其他工具的开发者准备

通过 MoneyNex 钱包的开放接口，可以达成诸如获取用户地址、发起转账、签名交易或铭刻 HACD 等功能，并获取相应数据返回，为用户带来更便捷和安全的产品体验。

请确保你已经在最新版本的 chrome 浏览器中安装好了 MoneyNex 钱包，特别注意，某些试验性质的 API 可能需要 Github 发布的最新版本才支持。让我们开始吧！

### 接口方式

MoneyNex 插件钱包采用向网页附加 JS 代码的形式来支持 SDK 接口，通过注入`window.MoneyNex` 全局对象来提供各项功能。

当打开网页控制台后，看到以下打印信息即表示钱包的 SDK 正常支持：

```
hacash api runtime ok.
MoneyNex SDK ok.
```
表示 Hacash 的 API 和 MoneyNex 的 SDK 都已经准备好可用。

### 检测钱包

第三方网站的前端页面可以通过注册回调、检查全局变量的形式来检查用户是否已经安装好了 MoneyNex 钱包（以下简称钱包），并获取图标、版本号等钱包信息。主要通过两种方式：

1. 注册 `MoneyNexInit` 回调函数

在任意网页添加以下代码：

```js
window.MoneyNexInit = function(wallet_info, money_nex) {
    console.log(wallet_info， window.MoneyNex.info) // Wallet Info
    console.log(money_nex, window.MoneyNex) // SDK Object
    // do something
    // ...
}
```

钱包在准备好之后，将检查页面中的 `window.MoneyNexInit` 全局函数，并调用此函数，以通知使用者钱包的状态以准备好，SDK 可用。此时，可以开始获取钱包地址、发起转账等操作。

2. 定时检查 `MoneyNex` 全局对象

如果因为前端架构等问题错过或不便注册 MoneyNexInit 全局函数时，还可以在任意时候检查 `MoneyNex` 全局对象来判断 SDK 是否已经可用：

```js
setTimeout(function(){
    if(window.MoneyNex){
        console.log(MoneyNex, MoneyNex.info)
    }else{
        alert("not find MoneyNex wallet")
    }
}, 1200)

```

window.MoneyNex 对象可用，即代表钱包 SDK 可用。

### SDK API 列表

钱包的 SDK 接口几乎都以 `MoneyNex.api_name(params, function(data){})` 的异步回调形式注册。以下是可用的 API 列表：

1. `wallet` 获取用户钱包的当前主地址，未授权则返回 Error
2. `connect` 发起连接钱包的授权，成功后返回用户钱包信息
3. `transfer` 发起各种交易并签名广播，返回交易信息

### 获取用户钱包地址 / 检查是否授权连接钱包

在首次获取客户地址之前，需要用户手动为网站授权（以域名为准），通过调用 `wallet` 接口来检查是否已经授权，如果已经授权，则返回用户钱包地址等信息：

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

### 发起钱包授权连接

```js
MoneyNex.connect({}, acc => {
    console.log(acc) // {address: '1LRi6Wn38...'}
    let user_addr = acc.address
})
```

调用 connect 接口，钱包将打开一个连接到钱包的授权页面，当用户完成授权时，钱包将通过回调通知成功。如果用户取消或者一直未点击确认授权，则回调函数不会被调用。

### 发起转账等交易

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

通过将描述交易的 JSON 数据编码后传递给 SDK ，即可发起创建转账等交易的，并请求用户签名后广播给 Hacash 区块链打包和确认。签名成功后将交易信息回调返回：

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

回调接口返回交易描述、哈希和交易体等信息。

目前支持的交易 `actions` 有：

1. HAC 转账：

```js
{
    kind: 1, // HAC transfer
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    amount: '1:248'
}
```

2. HACD 转账：

```js
{
    kind: 6,
    to: '19vyHUgwSqQci1kUcAa5ryShm1Aau3qxod',
    diamond: 'AAABBB,WWWWTT'
}
```

2. HACD 铭刻：

```js
{
    kind: 32,
    diamond: 'AAABBB,WWWWTT', // one or more max 200
    inscription: 'First HACD inscription!' 
}
```

以上交易构建采用了 Hacash 的可读合约技术，多种转账可以随意组合并一次性签名，将被包裹在单笔交易内被区块打包确认，所有转账、铭刻同时生效。

更多交易 `action` 类别正在开发支持中。

### 测试代码

上述 SDK 接口的测试参考用例，可以在下面目录中找到，并可作为开发者的编写示范：

- [测试代码](https://github.com/hacashcom/MoneyNex/tree/main/test)
