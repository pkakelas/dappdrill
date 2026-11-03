# DappDrill real-dApp benchmark — 2026-11-03

12/12 dApps scanned, 6 with replayable flows. Final scans cost $16.86; every scan attempt together $26.97.

- **Precision (scans):** 7 real / 10 false of 17 distinct findings (0 unlabeled) → 0.41; 10 of the false ones were engine bugs fixed since
- **Precision (replays on the fixed engine, happy/switch-account/reject/wrong-network):** 4 real / 3 false of 7 distinct findings (0 unlabeled) → 0.57
- **Replay stability:** same status in 17/29 flow × edge-case cells (59%), same findings in 24/29 (83%)
- **Injected bugs:** 8 diagnosed, 8 caught at all, of 10 cases where the bug fired

## Injected bugs

| Bug | Edge case | Cases | Diagnosed | Noticed | Missed | With baseline: diagnosed / noticed / missed |
|---|---|---|---|---|---|---|
| unlimited-approval | happy | 0 | 0 | 0 | 0 | – |
| approval-to-stranger | happy | 0 | 0 | 0 | 0 | – |
| inflated-value | happy | 0 | 0 | 0 | 0 | – |
| signin-is-permit | happy | 2 | 2 | 0 | 0 | 3 / 0 / 0 |
| ignores-account-switch | switch-account | 1 | 1 | 0 | 0 | – |
| stuck-on-reject | reject | 4 | 3 | 0 | 1 | – |
| skips-chain-switch | wrong-network | 3 | 2 | 0 | 1 | – |

## Per dApp

| dApp | Scan min | Cost | All attempts | Flows | Findings (real/false/unlabeled) | Stable cells | Replay min |
|---|---|---|---|---|---|---|---|
| uniswap | 1.7 | $0.95 | $1.99 | 0 | 0/0/0 | – | 0 |
| aave | 1.6 | $0.9 | $1.75 | 0 | 0/0/0 | – | 0 |
| lido | 10 | $2.14 | $3.62 | 2 | 1/5/0 | 4/8 | 18.7 |
| compound | 12.9 | $2.35 | $3.07 | 2 | 5/5/0 | 4/5 | 10.6 |
| cowswap | 1.1 | $0.59 | $0.59 | 0 | 0/0/0 | – | 0 |
| curve | 2.2 | $1.19 | $2.27 | 0 | 0/0/0 | – | 0 |
| spark | 5.9 | $1.32 | $3.2 | 2 | 0/0/0 | – | 0 |
| morpho | 5.9 | $2.94 | $4.22 | 2 | 0/0/0 | – | 0 |
| aerodrome | 1.7 | $0.8 | $2.58 | 0 | 0/0/0 | – | 0 |
| gmx | 1.2 | $0.36 | $0.36 | 0 | 0/0/0 | – | 0 |
| hyperliquid | 2.7 | $1.23 | $1.23 | 1 | 0/0/0 | 4/4 | 7.9 |
| pod | 9.3 | $2.09 | $2.09 | 3 | 1/0/0 | 5/12 | 12.7 |

## Every mutation case

| dApp | Bug | Variant | Flow | Outcome | Why |
|---|---|---|---|---|---|
| lido | inflated-value | first-run | flow_um55hy5ovms8w7 | not-fired | run fail: Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): the dApp sent no signing request within 30s |
| lido | inflated-value | with-baseline | flow_um55hy5ovms8w7 | not-fired | run fail: Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): the dApp sent no signing request within 30s |
| lido | ignores-account-switch | first-run | flow_um55hy5ovms8w7 | not-fired | run skipped: couldn't finish as the second account (Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): the dApp sent no signing request within 30s); no reques |
| lido | stuck-on-reject | first-run | flow_um55hy5ovms8w7 | not-fired | run issue: No message after rejecting 'Stake' |
| lido | skips-chain-switch | first-run | flow_semqwyre6yo5l1 | diagnosed | high wallet: Doesn't handle the wallet being on Sepolia |
| lido | skips-chain-switch | first-run | flow_um55hy5ovms8w7 | diagnosed | high wallet: Doesn't handle the wallet being on Sepolia |
| hyperliquid | ignores-account-switch | first-run | flow_4vfz8erc8r8oxu | diagnosed | critical wallet: After switching accounts, the typed-data signature still comes from the old account |
| hyperliquid | stuck-on-reject | first-run | flow_4vfz8erc8r8oxu | missed | run pass, nothing new vs control |
| pod | signin-is-permit | first-run | flow_1g92i6g1lmwubu | not-fired | run fail: Step 3 (Approve personal_sign): the dApp sent no signing request within 30s |
| pod | signin-is-permit | first-run | flow_h3pywkzicyv69v | diagnosed | dangerous: Permit 0xA0b8…eB48 for 0x5a1E…5A1e |
| pod | signin-is-permit | first-run | flow_saixxhzgu1ot41 | diagnosed | dangerous: Permit 0xA0b8…eB48 for 0x5a1E…5A1e |
| pod | signin-is-permit | with-baseline | flow_1g92i6g1lmwubu | diagnosed | dangerous: Permit 0xA0b8…eB48 for 0x5a1E…5A1e |
| pod | signin-is-permit | with-baseline | flow_h3pywkzicyv69v | diagnosed | dangerous: Permit 0xA0b8…eB48 for 0x5a1E…5A1e |
| pod | signin-is-permit | with-baseline | flow_saixxhzgu1ot41 | diagnosed | dangerous: Permit 0xA0b8…eB48 for 0x5a1E…5A1e |
| pod | ignores-account-switch | first-run | flow_1g92i6g1lmwubu | not-fired | run pass: |
| pod | ignores-account-switch | first-run | flow_h3pywkzicyv69v | not-fired | run pass: |
| pod | ignores-account-switch | first-run | flow_saixxhzgu1ot41 | not-fired | run pass: |
| pod | stuck-on-reject | first-run | flow_1g92i6g1lmwubu | diagnosed | high wallet: Rejecting 'MetaMask →' leaves the button stuck on 'Connecting…' |
| pod | stuck-on-reject | first-run | flow_h3pywkzicyv69v | diagnosed | high wallet: Rejecting 'MetaMask →' leaves the button stuck on 'Enabling trading…' |
| pod | stuck-on-reject | first-run | flow_saixxhzgu1ot41 | diagnosed | medium wallet: No message after rejecting 'MetaMask →' |
| pod | skips-chain-switch | first-run | flow_h3pywkzicyv69v | missed | run issue, nothing new vs control |
