import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadDeployments } from './config'
import { startPolling } from './data'
import './styles.css'
import { discoverWallets, reconnect } from './wallet'

loadDeployments().then(() => {
  discoverWallets()
  startPolling()
  createRoot(document.getElementById('root')!).render(<App />)
  reconnect().catch((e) => console.warn('Could not restore the wallet connection', e))
})
