// Idempotent: starts anvil (:8545) if needed, deploys if needed, serves the site (:5173).
// Both run detached; `pnpm stop` stops them. Logs and pid files live in .run/.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, openSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addresses, deploy, isDeployed, ROOT, RPC_URL, writeDeployments } from './deploy.ts'

export const RUN_DIR = join(ROOT, '.run')
export const SITE_URL = 'http://localhost:5173'

async function chainId(): Promise<number | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    })
    return Number((await res.json()).result)
  } catch {
    return null
  }
}

async function siteUp(): Promise<boolean> {
  try {
    return (await fetch('http://127.0.0.1:5173/')).ok
  } catch {
    return false
  }
}

function daemon(name: string, cmd: string, args: string[]): void {
  const log = openSync(join(RUN_DIR, `${name}.log`), 'a')
  const child = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: ['ignore', log, log] })
  child.unref()
  writeFileSync(join(RUN_DIR, `${name}.pid`), String(child.pid))
}

async function waitFor(what: string, ready: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await ready()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`${what} did not start; see ${RUN_DIR}`)
}

function run(cmd: string, args: string[]): void {
  const { status } = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
  if (status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}

mkdirSync(RUN_DIR, { recursive: true })

const id = await chainId()
if (id === null) {
  daemon('anvil', 'anvil', ['--host', '127.0.0.1', '--port', '8545', '--chain-id', '31337'])
  await waitFor('anvil', async () => (await chainId()) !== null)
  console.log('anvil started on :8545')
} else if (id !== 31337) {
  throw new Error(`Something else is running on :8545 (chain ${id})`)
}

if (await isDeployed()) {
  console.log('contracts already deployed')
} else {
  run('forge', ['build', '--quiet'])
  await deploy()
  console.log('contracts deployed')
}
writeDeployments()

if (await siteUp()) {
  console.log('site already running')
} else {
  const vite = join(ROOT, 'node_modules', '.bin', 'vite')
  run(vite, ['build', '--logLevel', 'warn'])
  daemon('site', vite, ['preview'])
  await waitFor('site', siteUp)
}

console.log(`\nHarbor Vault: ${SITE_URL}  (?bugs=none for the fixed app)`)
console.log(`RPC: ${RPC_URL} (chain 31337)`)
for (const [name, address] of Object.entries(addresses)) console.log(`  ${name.padEnd(18)} ${address}`)
