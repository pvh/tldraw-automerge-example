import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import { Repo } from "@automerge/automerge-repo"
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { RepoContext } from "@automerge/automerge-repo-react-hooks"

const repo = new Repo({network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")]}) 

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RepoContext.Provider value={repo}>
      <App />
    </RepoContext.Provider>
  </React.StrictMode>,
)
