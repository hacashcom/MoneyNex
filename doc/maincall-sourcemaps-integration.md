# Maincall Sourcemaps Integration

MoneyNex accepts optional, untrusted source labels alongside a `signtx` request. The transaction body remains the only source of code and protocol facts. The return value and signing digest are unchanged.

```js
await MoneyNex.signtx({
  txbody: finalTransactionBodyHex,
  sourcemaps: [
    { action_path: "0", sourcemap: firstSourceMap },
    { action_path: "3/1/0", sourcemap: nestedSourceMap },
  ],
})
```

`action_path` is the zero-based absolute path in the final SDK action tree. Top-level actions use `"0"`, `"1"`, and so on. Nested paths append each child index, such as `"2/0"` or `"2/1/0"`. Determine paths only after the final transaction has been assembled; inserted guard or setup actions shift later indexes.

Each `sourcemap` uses the SDK SourceMap JSON shape. This minimal sample has a selector that matches the name `swap`:

```json
{
  "libs": [],
  "funcs": [{"sig": "25226e33", "name": "swap"}],
  "slots": ["out"],
  "lets": [],
  "vars": [],
  "params": [],
  "param_prelude_count": null,
  "consts": []
}
```

Use function signatures emitted by the same compiler that generated the IR. `action_path` must be taken from SDK `Review.actions` after inspecting the final body; do not infer it from a pre-assembly action list. For example, copy a maincall's `path` (`"0"` or `"3/1/0"`) verbatim into the matching `action_path`.

In review mode, only legal function and slot identifiers are surfaced as annotations after function selector validation. The displayed code retains its actual selector and numeric slot (for example, `$0`), and literals come from the submitted IR. Constants, declaration classes, parameter prelude hints, library aliases, and map addresses do not rewrite review text or transaction facts. The actual VM address table comes from SDK `Review.address_table`.

Only the plural `sourcemaps` array is supported. A single top-level `sourcemap` parameter is not applied; no `codes_hash` field is required. Unknown paths and duplicate paths are diagnosed and ignored. If multiple entries target one path, all entries for that path are ignored. Map data is display-only and does not affect the body, signature, digest, or returned result shape.

Limits: at most 256 entries, 64 KiB per entry, and 256 KiB combined (UTF-8 JSON bytes). Non-array or oversized input returns `request_invalid` through the normal callback. Source labels are optional: omit the array when no compiler map is available. MoneyNex processes multiple maincalls sequentially on the page, yielding between jobs/pages; no Worker is required.
