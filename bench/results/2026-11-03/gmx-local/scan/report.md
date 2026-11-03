# DappDrill scan

**Nothing tested: no flows were found or run.**

http://127.0.0.1:4103/#/trade · 0 flows · 0 runs · 1m 11s · $0.81

The app's data didn't load, so there was nothing to test. The RPC that chain 42161 forks from no longer serves the forked block's state (416 failed reads). Fork from an archive node. The page was waiting on arbitrum-api-fallback.gmxinfra2.io (1 never answered). Backends like these read the real chain, not the fork, unless the app points them elsewhere. How to fix it: https://dappdrill.com/fork
