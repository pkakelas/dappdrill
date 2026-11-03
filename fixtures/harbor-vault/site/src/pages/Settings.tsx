import { useState } from 'react'
import { maxUint256 } from 'viem'
import { bug, CHAIN, contracts, erc20Abi, RPC_URL } from '../config'
import { fmt } from '../data'
import { errorMessage, sendTx } from '../tx'
import { Card, ConnectButton, NoteLine, useAccount, type Note } from '../ui'
import { disconnect, switchChain } from '../wallet'

export const chainName = (id: number | null) =>
  id === CHAIN.id ? 'Anvil Local' : id === 1 ? 'Ethereum' : id === 8453 ? 'Base' : `Chain ${id}`

export function Settings() {
  const { account, name, chainId, position } = useAccount()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    setNote(null)
    try {
      await action()
      setNote({ text: done })
    } catch (e) {
      setNote({ text: errorMessage(e), error: true })
    }
    setBusy(false)
  }
  const revoke = () =>
    sendTx({ address: contracts.hUSDC, abi: erc20Abi, functionName: 'approve', args: [contracts.HarborVault, 0n] })

  const allowance = position?.allowance
  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <div className="stack">
        <Card title="Wallet">
          {!account ? (
            <div className="empty">
              <p>No wallet connected.</p>
              <ConnectButton />
            </div>
          ) : (
            <>
              <dl className="rows">
                <div>
                  <dt>Wallet</dt>
                  <dd>{name}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd className="mono">{account}</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>
                    {chainName(chainId)} ({chainId})
                  </dd>
                </div>
                <div>
                  <dt>ETH for gas</dt>
                  <dd>{position ? Number(position.eth / 10n ** 14n) / 1e4 : '–'} ETH</dd>
                </div>
              </dl>
              <div className="actions">
                {!bug(4) && chainId !== CHAIN.id && (
                  <button className="btn primary" disabled={busy} onClick={() => run(switchChain, 'Switched to Anvil Local.')}>
                    Switch to Anvil Local
                  </button>
                )}
                <button className="btn secondary" onClick={disconnect}>
                  Disconnect
                </button>
              </div>
            </>
          )}
        </Card>

        {account && (
          <Card title="Approvals">
            <dl className="rows">
              <div>
                <dt>hUSDC the vault can spend</dt>
                <dd>{allowance === undefined ? '–' : allowance === maxUint256 ? 'Unlimited' : `${fmt(allowance)} hUSDC`}</dd>
              </div>
            </dl>
            <div className="actions">
              <button className="btn secondary" disabled={busy || !allowance} onClick={() => run(revoke, 'Approval revoked.')}>
                Revoke approval
              </button>
            </div>
          </Card>
        )}
        <NoteLine note={note} />

        <Card title="Network">
          <dl className="rows">
            <div>
              <dt>Chain</dt>
              <dd>Anvil Local ({CHAIN.id})</dd>
            </div>
            <div>
              <dt>RPC</dt>
              <dd className="mono">{RPC_URL}</dd>
            </div>
            <div>
              <dt>hUSDC</dt>
              <dd className="mono">{contracts.hUSDC}</dd>
            </div>
            <div>
              <dt>Vault</dt>
              <dd className="mono">{contracts.HarborVault}</dd>
            </div>
            <div>
              <dt>Rewards</dt>
              <dd className="mono">{contracts.RewardsDistributor}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  )
}
