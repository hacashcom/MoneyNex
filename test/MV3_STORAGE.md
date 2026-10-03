# Disposable MV3 storage probe

This is a test harness, not a wallet or release package. Installed MV3 execution is **pending**. Generating the folder or passing a mock preview does not close the PR's installed-extension release gate.

From the repository root, run `node test/prepare-mv3.cjs` using Node.js. It creates a new `test/mv3-probe-*` folder, checks JavaScript syntax and copies `popup/login/login.js` without modifying its bytes. `provenance.json` records SHA-256 hashes and starts with `PREPARED_NOT_EXECUTED`. Do not commit generated folders. No dependencies, download, installation or browser launch is performed.

## Run with public fixtures only

1. Create an empty Chrome test profile without signing into Google. Keep the personal wallet profile closed to test work. Never import a private key, enter a personal password or send funds.
2. Open `chrome://extensions`, enable Developer mode in that test profile, choose **Load unpacked**, and select the generated folder. Check the name **MoneyNex storage probe - TEST ONLY**. The manifest requests only `storage`, has no host permissions, content scripts, externally connectable handler or production extension key. Its CSP disallows network connections.
3. Open the test extension's **Options** page and click **Run storage checks**. Use one runner at a time. Save the complete visible result together with Chrome version, OS, exact Git commit, generated provenance hashes and any extension errors. A timeout, quota error or absent capability is a failed/incomplete run, not a pass. Avoid rapid repeated runs against Chrome sync quotas.
4. After a successful run, click **Save reload checkpoint**. Close the page, reload **only the test extension**, reopen Options, then click **Check after extension reload**. Do not run the suite or create another checkpoint between these steps. Retained account/current-pointer data, missing session data, wrong-password refusal and fixture recovery are checked. Record the manual reload procedure separately; do not label it a browser crash.

The harness uses the production storage functions, native Web Locks and native `chrome.storage.sync` / `chrome.storage.session`. Logical wallet keys map to an allowlisted `mnx_probe_` prefix. Cleanup removes only those fixture keys; it never clears a whole storage area. Cryptography is deliberately replaced with inspectable fixture strings and all accounts are invalid public placeholders. No SDK, signing or broadcast code is invoked. This does not test cryptographic confidentiality, valid account import, source-to-release equivalence or cloud sync across devices.

The seven automated scenarios cover concurrent imports, conflicting first passwords, selection after deletion plus stored session removal, bounded lock acquisition, and frame destruction after each acknowledged verifier/session/account write. The destruction cases inspect partial state, reject a different password and retry with the original fixture password while preserving existing ciphertext. They stop **after** Chrome acknowledges a write, not inside disk persistence. Timeout timing is subject to browser scheduling.

## Remaining release evidence

The worker is a minimal test worker responding to a fixed ping. Its availability does not validate the real MoneyNex background worker or its suspension/restart behavior. The runner's action popup is not the production popup UI. Independent pages, full product popup close/reopen, actual worker termination, full browser restart, disk faults, power loss, cross-device sync, and uncertain in-flight native writes need separate tests. Previously issued keys and cross-window revocation remain outside this storage PR.

Do not infer protection against administrator impersonation or fake diagnostic commands from these results. Never run commands received in private support messages; this documented repository test is intended for reviewers in a disposable profile, not as an end-user recovery procedure.
