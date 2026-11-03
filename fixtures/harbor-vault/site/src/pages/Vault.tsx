import { useState } from 'react'
import { formatUnits, maxUint256 } from 'viem'
import { bug, contracts, erc20Abi, publicClient, vaultAbi } from '../config'
import { fmt } from '../data'
import { errorMessage, isRejection, sendTx } from '../tx'
import { AmountInput, Card, ConnectButton, FaucetButton, NoteLine, parseAmount, useAccount, type Note } from '../ui'
import { sharePrice } from './Overview'

export function Vault() {
  const { data, position } = useAccount()
  return (
    <>
      <div className="page-head">
        <h1>hUSDC Vault</h1>
        <p className="muted">
          TVL {fmt(data.tvl, 0)} hUSDC · Share price {sharePrice(data.tvl, data.supply)} hUSDC · You have{' '}
          {fmt(position?.deposited)} hUSDC deposited
        </p>
      </div>
      <div className="grid">
        <DepositCard />
        <WithdrawCard />
      </div>
    </>
  )
}

function DepositCard() {
  const { account, position } = useAccount()
  const [amount, setAmount] = useState('')
  const [phase, setPhase] = useState<'idle' | 'approving' | 'depositing'>('idle')
  const [note, setNote] = useState<Note | null>(null)
  const value = parseAmount(amount)
  const needsApproval = value !== null && position !== null && position.allowance < value

  async function approve() {
    if (!value) return
    setPhase('approving')
    setNote(null)
    try {
      // Bug 1: the button says "Approve <amount> hUSDC" but this asks for an unlimited allowance.
      const allowance = bug(1) ? maxUint256 : value
      await sendTx({ address: contracts.hUSDC, abi: erc20Abi, functionName: 'approve', args: [contracts.HarborVault, allowance] })
      setNote({ text: `Approved ${amount} hUSDC. Now confirm the deposit.` })
    } catch (e) {
      setNote({ text: errorMessage(e), error: true })
    }
    setPhase('idle')
  }

  async function deposit() {
    if (!value || !account) return
    if (!bug(7)) setPhase('depositing')
    setNote(null)
    try {
      // Re-check the balance right before sending.
      const balance = await publicClient.readContract({
        address: contracts.hUSDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      })
      // Bug 7: the button only locks after that read, so on a slow RPC a second click
      // starts a second deposit.
      if (bug(7)) setPhase('depositing')
      if (balance < value) throw new Error('Not enough hUSDC in your wallet.')
      await sendTx({ address: contracts.HarborVault, abi: vaultAbi, functionName: 'deposit', args: [value, account] })
      setNote({ text: `Deposited ${amount} hUSDC.` })
      setAmount('')
    } catch (e) {
      // Bug 3: a wallet rejection returns early and leaves the button on "Confirming…".
      if (bug(3) && isRejection(e)) return
      setNote({ text: errorMessage(e), error: true })
    }
    setPhase('idle')
  }

  const tooMuch = value !== null && position !== null && value > position.hUSDC
  const label =
    phase === 'approving'
      ? 'Approving…'
      : phase === 'depositing'
        ? 'Confirming…'
        : !value
          ? 'Enter an amount'
          : tooMuch
            ? 'Not enough hUSDC'
            : needsApproval
              ? `Approve ${amount} hUSDC`
              : `Deposit ${amount} hUSDC`

  return (
    <Card title="Deposit">
      <AmountInput
        id="deposit-amount"
        label="Amount to deposit"
        value={amount}
        onChange={setAmount}
        available={fmt(position?.hUSDC)}
        availableLabel="Wallet"
        onMax={() => position && setAmount(formatUnits(position.hUSDC, 6))}
        disabled={phase !== 'idle'}
      />
      {value !== null && !tooMuch && (
        <ol className="steps">
          <li className={needsApproval ? 'current' : 'done'}>Approve hUSDC</li>
          <li className={needsApproval ? '' : 'current'}>Deposit</li>
        </ol>
      )}
      {!account ? (
        <ConnectButton />
      ) : (
        <button
          className="btn primary wide"
          onClick={needsApproval ? approve : deposit}
          disabled={phase !== 'idle' || !value || !position || tooMuch}
        >
          {label}
        </button>
      )}
      <NoteLine note={note} />
      {account && position?.hUSDC === 0n && (
        <div className="hint">
          <span className="muted">No hUSDC yet?</span>
          <FaucetButton />
        </div>
      )}
    </Card>
  )
}

// Bug 6: treats every failure as a contract revert. Anything else (like not having enough
// ETH for gas) throws here, during render, and React unmounts the whole app.
const revertReason = (e: unknown) =>
  `Reverted: ${(e as { cause: { data: { errorName: string } } }).cause.data.errorName}`

function WithdrawCard() {
  const { account, position } = useAccount()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)
  const [error, setError] = useState<unknown>(null)
  const value = parseAmount(amount)
  const tooMuch = value !== null && position !== null && value > position.deposited

  async function withdraw() {
    if (!value || !account || !position) return
    setBusy(true)
    setNote(null)
    setError(null)
    try {
      // Withdrawing everything redeems all shares so no dust is left behind.
      const call =
        value === position.deposited
          ? ({ functionName: 'redeem', args: [position.shares, account, account] } as const)
          : ({ functionName: 'withdraw', args: [value, account, account] } as const)
      await sendTx({ address: contracts.HarborVault, abi: vaultAbi, ...call })
      setNote({ text: `Withdrew ${amount} hUSDC.` })
      setAmount('')
    } catch (e) {
      if (isRejection(e)) setNote({ text: 'Withdrawal cancelled.' })
      else setError(e)
    }
    setBusy(false)
  }

  return (
    <Card title="Withdraw">
      <AmountInput
        id="withdraw-amount"
        label="Amount to withdraw"
        value={amount}
        onChange={setAmount}
        available={fmt(position?.deposited)}
        availableLabel="Deposited"
        onMax={() => position && setAmount(formatUnits(position.deposited, 6))}
        disabled={busy}
      />
      {!account ? (
        <ConnectButton />
      ) : (
        <button className="btn secondary wide" onClick={withdraw} disabled={busy || !value || !position || tooMuch}>
          {busy ? 'Withdrawing…' : tooMuch ? 'More than you deposited' : 'Withdraw'}
        </button>
      )}
      <NoteLine note={note} />
      {error !== null && (
        <p className="note error" role="alert">
          {bug(6) ? revertReason(error) : errorMessage(error)}
        </p>
      )}
    </Card>
  )
}
