import { createPublicClient, defineChain, http, parseAbi, type Address } from 'viem'

export const RPC_URL = 'http://127.0.0.1:8545'
export const CHAIN = defineChain({
  id: 31337,
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})

// The page makes its own reads straight to the node, separate from the wallet.
export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) })

export type Contracts = { hUSDC: Address; HarborVault: Address; RewardsDistributor: Address; Helper: Address }
export let contracts: Contracts

export async function loadDeployments(): Promise<void> {
  const res = await fetch('/deployments.json')
  contracts = (await res.json()).contracts
}

// Seeded bugs (see seeded-bugs.json). All on by default; ?bugs=none turns them off,
// ?bugs=1,4 turns on only those.
const param = new URLSearchParams(location.search).get('bugs')
const enabled = new Set(
  param === null || param === 'all' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : param === 'none' ? [] : param.split(',').map(Number),
)
export const bug = (id: number): boolean => enabled.has(id)

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function mint(address to, uint256 amount)',
])

export const vaultAbi = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
])

export const rewardsAbi = parseAbi([
  'function claimable(address user) view returns (uint256)',
  'function claim() returns (uint256)',
])
