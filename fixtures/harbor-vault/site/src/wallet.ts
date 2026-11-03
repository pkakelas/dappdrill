import { createWalletClient, custom, maxUint256, toHex, type Address, type EIP1193Provider } from 'viem'
import { bug, CHAIN, contracts, erc20Abi, publicClient, RPC_URL } from './config'
import { createStore } from './store'

export type Wallet = { id: string; name: string; icon?: string; rdns: string; provider: EIP1193Provider }

type EIP6963Detail = { info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider }

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export const walletStore = createStore({
  wallets: [] as Wallet[], // announced via EIP-6963
  name: null as string | null, // wallet the user picked
  account: null as Address | null,
  chainId: null as number | null,
  signedIn: false,
  picking: false, // connect modal open
})

const LAST_WALLET = 'harbor.wallet'
let provider: EIP1193Provider | null = null

export function discoverWallets(): void {
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = (event as CustomEvent<EIP6963Detail>).detail
    const { wallets } = walletStore.get()
    if (wallets.some((w) => w.id === info.uuid)) return
    const wallet = { id: info.uuid, name: info.name, icon: info.icon, rdns: info.rdns, provider }
    walletStore.set({ wallets: [...wallets, wallet] })
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/** Wallets to offer: EIP-6963 announcements, else a legacy window.ethereum. */
export function offeredWallets(wallets: Wallet[]): Wallet[] {
  if (wallets.length || !window.ethereum) return wallets
  return [{ id: 'injected', name: 'Browser wallet', rdns: 'injected', provider: window.ethereum }]
}

// Bug 9: always talks to window.ethereum, whichever wallet the user picked.
const providerFor = (wallet: Wallet) => (bug(9) && window.ethereum ? window.ethereum : wallet.provider)

export async function connect(wallet: Wallet): Promise<void> {
  const p = providerFor(wallet)
  const [account] = await p.request({ method: 'eth_requestAccounts' })
  if (account) await activate(wallet, p, account)
}

/** Restores the last connection after a reload, without prompting. */
export async function reconnect(): Promise<void> {
  const rdns = localStorage.getItem(LAST_WALLET)
  const wallet = offeredWallets(walletStore.get().wallets).find((w) => w.rdns === rdns)
  if (!wallet) return
  const p = providerFor(wallet)
  const [account] = await p.request({ method: 'eth_accounts' })
  if (account) await activate(wallet, p, account)
}

async function activate(wallet: Wallet, p: EIP1193Provider, account: Address): Promise<void> {
  const chainId = Number(await p.request({ method: 'eth_chainId' }))
  unlisten()
  provider = p
  // Bug 5: never listens for account switches, so the header and the next tx keep the old account.
  if (!bug(5)) p.on('accountsChanged', onAccountsChanged)
  p.on('chainChanged', onChainChanged)
  localStorage.setItem(LAST_WALLET, wallet.rdns)
  walletStore.set({ name: wallet.name, account, chainId, signedIn: false, picking: false })
}

export function disconnect(): void {
  unlisten()
  provider = null
  localStorage.removeItem(LAST_WALLET)
  walletStore.set({ name: null, account: null, chainId: null, signedIn: false })
}

function unlisten(): void {
  provider?.removeListener('accountsChanged', onAccountsChanged)
  provider?.removeListener('chainChanged', onChainChanged)
}

function onAccountsChanged(accounts: Address[]): void {
  if (accounts[0]) walletStore.set({ account: accounts[0], signedIn: false })
  else disconnect()
}

function onChainChanged(chainId: string): void {
  walletStore.set({ chainId: Number(chainId) })
}

export function walletClient() {
  const { account } = walletStore.get()
  if (!provider || !account) throw new Error('Connect a wallet first')
  return createWalletClient({ account, chain: CHAIN, transport: custom(provider) })
}

/** Asks the wallet to switch to the local chain, adding it first if the wallet doesn't know it. */
export async function switchChain(): Promise<void> {
  if (!provider) return
  const chainId = toHex(CHAIN.id)
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId, chainName: 'Anvil Local', nativeCurrency: CHAIN.nativeCurrency, rpcUrls: [RPC_URL] }],
    })
  }
  walletStore.set({ chainId: Number(await provider.request({ method: 'eth_chainId' })) })
}

export async function signIn(): Promise<void> {
  const client = walletClient()
  const account = client.account.address
  if (bug(8)) {
    // Bug 8: "Sign in" actually asks for an unlimited hUSDC permit to the Helper contract.
    const nonce = await publicClient.readContract({
      address: contracts.hUSDC,
      abi: erc20Abi,
      functionName: 'nonces',
      args: [account],
    })
    await client.signTypedData({
      domain: { name: 'Harbor USD', version: '1', chainId: CHAIN.id, verifyingContract: contracts.hUSDC },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: account,
        spender: contracts.Helper,
        value: maxUint256,
        nonce,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 86400),
      },
    })
  } else {
    const message = [
      `${location.host} wants you to sign in with your Ethereum account:`,
      account,
      '',
      'Sign in to Harbor Vault',
      '',
      `URI: ${location.origin}`,
      'Version: 1',
      `Chain ID: ${CHAIN.id}`,
      `Nonce: ${crypto.randomUUID().replaceAll('-', '')}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join('\n')
    await client.signMessage({ message })
  }
  walletStore.set({ signedIn: true })
}
