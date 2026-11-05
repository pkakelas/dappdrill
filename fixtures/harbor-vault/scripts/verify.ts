// Walks Harbor Vault's main actions in Chromium with a minimal injected wallet backed by anvil's
// unlocked accounts, reproduces each seeded bug, and checks ?bugs=none behaves correctly.
// Needs `pnpm start` first. Screenshots go to verify-output/.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  http,
  maxUint256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { anvil } from 'viem/chains'
import { addresses, ROOT, RPC_URL } from './deploy.ts'

const SITE = 'http://localhost:5173'
const OUT = join(ROOT, 'verify-output')
const USER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // anvil #1
const USER2: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' // anvil #2
const usdc = (n: number) => BigInt(n) * 1_000_000n

const abi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function claim() returns (uint256)',
])

// ---- anvil helpers --------------------------------------------------------------------------

const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) })
const node = createWalletClient({ chain: anvil, transport: http(RPC_URL) })

async function rpc(method: string, params: unknown[] = []): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const { result, error } = await res.json()
  return error ? { error: { code: error.code, message: error.message } } : { result }
}

/** Sends a call from an unlocked anvil account, outside the page. */
async function call(from: Address, to: Address, functionName: 'mint' | 'approve' | 'deposit', args: readonly unknown[]) {
  const hash = await node.writeContract({ account: from, address: to, abi, functionName, args } as never)
  await publicClient.waitForTransactionReceipt({ hash })
}

async function fund(account: Address, amount = 1_000) {
  await call(account, addresses.hUSDC, 'mint', [account, usdc(amount)])
}

async function depositDirect(account: Address, amount: number) {
  await call(account, addresses.hUSDC, 'approve', [addresses.HarborVault, usdc(amount)])
  await call(account, addresses.HarborVault, 'deposit', [usdc(amount), account])
}

// ---- injected test wallet -------------------------------------------------------------------

type WalletSpec = { id: string; name: string; rdns: string; injected: boolean }
type WalletState = WalletSpec & { account: Address; chainId: number; rejectNext: boolean }
type WalletRequest = { wallet: string; method: string; params: any[]; chainId: number }

const ICON =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#444"/></svg>')

/** Runs in the page: an EIP-1193 provider per wallet that forwards to node, plus EIP-6963 announcements. */
function shim({ wallets, icon }: { wallets: WalletSpec[]; icon: string }) {
  const w = window as any
  w.__emit = {}
  for (const spec of wallets) {
    const handlers: Record<string, Set<(data: unknown) => void>> = {}
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        const res = await w.__wallet(spec.id, method, params ?? [])
        if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
        return res.result
      },
      on(event: string, fn: (data: unknown) => void) {
        ;(handlers[event] ??= new Set()).add(fn)
      },
      removeListener(event: string, fn: (data: unknown) => void) {
        handlers[event]?.delete(fn)
      },
    }
    w.__emit[spec.id] = (event: string, data: unknown) => handlers[event]?.forEach((fn) => fn(data))
    if (spec.injected) w.ethereum = provider
    const info = { uuid: spec.id, name: spec.name, icon, rdns: spec.rdns }
    const announce = () =>
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
    window.addEventListener('eip6963:requestProvider', announce)
    announce()
  }
}

let browser: Browser

