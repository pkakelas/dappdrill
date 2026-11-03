import { BaseError, encodeFunctionData, InsufficientFundsError, type Abi, type Address } from 'viem'
import { bug, CHAIN, publicClient } from './config'
import { refresh } from './data'
import { switchChain, walletClient, walletStore } from './wallet'

type Call = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }

/** Sends a contract call through the connected wallet and waits for it to be mined. */
export async function sendTx(call: Call) {
  // Bug 4: no network check. chain: null also skips viem's own check, so the tx goes
  // to whatever chain the wallet is on.
  if (!bug(4) && walletStore.get().chainId !== CHAIN.id) await switchChain()
  const hash = await walletClient().sendTransaction({
    to: call.address,
    data: encodeFunctionData(call as Parameters<typeof encodeFunctionData>[0]),
    chain: bug(4) ? null : CHAIN,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  await refresh()
  if (receipt.status !== 'success') throw new Error('The transaction failed on chain.')
  return receipt
}

function causes(e: unknown): unknown[] {
  const chain: unknown[] = []
  for (let c = e; c && chain.length < 10; c = (c as { cause?: unknown }).cause) chain.push(c)
  return chain
}

export const isRejection = (e: unknown) => causes(e).some((c) => (c as { code?: unknown }).code === 4001)

export function errorMessage(e: unknown): string {
  if (isRejection(e)) return 'You rejected the request in your wallet.'
  if (causes(e).some((c) => c instanceof InsufficientFundsError || /insufficient funds/i.test(String(c))))
    return 'Not enough ETH to pay for gas.'
  if (e instanceof BaseError) return e.shortMessage
  return e instanceof Error ? e.message : String(e)
}
