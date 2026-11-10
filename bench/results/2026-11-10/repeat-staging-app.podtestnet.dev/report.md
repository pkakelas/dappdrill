# staging-app.podtestnet.dev: 4 runs of the same suite

| Test | Run 1 | Run 2 | Run 3 | Run 4 | Passed | On the model | Cost |
|---|---|---|---|---|---|---|---|
| Withdraw $20 to connected wallet | ✓ | ✓ | ✓ | ✓ | 4/4 | 4 2 2 1 | $2.71 |
| Withdraw more than available | ✓ | ✓ | ✓ | ✓ | 4/4 | 0 0 0 0 | $0.13 |
| Limit order over the leverage limit is blocked | ✗ | ✓ | ✓ | ✓ | 3/4 flips | 1 0 0 0 | $0.43 |
| Cancel a resting limit order | ✓ | ✓ | ✓ | ✓ | 4/4 | 0 0 0 0 | $0.19 |
| Open a market long on AAPL and close it | ✓ | ✓ | ✓ | ✗ | 3/4 flips | 0 0 0 1 | $0.50 |
| Deposit minimum is enforced | ✓ | ✓ | ✓ | ✓ | 4/4 | 1 1 0 0 | $0.60 |
| Resting limit order shows on Home | ✓ | ✓ | ✓ | ✓ | 4/4 | 1 0 0 0 | $0.47 |
| Filter Explore to Spot and open a spot market | ✓ | ✓ | ✓ | ✓ | 4/4 | 0 0 0 0 | $0.24 |

| Run | Passed | On the model | Cost | Time | Setup |
|---|---|---|---|---|---|
| 1 | 7/8 | 7 | $2.38 | 9.8 min | 187 s (reset 4/5) |
| 2 | 8/8 | 3 | $1.11 | 8.0 min | 127 s (reset 5/5) |
| 3 | 8/8 | 2 | $0.85 | 8.1 min | 169 s (reset 5/5) |
| 4 | 7/8 | 2 | $0.92 | 7.9 min | 111 s (reset 5/5) |

2 of 8 tests changed outcome between runs.

## Why tests didn't pass

- Limit order over the leverage limit is blocked: Step 5, “Check the over-limit message shows”: With 1000000 USD at limit 300, the app shows "Insufficient margin for this size" (and Margin $49,813.70→-$186.30), not "Over your 5x limit". The Long AAPL/USD button is disab (run 1)
- Open a market long on AAPL and close it: The expected result didn't show: The Orders tab isn't open, so no Filled AAPL buy is visible. Holdings lists only Google, but this is the same view that was stale at step 5 and could be stale again, so it doesn't prove t (run 4)
