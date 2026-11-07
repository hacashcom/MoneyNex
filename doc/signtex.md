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

## Directed cells (26–33)

Directed cells move value over a direct edge between the authorizing account and an arbitrary counterparty, without touching the TEX escrow ledger. The counterparty is an `AddrOrPtr`: a readable address string, or a bare pointer index into the executing transaction’s address list (`ptr:0` is the transaction main).

- **Directed pay** (`DirectedZhuPay` 26, `DirectedSatPay` 28, `DirectedDiaPay` 30, `DirectedAssetPay` 32): pays from the authorizing account **to** the counterparty. The authorizer’s signature is the only consent needed; the review lists these under *Payments*.
- **Directed get** (`DirectedZhuGet` 27, `DirectedSatGet` 29, `DirectedDiaGet` 31, `DirectedAssetGet` 33): takes from the counterparty **into** the authorizing account, listed under *Receipts*. At execution the protocol requires the counterparty to be a **transaction signer** — the counterparty’s transaction signature is the payment consent. A `from` that does not resolve to a signer makes the whole transaction fail, so a get cell is only ever executable against main or a co-signer.

The SDK descriptions name the counterparty explicitly; directed get descriptions read “Take … directly from transaction signer … (you, when executing)” — when the wallet account executes the transaction as main, a directed get takes the assets from that account. Inside a transaction body review (signtx), a directed get renders with warning prominence as “will take … from you (transaction main)”, as prominently as a transfer leg; the summary of the TEX action notes that it includes signer-taking cells. These cells require SDK ABI 2.8; the wallet refuses any authorization containing cells it cannot explain.

## Result

Success returns `{ret: 0, success: true, authorization, signed_authorization, proof, review_binding, address}`. `signed_authorization` is the SDK `hacash.tex/signed-bundle@1`, including the encoded signed action. `proof` is a `hacash.sdk/signature-proof@1` bound to the SDK signing request. The SDK verifies the encoded action before it is returned. The request never contains a private key.

The method is enabled by SDK ABI 2.8 operations 26–30 while the wallet’s shared SDK compatibility floor remains ABI 2.7 for existing features. On older SDKs only this TEX request reports that an SDK upgrade is required.
