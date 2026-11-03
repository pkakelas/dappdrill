// Stops the anvil and site processes started by `pnpm start`.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const runDir = join(import.meta.dirname, '..', '.run')

for (const name of ['site', 'anvil']) {
  const pidFile = join(runDir, `${name}.pid`)
  if (!existsSync(pidFile)) continue
  const pid = Number(readFileSync(pidFile, 'utf8'))
  try {
    process.kill(-pid, 'SIGTERM') // detached children lead their own process group
    console.log(`stopped ${name} (pid ${pid})`)
  } catch {
    console.log(`${name} (pid ${pid}) was not running`)
  }
  rmSync(pidFile)
}