async function session(opts: { bugs: boolean; path?: string; wallets?: WalletSpec[]; chainId?: number }) {
  const specs = opts.wallets ?? [{ id: 'test', name: 'Test Wallet', rdns: 'dev.dappdrill.test', injected: true }]
  const wallets = specs.map((s): WalletState => ({ ...s, account: USER, chainId: opts.chainId ?? 31337, rejectNext: false }))
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await context.newPage()
  const requests: WalletRequest[] = []
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  let rpcDelay = 0 // ms added to the page's own RPC reads ("slow RPC")
  await page.route(
    (url) => url.port === '8545',
    async (route) => {
      if (rpcDelay) await new Promise((r) => setTimeout(r, rpcDelay))
      await route.continue()
    },
  )

  const emit = (wallet: WalletState, event: string, data: unknown) =>
    page.evaluate(([id, ev, d]) => (window as any).__emit[id as string](ev, d), [wallet.id, event, data] as const)

  await page.exposeFunction('__wallet', async (id: string, method: string, params: any[]) => {
    const w = wallets.find((x) => x.id === id)!
    requests.push({ wallet: w.name, method, params, chainId: w.chainId })
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return { result: [w.account] }
      case 'eth_chainId':
        return { result: toHex(w.chainId) }
      case 'wallet_switchEthereumChain':
        w.chainId = Number(params[0].chainId)
        await emit(w, 'chainChanged', toHex(w.chainId))
        return { result: null }
      case 'eth_sendTransaction':
      case 'personal_sign':
      case 'eth_signTypedData_v4':
        if (w.rejectNext) {
          w.rejectNext = false
          return { error: { code: 4001, message: 'User rejected the request.' } }
        }
        // On another chain the tx would go elsewhere; record it and return a hash that never lands here.
        if (method === 'eth_sendTransaction' && w.chainId !== 31337) return { result: `0x${'ab'.repeat(32)}` }
    }
    return rpc(method, params)
  })
  // tsx compiles with keepNames, which wraps functions in __name(); define it in the page.
  await page.addInitScript({ content: `var __name = (f) => f; (${shim})(${JSON.stringify({ wallets: specs, icon: ICON })})` })
  await page.goto(`${SITE}${opts.path ?? '/'}${opts.bugs ? '' : '?bugs=none'}`)
  await page.getByRole('button', { name: 'Connect wallet' }).first().waitFor()

  const txs = () =>
    requests
      .filter((r) => r.method === 'eth_sendTransaction')
      .map((r) => {
        const { to, from, data } = r.params[0] as { to: Address; from: Address; data: Hex }
        const { functionName, args } = decodeFunctionData({ abi, data })
        return { to, from, functionName, args: (args ?? []) as readonly unknown[], chainId: r.chainId, wallet: r.wallet }
      })

  return {
    page,
    wallets,
    requests,
    pageErrors,
    txs,
    emit,
    setRpcDelay: (ms: number) => (rpcDelay = ms),
    close: () => context.close(),
  }
}
type Session = Awaited<ReturnType<typeof session>>

async function connect(s: Session, walletName = 'Test Wallet') {
  await s.page.getByRole('button', { name: 'Connect wallet' }).first().click()
  await s.page.getByRole('dialog').getByRole('button', { name: walletName }).click()
  await s.page.getByTestId('header-address').waitFor()
}

