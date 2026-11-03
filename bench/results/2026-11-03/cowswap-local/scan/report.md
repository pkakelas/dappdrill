# DappDrill scan

**Nothing tested: no flows were found or run.**

http://127.0.0.1:4102/#/1/swap/USDC/WETH · 0 flows · 0 runs · 2m 06s · $0.82

The app's data didn't load, so there was nothing to test. Reads on test chain 1 failed (7 failed reads, e.g. "23 The operation was aborted due to timeout"). The page was waiting on events.launchdarkly.com (4 failed), app.launchdarkly.com (2 failed), secure.adnxs.com (2 failed), 127.0.0.1:9 (2 failed), region1.analytics.google.com (1 never answered). Backends like these read the real chain, not the fork, unless the app points them elsewhere. How to fix it: https://dappdrill.com/fork
