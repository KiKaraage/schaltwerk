import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

const root = document.querySelector<HTMLDivElement>('#app')!
root.innerHTML = `
  <div style="height:100vh;display:flex;flex-direction:column;">
    <h3 style="padding:8px;margin:0;">Orchestrator Terminal</h3>
    <div id="term" style="flex:1"></div>
  </div>
`

const term = new Terminal({ convertEol: true, fontSize: 13 })
const fit = new FitAddon()
term.loadAddon(fit)
term.open(document.getElementById('term')!)
fit.fit()

const id = 'orchestrator'
    ; (async () => {
        const cwd = await homeDir()
        await invoke('create_terminal', { id, cwd })
        await invoke('resize_terminal', { id, cols: term.cols, rows: term.rows })
    })()

listen<string>(`terminal-output-${id}`, (e) => {
    term.write(e.payload)
})

term.onData((data) => {
    invoke('write_terminal', { id, data })
})

window.addEventListener('resize', () => {
    fit.fit()
    invoke('resize_terminal', { id, cols: term.cols, rows: term.rows })
})


