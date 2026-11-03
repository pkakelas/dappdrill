// Deploys Harbor Vault to the local anvil on :8545 with deterministic addresses:
// everything is deployed by anvil account 0 starting at nonce 0.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  getContractAddress,
  http,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'

export const RPC_URL = 'http://127.0.0.1:8545'
export const ROOT = join(import.meta.dirname, '..')

// Well-known anvil dev keys (mnemonic "test test ... junk").
export const ANVIL_KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // account 0
  depositorA: '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97', // account 8
  depositorB: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6', // account 9
} as const satisfies Record<string, Hex>

const deployer = privateKeyToAccount(ANVIL_KEYS.deployer)
const at = (nonce: number) => getContractAddress({ from: deployer.address, nonce: BigInt(nonce) })

export const addresses = {
  hUSDC: at(0),
  HarborVault: at(1),
  RewardsDistributor: at(2),
  Helper: at(3),
} satisfies Record<string, Address>

const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) })

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(join(ROOT, 'out', `${name}.sol`, `${name}.json`), 'utf8'))
  return { abi: json.abi, bytecode: json.bytecode.object }
}

export async function isDeployed(): Promise<boolean> {
  const code = await publicClient.getCode({ address: addresses.Helper })
  return code !== undefined && code !== '0x'
}

export async function deploy(): Promise<void> {
  const nonce = await publicClient.getTransactionCount({ address: deployer.address })
  if (nonce !== 0) {
    throw new Error(`Deployer ${deployer.address} already has nonce ${nonce} on ${RPC_URL}; restart anvil (pnpm stop).`)
  }

  const targets = { HUSDC: addresses.hUSDC, HarborVault: addresses.HarborVault }
  const send = async (key: Hex, name: keyof typeof targets, functionName: string, args: unknown[]) => {
    const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: anvil, transport: http(RPC_URL) })
    const hash = await wallet.writeContract({ address: targets[name], abi: artifact(name).abi, functionName, args })
    await publicClient.waitForTransactionReceipt({ hash })
  }

  const wallet = createWalletClient({ account: deployer, chain: anvil, transport: http(RPC_URL) })
  const create = async (name: string, args: unknown[] = []) => {
    const { abi, bytecode } = artifact(name)
    const hash = await wallet.deployContract({ abi, bytecode, args })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    return receipt.contractAddress!
  }

  await create('HUSDC')
  await create('HarborVault', [addresses.hUSDC])
  await create('RewardsDistributor', [addresses.hUSDC, addresses.HarborVault])
  await create('Helper')

  const usdc = (n: number) => parseUnits(String(n), 6)
  // Fund the rewards pool, seed TVL from two other accounts, then add some yield.
  await send(ANVIL_KEYS.deployer, 'HUSDC', 'mint', [addresses.RewardsDistributor, usdc(100_000)])
  for (const [key, amount] of [[ANVIL_KEYS.depositorA, 64_000], [ANVIL_KEYS.depositorB, 36_500]] as const) {
    const from = privateKeyToAccount(key).address
    await send(key, 'HUSDC', 'mint', [from, usdc(amount)])
    await send(key, 'HUSDC', 'approve', [addresses.HarborVault, usdc(amount)])
    await send(key, 'HarborVault', 'deposit', [usdc(amount), from])
  }
  await send(ANVIL_KEYS.deployer, 'HUSDC', 'mint', [addresses.HarborVault, usdc(1_842.5)])
}

export function writeDeployments(): void {
  const deployments = { chainId: anvil.id, rpcUrl: RPC_URL, deployer: deployer.address, contracts: addresses }
  writeFileSync(join(ROOT, 'site', 'public', 'deployments.json'), JSON.stringify(deployments, null, 2) + '\n')
}
