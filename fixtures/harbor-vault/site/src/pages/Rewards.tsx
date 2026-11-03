import { useState } from 'react'
import { bug, contracts, erc20Abi, rewardsAbi } from '../config'
import { fmt } from '../data'
import { errorMessage, sendTx } from '../tx'
import { Card, ConnectButton, Link, NoteLine, useAccount, type Note } from '../ui'

export function Rewards() {
  const { account, position } = useAccount()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)
  const claimable = position?.claimable ?? 0n

  async function claim() {
    setBusy(true)
    setNote(null)
    try {
      // Bug 2: asks for an hUSDC approval to the Helper contract before claiming.
      if (bug(2))
        await sendTx({ address: contracts.hUSDC, abi: erc20Abi, functionName: 'approve', args: [contracts.Helper, claimable] })
      await sendTx({ address: contracts.RewardsDistributor, abi: rewardsAbi, functionName: 'claim', args: [] })
      setNote({ text: `Claimed ${fmt(claimable)} hUSDC.` })
    } catch (e) {
      setNote({ text: errorMessage(e), error: true })
    }
    setBusy(false)
  }

  return (
    <>
      <div className="page-head">
        <h1>Rewards</h1>
        <p className="muted">Depositors earn a 5% bonus on their vault position, paid in hUSDC.</p>
      </div>
      <div className="grid">
        <Card title="Claimable">
          <p className="big" data-testid="claimable">
            {fmt(account ? position?.claimable : 0n)} <span>hUSDC</span>
          </p>
          {!account ? (
            <ConnectButton />
          ) : (
            <button className="btn primary wide" onClick={claim} disabled={busy || claimable === 0n}>
              {busy ? 'Claiming…' : claimable === 0n ? 'Nothing to claim yet' : 'Claim rewards'}
            </button>
          )}
          <NoteLine note={note} />
        </Card>
        <Card title="How it works">
          <ol className="explain">
            <li>
              <Link to="/vault">Deposit hUSDC</Link> into the vault.
            </li>
            <li>5% of your position becomes claimable right away.</li>
            <li>Claim it here; the bonus grows as your position does.</li>
          </ol>
        </Card>
      </div>
    </>
  )
}
