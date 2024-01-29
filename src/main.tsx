import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.tsx"
import "./index.css"

import { Repo, isValidAutomergeUrl } from "@automerge/automerge-repo"
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket"
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb"

import { RepoContext } from "@automerge/automerge-repo-react-hooks"
import { TLStoreSnapshot } from "@tldraw/tldraw"

const repo = new Repo({
  network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
  storage: new IndexedDBStorageAdapter("tldraw-demo"),
})

const rootDocUrl = `${document.location.hash.slice(1)}`
let handle
if (isValidAutomergeUrl(rootDocUrl)) {
  handle = repo.find(rootDocUrl)
} else {
  handle = repo.create<TLStoreSnapshot>()
  const { init } = await import("automerge-tldraw")
  handle.change(init)
}

// eslint-disable-next-line
const docUrl = (document.location.hash = handle.url)

const userId = Math.random().toString(36).substring(2, 15)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RepoContext.Provider value={repo}>
      <App docUrl={docUrl} userId={userId} />
    </RepoContext.Provider>
  </React.StrictMode>
)