async function goto(page: Page, label: string) {
  await page.getByRole('navigation').getByRole('link', { name: label }).click()
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(what: string, check: () => boolean | Promise<boolean>, timeout = 10_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

// ---- scenarios ------------------------------------------------------------------------------

/** Each check returns whether the seeded bug showed up, plus what was observed. */
type Result = { buggy: boolean; observed: string }
type Scenario = { id: number; title: string; run: (bugs: boolean) => Promise<Result> }

const scenarios: Scenario[] = [
  {
    id: 1,
    title: 'Approve label vs unlimited approval',
    async run(bugs) {
      await fund(USER)
      const s = await session({ bugs, path: '/vault' })
      await connect(s)
      await s.page.locator('#deposit-amount').fill('100')
      await s.page.getByRole('button', { name: 'Approve 100 hUSDC' }).click()
      await s.page.getByRole('button', { name: 'Deposit 100 hUSDC' }).waitFor()
      const approve = s.txs().find((t) => t.functionName === 'approve')!
      await s.close()
      const amount = approve.args[1] as bigint
      return { buggy: amount === maxUint256, observed: `button "Approve 100 hUSDC" -> approve(vault, ${amount === maxUint256 ? 'MAX_UINT256' : amount})` }
    },
  },
  {
    id: 2,
    title: 'Claim asks to approve the Helper',
    async run(bugs) {
      await fund(USER)
      await depositDirect(USER, 200)
      const s = await session({ bugs, path: '/rewards' })
      await connect(s)
      await s.page.getByRole('button', { name: 'Claim rewards' }).click()
      await s.page.getByText(/^Claimed /).waitFor()
      if (!bugs) await shot(s.page, 'rewards-claimed')
      const txs = s.txs()
      await s.close()
      const first = txs[0]!
      const spender = first.functionName === 'approve' ? (first.args[0] as Address) : undefined
      return {
        buggy: spender?.toLowerCase() === addresses.Helper.toLowerCase(),
        observed: txs.map((t) => `${t.functionName}(${t.functionName === 'approve' ? 'Helper' : ''})`).join(' then '),
      }
    },
  },
  {
    id: 3,
    title: 'Rejected deposit leaves "Confirming…"',
    async run(bugs) {
      await fund(USER)
      await call(USER, addresses.hUSDC, 'approve', [addresses.HarborVault, usdc(100)])
      const s = await session({ bugs, path: '/vault' })
      await connect(s)
      await s.page.locator('#deposit-amount').fill('100')
      s.wallets[0]!.rejectNext = true
      await s.page.getByRole('button', { name: 'Deposit 100 hUSDC' }).click()
      await until('the rejection', () => s.requests.some((r) => r.method === 'eth_sendTransaction'))
      await sleep(2000)
      const button = s.page.locator('.card', { hasText: 'Amount to deposit' }).locator('button.wide')
      const text = await button.innerText()
      const disabled = await button.isDisabled()
      if (bugs) await shot(s.page, 'bug3-stuck-confirming')
      await s.close()
      return { buggy: text === 'Confirming…' && disabled, observed: `2s after rejecting: "${text}"${disabled ? ' (disabled)' : ''}` }
    },
  },
  {
    id: 4,
    title: 'No network check on deposit',
    async run(bugs) {
      await fund(USER)
      await call(USER, addresses.hUSDC, 'approve', [addresses.HarborVault, usdc(100)])
      const s = await session({ bugs, path: '/vault', chainId: 1 })
      await connect(s)
      const banner = await s.page.getByText('Your wallet is on Ethereum').isVisible()
      if (!bugs) await shot(s.page, 'wrong-network-banner')
      await s.page.locator('#deposit-amount').fill('100')
      await s.page.getByRole('button', { name: 'Deposit 100 hUSDC' }).click()
      await until('a deposit request', () => s.txs().length > 0)
      const switched = s.requests.some((r) => r.method === 'wallet_switchEthereumChain')
      const tx = s.txs()[0]!
      if (!bugs) await s.page.getByText('Deposited 100 hUSDC.').waitFor()
      await s.close()
      return {
        buggy: tx.chainId !== 31337 && !switched,
        observed: `banner ${banner ? 'shown' : 'not shown'}; switch prompt ${switched ? 'sent' : 'not sent'}; deposit sent on chain ${tx.chainId}`,
      }
    },
  },
  {
    id: 5,
    title: 'Account switch ignored',
    async run(bugs) {
      await fund(USER, 500)
      const s = await session({ bugs })
      await connect(s)
      const wallet = s.wallets[0]!
      wallet.account = USER2
      await s.emit(wallet, 'accountsChanged', [USER2])
      await sleep(1000)
      const shown = await s.page.getByTestId('header-address').innerText()
      const balance = await s.page.getByTestId('header-balance').innerText()
      await s.page.getByRole('button', { name: 'Get test hUSDC' }).click()
      await until('the faucet tx', () => s.txs().length > 0)
      const from = s.txs()[0]!.from
      await s.close()
      const stale = from.toLowerCase() === USER.toLowerCase()
      return { buggy: shown.startsWith(USER.slice(0, 6)) && stale, observed: `after switching to ${USER2.slice(0, 6)}…: header "${shown}" / "${balance}", next tx from ${from.slice(0, 6)}…` }
    },
  },
  {
    id: 6,
    title: 'Withdraw with no ETH for gas blanks the page',
    async run(bugs) {
      await fund(USER)
      await depositDirect(USER, 300)
      await rpc('anvil_setBalance', [USER, '0x3e8']) // 1000 wei
      const s = await session({ bugs, path: '/vault' })
      await connect(s)
      await s.page.locator('#withdraw-amount').fill('50')
      await s.page.getByRole('button', { name: 'Withdraw', exact: true }).click()
      await until('the withdraw request', () => s.requests.some((r) => r.method === 'eth_sendTransaction'))
      await sleep(1000)
      const empty = await s.page.locator('#root').evaluate((el) => el.childElementCount === 0)
      const message = empty ? '' : await s.page.locator('.note.error').innerText().catch(() => '(no message)')
      await shot(s.page, bugs ? 'bug6-blank-page' : 'withdraw-no-gas-message')
      const errors = [...s.pageErrors]
      await s.close()
      return {
        buggy: empty,
        observed: empty ? `page blank; uncaught: ${errors[0] ?? 'none'}` : `message "${message}", ${errors.length} page errors`,
      }
    },
  },
  {
    id: 7,
    title: 'Double deposit under slow RPC',
    async run(bugs) {
      await fund(USER)
      await call(USER, addresses.hUSDC, 'approve', [addresses.HarborVault, usdc(200)])
      const s = await session({ bugs, path: '/vault' })
      await connect(s)
      await s.page.locator('#deposit-amount').fill('100')
      const button = s.page.getByRole('button', { name: 'Deposit 100 hUSDC' })
      const box = (await button.boundingBox())!
      s.setRpcDelay(1500)
      await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await sleep(250)
      await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await sleep(6000)
      const deposits = s.txs().filter((t) => t.functionName === 'deposit').length
      await s.close()
      return { buggy: deposits > 1, observed: `two clicks 250ms apart with 1.5s RPC latency -> ${deposits} deposit request(s)` }
    },
  },
  {
    id: 8,
    title: '"Sign in" requests a Permit to the Helper',
    async run(bugs) {
      const s = await session({ bugs })
      await connect(s)
      await s.page.getByRole('button', { name: 'Sign in' }).click()
      await s.page.getByRole('dialog', { name: 'Sign in to Harbor Vault' }).waitFor()
      if (bugs) await shot(s.page, 'sign-in-dialog')
      await s.page.getByRole('button', { name: 'Sign message' }).click()
      await s.page.getByText('Signed in', { exact: true }).waitFor()
      const req = s.requests.find((r) => r.method === 'personal_sign' || r.method === 'eth_signTypedData_v4')!
      await s.close()
      if (req.method === 'personal_sign') {
        const text = Buffer.from((req.params[0] as string).slice(2), 'hex').toString()
        return { buggy: false, observed: `personal_sign "${text.split('\n')[3]}"` }
      }
      const typed = JSON.parse(req.params[1] as string)
      const spender = typed.message.spender as string
      const isHelper = spender.toLowerCase() === addresses.Helper.toLowerCase()
      return {
        buggy: typed.primaryType === 'Permit' && isHelper,
        observed: `eth_signTypedData_v4 ${typed.primaryType}(spender ${isHelper ? 'Helper' : spender}, value ${BigInt(typed.message.value) === maxUint256 ? 'MAX' : typed.message.value})`,
      }
    },
  },
  {
    id: 9,
    title: 'Picked wallet ignored with two wallets',
    async run(bugs) {
      const s = await session({
        bugs,
        wallets: [
          { id: 'a', name: 'Wallet A', rdns: 'dev.dappdrill.a', injected: true },
          { id: 'b', name: 'Wallet B', rdns: 'dev.dappdrill.b', injected: false },
        ],
      })
      await s.page.getByRole('button', { name: 'Connect wallet' }).first().click()
      const listed = await s.page.getByRole('dialog').getByRole('button').allInnerTexts()
      if (bugs) await shot(s.page, 'connect-modal-two-wallets')
      await s.page.getByRole('dialog').getByRole('button', { name: 'Wallet B' }).click()
      await s.page.getByTestId('header-address').waitFor()
      const asked = s.requests.find((r) => r.method === 'eth_requestAccounts')!.wallet
      await s.close()
      return {
        buggy: asked === 'Wallet A',
        observed: `modal lists ${listed.filter((t) => t.startsWith('Wallet')).join(', ')}; picked Wallet B; eth_requestAccounts went to ${asked}`,
      }
    },
  },
]

/** Full happy path on the fixed app: faucet, approve exact, deposit, withdraw, claim, sign in. */
async function happyPath(): Promise<string> {
  const s = await session({ bugs: false })
  await shot(s.page, 'overview-disconnected')
  await connect(s)
  await s.page.getByRole('button', { name: 'Get test hUSDC' }).click()
  await s.page.getByText('Sent 1,000 test hUSDC to your wallet.').waitFor()
  await until('balance', async () => (await s.page.getByTestId('header-balance').innerText()) === '1,000.00 hUSDC')
  await shot(s.page, 'overview-connected')

  await goto(s.page, 'Vault')
  await s.page.locator('#deposit-amount').fill('250')
  await s.page.getByRole('button', { name: 'Approve 250 hUSDC' }).click()
  await s.page.getByRole('button', { name: 'Deposit 250 hUSDC' }).click()
  await s.page.getByText('Deposited 250 hUSDC.').waitFor()
  await s.page.locator('#withdraw-amount').fill('100')
  await s.page.getByRole('button', { name: 'Withdraw', exact: true }).click()
  await s.page.getByText('Withdrew 100 hUSDC.').waitFor()
  await shot(s.page, 'vault')

  await goto(s.page, 'Rewards')
  await s.page.getByRole('button', { name: 'Claim rewards' }).click()
  await s.page.getByText(/^Claimed /).waitFor()
  await s.page.getByRole('button', { name: 'Sign in' }).click()
  await s.page.getByRole('button', { name: 'Sign message' }).click()
  await s.page.getByText('Signed in', { exact: true }).waitFor()

  await goto(s.page, 'Settings')
  await s.page.getByText('hUSDC the vault can spend').waitFor()
  await shot(s.page, 'settings')

  await goto(s.page, 'Overview')
  const deposited = await s.page.getByTestId('deposited').innerText()
  const sent = s.txs().map((t) => {
    if (t.functionName === 'approve') return `approve(${t.args[0] === addresses.HarborVault ? 'vault' : t.args[0]}, ${Number(t.args[1]) / 1e6})`
    if (t.functionName === 'claim') return `claim -> ${t.to === addresses.RewardsDistributor ? 'distributor' : t.to}`
    return t.functionName
  })
  const signs = s.requests.filter((r) => r.method.includes('sign')).map((r) => r.method)
  if (s.pageErrors.length) throw new Error(`page errors: ${s.pageErrors.join('; ')}`)
  await s.close()
  return `${sent.join(', ')}; ${signs.join(', ')}; deposited now ${deposited}`
}

// ---- main -----------------------------------------------------------------------------------

async function isolated<T>(fn: () => Promise<T>): Promise<T> {
  const { result: snapshot } = await rpc('evm_snapshot')
  try {
    return await fn()
  } finally {
    await rpc('evm_revert', [snapshot])
  }
}

mkdirSync(OUT, { recursive: true })
browser = await chromium.launch()
let failures = 0
try {
  try {
    console.log(`happy path (?bugs=none): ${await isolated(happyPath)}\n`)
  } catch (e) {
    failures++
    console.log(`happy path (?bugs=none): FAILED ${(e as Error).message}\n`)
  }
  for (const scenario of scenarios) {
    console.log(`#${scenario.id} ${scenario.title}`)
    for (const bugs of [true, false]) {
      const label = bugs ? 'bugs on  ' : 'bugs=none'
      try {
        const { buggy, observed } = await isolated(() => scenario.run(bugs))
        const ok = buggy === bugs
        if (!ok) failures++
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label} ${buggy ? 'BUG ' : 'fine'}  ${observed}`)
      } catch (e) {
        failures++
        console.log(`  FAIL ${label} ${(e as Error).message.split('\n')[0]}`)
      }
    }
  }
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
