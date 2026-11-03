import { formatUnits, type Address } from 'viem'
import { contracts, erc20Abi, publicClient, rewardsAbi, vaultAbi } from './config'
import { createStore } from './store'
import { walletStore } from './wallet'

export type Position = {
  account: Address
  eth: bigint
  hUSDC: bigint
  shares: bigint
  deposited: bigint // shares valued in hUSDC
  allowance: bigint // hUSDC approved to the vault
  claimable: bigint
}

export const dataStore = createStore({
  tvl: null as bigint | null,
  supply: null as bigint | null,
  position: null as Position | null,
  offline: false,
})

async function readPosition(account: Address): Promise<Position> {
  const token = { address: contracts.hUSDC, abi: erc20Abi } as const
  const vault = { address: contracts.HarborVault, abi: vaultAbi } as const
  const [eth, hUSDC, shares, allowance, claimable] = await Promise.all([
    publicClient.getBalance({ address: account }),
    publicClient.readContract({ ...token, functionName: 'balanceOf', args: [account] }),
    publicClient.readContract({ ...vault, functionName: 'balanceOf', args: [account] }),
    publicClient.readContract({ ...token, functionName: 'allowance', args: [account, contracts.HarborVault] }),
    publicClient.readContract({
      address: contracts.RewardsDistributor,
      abi: rewardsAbi,
      functionName: 'claimable',
      args: [account],
    }),
  ])
  const deposited = await publicClient.readContract({ ...vault, functionName: 'convertToAssets', args: [shares] })
  return { account, eth, hUSDC, shares, deposited, allowance, claimable }
}

export async function refresh(): Promise<void> {
  const { account } = walletStore.get()
  try {
    const vault = { address: contracts.HarborVault, abi: vaultAbi } as const
    const [tvl, supply, position] = await Promise.all([
      publicClient.readContract({ ...vault, functionName: 'totalAssets' }),
      publicClient.readContract({ ...vault, functionName: 'totalSupply' }),
      account ? readPosition(account) : null,
    ])
    dataStore.set({ tvl, supply, position, offline: false })
  } catch (e) {
    console.warn('Could not read from the network', e)
    dataStore.set({ offline: true })
  }
}

export function startPolling(): void {
  void refresh()
  setInterval(refresh, 4000)
  let account = walletStore.get().account
  walletStore.subscribe(() => {
    if (walletStore.get().account === account) return
    account = walletStore.get().account
    void refresh()
  })
}

/** Position of the connected account, or null while it is loading. */
export function positionOf(position: Position | null, account: Address | null): Position | null {
  return position && position.account === account ? position : null
}

export function fmt(value: bigint | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '–'
  return Number(formatUnits(value, 6)).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
