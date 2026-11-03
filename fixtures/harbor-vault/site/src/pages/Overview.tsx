import { fmt } from '../data'
import { Card, ConnectButton, FaucetButton, Link, useAccount } from '../ui'

export function sharePrice(tvl: bigint | null, supply: bigint | null): string {
  if (tvl === null || !supply) return '–'
  return fmt((tvl * 1_000_000n) / supply, 4)
}

export function Overview() {
  const { account, position, data } = useAccount()

  return (
    <>
      <section className="hero">
        <p className="eyebrow">hUSDC Vault · Anvil Local</p>
        <h1>Earn on idle hUSDC</h1>
        <p className="lede">
          Deposit hUSDC, receive vault shares that grow with the vault's yield, and collect a 5% deposit bonus.
        </p>
      </section>

      <div className="stats">
        <div className="stat">
          <span>Total value locked</span>
          <strong data-testid="tvl">{fmt(data.tvl, 0)} hUSDC</strong>
        </div>
        <div className="stat">
          <span>Share price</span>
          <strong>{sharePrice(data.tvl, data.supply)} hUSDC</strong>
        </div>
        <div className="stat">
          <span>Deposit bonus</span>
          <strong>5%</strong>
        </div>
      </div>

      <Card title="Your position">
        {!account ? (
          <div className="empty">
            <p>Connect a wallet to see your position.</p>
            <ConnectButton />
          </div>
        ) : (
          <>
            <dl className="rows">
              <div>
                <dt>Deposited</dt>
                <dd data-testid="deposited">{fmt(position?.deposited)} hUSDC</dd>
              </div>
              <div>
                <dt>Vault shares</dt>
                <dd>{fmt(position?.shares)} hvUSDC</dd>
              </div>
              <div>
                <dt>Wallet balance</dt>
                <dd data-testid="wallet-balance">{fmt(position?.hUSDC)} hUSDC</dd>
              </div>
              <div>
                <dt>Claimable rewards</dt>
                <dd>{fmt(position?.claimable)} hUSDC</dd>
              </div>
            </dl>
            <div className="actions">
              <Link to="/vault" className="btn primary">
                Deposit
              </Link>
              <Link to="/rewards" className="btn secondary">
                Rewards
              </Link>
              <FaucetButton />
            </div>
          </>
        )}
      </Card>
    </>
  )
}
