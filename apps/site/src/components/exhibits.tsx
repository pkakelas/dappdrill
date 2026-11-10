import type { ReactNode } from "react";
import { Logo } from "./logo";

/*
 * Harbor Vault, the example dApp in fixtures/harbor-vault, and the test wallet's popup (styles in app/exhibit.css).
 * The app pictures show them inside a browser frame.
 */

type VaultState = "idle" | "wallet" | "stuck";

/** The dApp under test. `wallet` and `stuck` are the Deposit button waiting. */
export function HarborVault({ state, children }: { state: VaultState; children?: ReactNode }) {
  return (
    <div className="hv">
      <div className="hv-head">
        <div className="hv-brand">
          <i />
          <b>Harbor Vault</b>
        </div>
        <div className="hv-nav">
          <span className="on">Vault</span>
          <span>Rewards</span>
          <span>Activity</span>
        </div>
        <div className="hv-acct">
          <i />
          <span>0x7a3F…41e1</span>
        </div>
      </div>
      <div className="hv-main">
        <div className="hv-col">
          <div className="hv-card">
            <div className="hv-tabs">
              <span className="on">Deposit</span>
              <span>Withdraw</span>
            </div>
            <span className="hv-label">Amount</span>
            <div className="hv-input">
              <b>250</b>
              <span>hUSDC</span>
            </div>
            <div className="hv-row">
              <span>Balance 1,000 hUSDC</span>
              <span className="hv-link">Get test hUSDC</span>
            </div>
            {state === "wallet" || state === "stuck" ? (
              <div className="hv-btn wait">
                <i className="spin" />
                {state === "wallet" ? "Confirm in wallet…" : "Confirming…"}
              </div>
            ) : (
              <div className="hv-btn">Deposit</div>
            )}
            <span className="hv-note">You receive about 242.43 hvUSDC</span>
          </div>
          <div className="hv-card hv-split">
            <div>
              <b>12.50 hUSDC to claim</b>
              <small>5% bonus on every deposit</small>
            </div>
            <div className="hv-btn quiet">Claim rewards</div>
          </div>
        </div>
        <div className="hv-col">
          <div className="hv-card">
            <span className="hv-h">hUSDC Vault</span>
            <span className="hv-sub">Deposit hUSDC and earn yield. Withdraw any time.</span>
            <div className="hv-stats">
              <div>
                <small>TVL</small>
                <b>102,418</b>
              </div>
              <div>
                <small>APY</small>
                <b>4.8%</b>
              </div>
              <div>
                <small>Share price</small>
                <b>1.0312</b>
              </div>
            </div>
          </div>
          <div className="hv-card hv-pos">
            <small>Your position</small>
            <b>0.00 hvUSDC</b>
            <small>worth 0.00 hUSDC</small>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

export function Wallet({ rejected }: { rejected?: boolean }) {
  return (
    <div className="wl">
      <div className="wl-head">
        <Logo />
        <b>Test wallet</b>
        <span>0x7a3F…41e1</span>
      </div>
      <span className="wl-kicker">Deposit</span>
      <span className="wl-amount">250 hUSDC</span>
      <div className="wl-rows">
        <div>
          <span>To</span>
          <span>HarborVault 0xe7f1…0512</span>
        </div>
        <div>
          <span>Network</span>
          <span>Ethereum (fork)</span>
        </div>
      </div>
      <div className="wl-btns">
        <span className={rejected ? "hit" : undefined}>Reject</span>
        <span className="go">Confirm</span>
      </div>
      {rejected && <span className="wl-code">4001 · user rejected the request</span>}
    </div>
  );
}
