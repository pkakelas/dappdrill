(() => {
  const warn = console.warn.bind(console);
  const fired = (what) => warn("[dappdrill-bench] fired inflated-value: " + what);
  const patched = new WeakSet();
  function patch(provider) {
    if (!provider || patched.has(provider)) return;
    patched.add(provider);
    const request = provider.request.bind(provider);
    provider.request = (args) => {
      if (args?.method === "eth_sendTransaction" && args.params?.[0]) {
        const tx = args.params[0];
        const next = ((tx) => {
        if (!tx.value || BigInt(tx.value) === 0n) return;
        fired("value x10");
        return { ...tx, value: "0x" + (BigInt(tx.value) * 10n).toString(16) };
      })(tx);
        if (next) return request({ ...args, params: [next, ...args.params.slice(1)] });
      }
      return request(args);
    };
  }
  patch(window.ethereum);
  for (const p of window.ethereum?.providers ?? []) patch(p);
  window.addEventListener("eip6963:announceProvider", (e) => patch(e.detail?.provider), true);
})();