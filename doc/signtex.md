# `signtex` wallet request

`signtex` is a separate dApp request for inspecting and signing a TEX authorization. It requires the site to be connected to MoneyNex. The wallet opens an approval page, and the request resolves only after local SDK inspection and explicit user approval. Canceling, closing, or refusing the request returns an error. The wallet does not fall back to `signtext`.

## Request

```js
const result = await window.MoneyNex.signtex({
  authorization: {
    schema: 'hacash.tex/authorization@1',
    address: '...',
    cells: [
      { cellid: 1, haczhu: '100000000' },
      { cellid: 25, chainid: 0 },
    ],
  },
})
```

Cells remain in their supplied order. Amounts and heights should be encoded as decimal strings when large integer values are possible. A payment authorization must include a chain-ID equality cell; the wallet requires it to match the currently selected network, including chain ID `0`. Unknown cells and conditions the SDK cannot interpret are refused.

The approval page displays the SDK’s ordered cell descriptions and canonical cell values. It explains that the authorization is repeatable and cannot be revoked. Height lower bounds can schedule a future start; upper bounds expire the authorization. The wallet rejects an already expired or contradictory height window, and checks the account, selected network, and expiry again before returning a signature. Any expiry estimate uses 288 blocks per day and is labeled approximate; heights remain authoritative.

## Result

Success returns `{ret: 0, success: true, authorization, signed_authorization, proof, review_binding, address}`. `signed_authorization` is the SDK `hacash.tex/signed-bundle@1`, including the encoded signed action. `proof` is a `hacash.sdk/signature-proof@1` bound to the SDK signing request. The SDK verifies the encoded action before it is returned. The request never contains a private key.

The method is enabled by SDK ABI 2.8 operations 26–30 while the wallet’s shared SDK compatibility floor remains ABI 2.7 for existing features. On older SDKs only this TEX request reports that an SDK upgrade is required.
