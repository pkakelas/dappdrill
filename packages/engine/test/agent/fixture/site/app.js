// Tiny dApp used by the agent tests. Talks to window.ethereum like a real app would.
(function () {
  const VAULT = "0x1111111111111111111111111111111111111111";
  const USDC = "0x2222222222222222222222222222222222222222";
  const $ = (id) => document.getElementById(id);
  let account = sessionStorage.getItem("account");

  function render() {
    if (account) {
      $("connect").hidden = true;
      $("account").hidden = false;
      $("account").textContent = `Connected: ${account.slice(0, 6)}…${account.slice(-4)}`;
      if ($("vault")) $("vault").hidden = false;
    }
  }

  function setStatus(text) {
    if ($("status")) $("status").textContent = text;
  }

  // Minimal ABI encoding, enough for the engine to decode these calls.
  const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
  const toUnits = (amount) => BigInt(Math.round(Number(amount) * 1e6));
  const encode = (selector, ...words) => selector + words.map(pad).join("");
  const SEL = { approve: "0x095ea7b3", deposit: "0xb6b55f25", withdraw: "0x2e1a7d4d", claim: "0x4e71d92d" };

  async function send(to, data) {
    return window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: account, to, data, value: "0x0" }] });
  }

  async function connect(walletId) {
    if (walletId !== "metamask") {
      setStatus("WalletConnect is not available in this demo");
      return;
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    account = accounts[0];
    sessionStorage.setItem("account", account);
    $("picker").hidden = true;
    render();
  }

  $("connect").addEventListener("click", () => ($("picker").hidden = false));
  $("picker-close").addEventListener("click", () => ($("picker").hidden = true));
  for (const b of document.querySelectorAll("[data-wallet]")) {
    b.addEventListener("click", () => connect(b.dataset.wallet).catch((e) => setStatus(`Error: ${e.message}`)));
  }

  if ($("deposit")) {
    $("deposit").addEventListener("click", async () => {
      const amount = $("amount").value.trim();
      if (!amount || Number(amount) <= 0) return setStatus("Enter an amount");
      try {
        setStatus("Approving…");
        await send(USDC, encode(SEL.approve, VAULT, toUnits(amount).toString(16)));
        setStatus("Depositing…");
        await send(VAULT, encode(SEL.deposit, toUnits(amount).toString(16)));
        $("deposited").textContent = Number(amount).toFixed(2);
        setStatus(`Deposited ${amount} USDC`);
      } catch (e) {
        setStatus(`Deposit failed: ${e.message}`);
      }
    });
    $("withdraw").addEventListener("click", async () => {
      const amount = $("amount").value.trim();
      if (!amount || Number(amount) <= 0) return setStatus("Enter an amount");
      try {
        await send(VAULT, encode(SEL.withdraw, toUnits(amount).toString(16)));
        setStatus(`Withdrew ${amount} USDC`);
      } catch (e) {
        setStatus(`Withdraw failed: ${e.message}`);
      }
    });
    $("claim").addEventListener("click", async () => {
      try {
        await send(VAULT, SEL.claim);
        $("rewards").textContent = "0.00";
        setStatus("Rewards claimed");
      } catch (e) {
        setStatus(`Claim failed: ${e.message}`);
      }
    });
    $("signin").addEventListener("click", async () => {
      try {
        const msg = "Sign in to Tiny Vault\nNonce: 42";
        const hex = "0x" + Array.from(new TextEncoder().encode(msg)).map((b) => b.toString(16).padStart(2, "0")).join("");
        await window.ethereum.request({ method: "personal_sign", params: [hex, account] });
        setStatus("Signed in");
      } catch (e) {
        setStatus(`Sign in failed: ${e.message}`);
      }
    });
  }

  render();
})();
