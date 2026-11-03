import { useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { parseUnits } from 'viem'
import { contracts, erc20Abi } from './config'
import { dataStore, positionOf } from './data'
import { useStore } from './store'
import { errorMessage, sendTx } from './tx'
import { walletStore } from './wallet'

// History routing that keeps the query string (?bugs=…) across pages.
const onPopState = (listener: () => void) => {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}
export const usePath = () => useSyncExternalStore(onPopState, () => location.pathname)

export function navigate(to: string): void {
  history.pushState(null, '', to + location.search)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const path = usePath()
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to + location.search} className={className} aria-current={path === to ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  )
}

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export type Note = { text: string; error?: boolean }

export function NoteLine({ note }: { note: Note | null }) {
  if (!note) return null
  return (
    <p className={note.error ? 'note error' : 'note'} role={note.error ? 'alert' : 'status'}>
      {note.text}
    </p>
  )
}

export const openWalletPicker = () => walletStore.set({ picking: true })

export function ConnectButton({ label = 'Connect wallet' }: { label?: string }) {
  return (
    <button className="btn primary wide" onClick={openWalletPicker}>
      {label}
    </button>
  )
}

/** Parses a user-typed hUSDC amount; null when empty, invalid or zero. */
export function parseAmount(text: string): bigint | null {
  const t = text.trim()
  if (!/^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(t)) return null
  const value = parseUnits(t, 6)
  return value > 0n ? value : null
}

export function AmountInput(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  available: string
  availableLabel: string
  onMax: () => void
  disabled?: boolean
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="amount">
        <input
          id={props.id}
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <span className="unit">hUSDC</span>
      </div>
      <div className="field-foot">
        <span>
          {props.availableLabel}: {props.available} hUSDC
        </span>
        <button type="button" className="link-btn" onClick={props.onMax} disabled={props.disabled}>
          Max
        </button>
      </div>
    </div>
  )
}

export function FaucetButton() {
  const { account } = useStore(walletStore)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)
  if (!account) return null

  async function mint() {
    setBusy(true)
    setNote(null)
    try {
      await sendTx({ address: contracts.hUSDC, abi: erc20Abi, functionName: 'mint', args: [account, 1_000_000_000n] })
      setNote({ text: 'Sent 1,000 test hUSDC to your wallet.' })
    } catch (e) {
      setNote({ text: errorMessage(e), error: true })
    }
    setBusy(false)
  }

  return (
    <div className="faucet">
      <button className="btn secondary" onClick={mint} disabled={busy}>
        {busy ? 'Sending…' : 'Get test hUSDC'}
      </button>
      <NoteLine note={note} />
    </div>
  )
}

/** The connected account and its on-chain position (null while loading or disconnected). */
export function useAccount() {
  const wallet = useStore(walletStore)
  const data = useStore(dataStore)
  return { ...wallet, position: positionOf(data.position, wallet.account), data }
}
