import { useState, type ReactNode } from 'react'
import { bug, CHAIN } from './config'
import { fmt, short } from './data'
import { Overview } from './pages/Overview'
import { Rewards } from './pages/Rewards'
import { chainName, Settings } from './pages/Settings'
import { Vault } from './pages/Vault'
import { useStore } from './store'
import { errorMessage } from './tx'
import { Link, NoteLine, openWalletPicker, useAccount, usePath, type Note } from './ui'
import { connect, offeredWallets, signIn, switchChain, walletStore, type Wallet } from './wallet'

const PAGES: Record<string, () => ReactNode> = { '/': Overview, '/vault': Vault, '/rewards': Rewards, '/settings': Settings }
const NAV = [
  ['/', 'Overview'],
  ['/vault', 'Vault'],
  ['/rewards', 'Rewards'],
  ['/settings', 'Settings'],
] as const

export function App() {
  const Page = PAGES[usePath()] ?? NotFound
  const { picking } = useStore(walletStore)
  return (
    <>
      <Header />
      <Banners />
      <main className="container">
        <Page />
      </main>
      <footer className="container footer">Harbor Vault · test deployment on Anvil Local (chain {CHAIN.id})</footer>
      {picking && <ConnectModal />}
    </>
  )
}

function Header() {
  const { account, chainId, signedIn, position } = useAccount()
  const [signingIn, setSigningIn] = useState(false)
  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          Harbor Vault
        </Link>
        <nav className="nav">
          {NAV.map(([to, label]) => (
            <Link key={to} to={to}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-right">
          {account ? (
            <>
              <span className="chip" title="Network" data-testid="network">
                <span className={chainId === CHAIN.id ? 'dot' : 'dot off'} />
                {chainName(chainId)}
              </span>
              {signedIn ? (
                <span className="chip">Signed in</span>
              ) : (
                <button className="btn ghost" onClick={() => setSigningIn(true)}>
                  Sign in
                </button>
              )}
              <Link to="/settings" className="chip account">
                <span data-testid="header-balance">{fmt(position?.hUSDC)} hUSDC</span>
                <span className="mono" data-testid="header-address">
                  {short(account)}
                </span>
              </Link>
            </>
          ) : (
            <button className="btn primary" onClick={openWalletPicker}>
              Connect wallet
            </button>
          )}
        </div>
      </div>
      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
    </header>
  )
}

function Banners() {
  const { account, chainId, data } = useAccount()
  const [note, setNote] = useState<Note | null>(null)
  const wrongChain = account && chainId !== CHAIN.id && !bug(4)
  return (
    <>
      {wrongChain && (
        <div className="banner warn" role="alert">
          <div className="container banner-inner">
            <span>
              Harbor Vault runs on Anvil Local ({CHAIN.id}). Your wallet is on {chainName(chainId)}.
            </span>
            <button
              className="btn primary small"
              onClick={() => switchChain().catch((e) => setNote({ text: errorMessage(e), error: true }))}
            >
              Switch network
            </button>
            <NoteLine note={note} />
          </div>
        </div>
      )}
      {data.offline && (
        <div className="banner" role="status">
          <div className="container banner-inner">Can't reach the network. Retrying…</div>
        </div>
      )}
    </>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ConnectModal() {
  const { wallets } = useStore(walletStore)
  const offered = offeredWallets(wallets)
  const [pending, setPending] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const close = () => walletStore.set({ picking: false })

  async function pick(wallet: Wallet) {
    setPending(wallet.id)
    setNote(null)
    try {
      await connect(wallet)
    } catch (e) {
      setNote({ text: errorMessage(e), error: true })
    }
    setPending(null)
  }

  return (
    <Modal title="Connect a wallet" onClose={close}>
      {offered.length === 0 ? (
        <p className="muted">No wallet found. Install a browser wallet and reload the page.</p>
      ) : (
        <ul className="wallets">
          {offered.map((wallet) => (
            <li key={wallet.id}>
              <button className="wallet" onClick={() => pick(wallet)} disabled={pending !== null}>
                {wallet.icon ? <img src={wallet.icon} alt="" width={28} height={28} /> : <span className="wallet-icon" />}
                <span>{wallet.name}</span>
                {pending === wallet.id && <span className="muted">Waiting for wallet…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <NoteLine note={note} />
    </Modal>
  )
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  async function submit() {
    setBusy(true)
    setNote(null)
    try {
      await signIn()
      onClose()
    } catch (e) {
      setNote({ text: errorMessage(e), error: true })
      setBusy(false)
    }
  }

  return (
    <Modal title="Sign in to Harbor Vault" onClose={onClose}>
      <p className="muted">
        Sign a message to confirm you own this wallet. Signing is free and doesn't send a transaction.
      </p>
      <div className="actions">
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Check your wallet…' : 'Sign message'}
        </button>
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
      <NoteLine note={note} />
    </Modal>
  )
}

function NotFound() {
  return (
    <div className="page-head">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the overview</Link>
      </p>
    </div>
  )
}
