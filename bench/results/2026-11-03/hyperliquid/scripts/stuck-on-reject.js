(() => {
  const warn = console.warn.bind(console);
  const fired = (what) => warn("[dappdrill-bench] fired stuck-on-reject: " + what);
  const patched = new WeakSet();
  function patch(provider) {
    if (!provider || patched.has(provider)) return;
    patched.add(provider);
    const request = provider.request.bind(provider);
    provider.request = (args) =>
        request(args).catch((e) => {
          if (e?.code !== 4001) throw e;
          fired("rejection swallowed");
          return new Promise(() => {});
        });
  }
  patch(window.ethereum);
  for (const p of window.ethereum?.providers ?? []) patch(p);
  window.addEventListener("eip6963:announceProvider", (e) => patch(e.detail?.provider), true);
})();