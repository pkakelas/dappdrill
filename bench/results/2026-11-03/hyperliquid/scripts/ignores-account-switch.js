(() => {
  const warn = console.warn.bind(console);
  const fired = (what) => warn("[dappdrill-bench] fired ignores-account-switch: " + what);
  const patched = new WeakSet();
  function patch(provider) {
    if (!provider || patched.has(provider)) return;
    patched.add(provider);
    const request = provider.request.bind(provider);
    let first;
      const wrapped = new Map();
      const on = provider.on.bind(provider);
      const off = provider.removeListener.bind(provider);
      const wrap = (fn) => {
        if (!wrapped.has(fn)) {
          wrapped.set(fn, (accounts) => {
            const a = accounts?.[0]?.toLowerCase();
            if (a && first && a !== first) return fired("accountsChanged dropped");
            if (a) first ??= a;
            fn(accounts);
          });
        }
        return wrapped.get(fn);
      };
      provider.on = provider.addListener = (event, fn) => on(event, event === "accountsChanged" ? wrap(fn) : fn);
      provider.removeListener = provider.off = (event, fn) => off(event, wrapped.get(fn) ?? fn);
      provider.request = async (args) => {
        const result = await request(args);
        const method = args?.method;
        if ((method === "eth_accounts" || method === "eth_requestAccounts") && Array.isArray(result) && result[0]) {
          const a = result[0].toLowerCase();
          first ??= a;
          if (a !== first) {
            fired(method + " answered with the old account");
            return [first, ...result.slice(1)];
          }
        }
        return result;
      };
  }
  patch(window.ethereum);
  for (const p of window.ethereum?.providers ?? []) patch(p);
  window.addEventListener("eip6963:announceProvider", (e) => patch(e.detail?.provider), true);
})();