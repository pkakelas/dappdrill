(() => {
  const warn = console.warn.bind(console);
  const fired = (what) => warn("[dappdrill-bench] fired skips-chain-switch: " + what);
  const patched = new WeakSet();
  function patch(provider) {
    if (!provider || patched.has(provider)) return;
    patched.add(provider);
    const request = provider.request.bind(provider);
    provider.request = (args) => {
        if (args?.method === "wallet_switchEthereumChain" || args?.method === "wallet_addEthereumChain") {
          fired(args.method + " ignored");
          return Promise.resolve(null);
        }
        return request(args);
      };
  }
  patch(window.ethereum);
  for (const p of window.ethereum?.providers ?? []) patch(p);
  window.addEventListener("eip6963:announceProvider", (e) => patch(e.detail?.provider), true);
})();