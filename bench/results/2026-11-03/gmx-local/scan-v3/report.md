# DappDrill scan

**Nothing tested: no flows were found or run.**

http://127.0.0.1:4103/#/trade · 0 flows · 0 runs · 1m 23s · $0.83

The app's data didn't load, so there was nothing to test. The test chain 42161 was rate-limited by the RPC it forks from (300 failed reads). Fork from a dedicated RPC. The page was waiting on secure.adnxs.com (2 failed), gmx.squids.live (1 never answered). Backends like these read the real chain, not the fork, unless the app points them elsewhere. How to fix it: https://dappdrill.com/fork
