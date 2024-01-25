import {
  InstancePresenceRecordType,
  TLAnyShapeUtilConstructor,
  TLInstancePresence,
  TLRecord,
  TLStoreWithStatus,
  computed,
  createPresenceStateDerivation,
  createTLStore,
  defaultShapeUtils,
  defaultUserPreferences,
  getUserPreferences,
  setUserPreferences,
  react,
  transact,
  HistoryEntry,
} from "@tldraw/tldraw"
import { useEffect, useState } from "react"
import { DEFAULT_STORE } from "./default_store"
import { DocHandle, DocHandleChangePayload } from "@automerge/automerge-repo"

export function useAutomergeStore({
  handle,
  shapeUtils = [],
}: {
  handle: DocHandle<any>
  shapeUtils?: TLAnyShapeUtilConstructor[]
}): TLStoreWithStatus {
  const [store] = useState(() => {
    const store = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    })
    store.loadSnapshot(DEFAULT_STORE)
    return store
  })

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: "loading",
  })

  useEffect(() => {
    setStoreWithStatus({ status: "loading" })
    const unsubs: (() => void)[] = []

    /* -------------------- TLDraw to Automerge -------------------- */
    function syncStoreChangesToAutomergeDoc({
      changes,
    }: HistoryEntry<TLRecord>) {
      handle.change((doc) => {
        Object.values(changes.added).forEach((record) => {
          doc[record.id] = record
        })

        Object.values(changes.updated).forEach(([_, record]) => {
          doc[record.id] = record
        })

        Object.values(changes.removed).forEach((record) => {
          delete doc[record.id]
        })
      })
    }

    /* -------------------- Automerge to TLDraw -------------------- */
    const syncAutomergeDocChangesToStore = ({
      patches,
    }: DocHandleChangePayload<any>) => {
      const toRemove: TLRecord["id"][] = []
      const toPut: TLRecord[] = []

      patches.forEach((patch) => {
        console.log(patch)
        switch (patch.action) {
          case "add":
          case "update": {
            const record = patch.value
            toPut.push(record)
            break
          }
          case "delete": {
            const id = patch.key
            toRemove.push(id as TLRecord["id"])
            break
          }
        }
      })

      // put / remove the records in the store
      store.mergeRemoteChanges(() => {
        if (toRemove.length) store.remove(toRemove)
        if (toPut.length) store.put(toPut)
      })
    }

    // Sync store changes to the yjs doc
    unsubs.push(
      store.listen(syncStoreChangesToAutomergeDoc, {
        source: "user",
        scope: "document",
      })
    )

    handle.on("change", syncAutomergeDocChangesToStore)
    unsubs.push(() => handle.off("change", syncAutomergeDocChangesToStore))

    handle.doc().then((doc) => {
      console.log(handle.state, doc)
      if (doc == undefined) {
        console.log("undefined doc")
        return
      } else if (Object.values(doc).length === 0) {
        console.log("empty doc")

        handle.change((doc) => {
          for (const record of store.allRecords()) {
            doc[record.id] = record
          }
        })
      }
      store.clear()
      store.put({ ...doc })
    })

    return () => {
      unsubs.forEach((fn) => fn())
      unsubs.length = 0
    }
  }, [handle, store])

  return storeWithStatus
}

function handleSync() {
  // 1.
  // Connect store to yjs store and vis versa, for both the document and awareness

  if (yStore.yarray.length) {
    // Replace the store records with the yjs doc records
    transact(() => {
      // The records here should be compatible with what's in the store
      store.clear()
      const records = yStore.yarray.toJSON().map(({ val }) => val)
      store.put(records)
    })
  } else {
    // Create the initial store records
    // Sync the store records to the yjs doc
    yDoc.transact(() => {
      for (const record of store.allRecords()) {
        yStore.set(record.id, record)
      }
    })
  }

  /* -------------------- Awareness ------------------- */

  const yClientId = room.awareness.clientID.toString()
  setUserPreferences({ id: yClientId })

  const userPreferences = computed<{
    id: string
    color: string
    name: string
  }>("userPreferences", () => {
    const user = getUserPreferences()
    return {
      id: user.id,
      color: user.color ?? defaultUserPreferences.color,
      name: user.name ?? defaultUserPreferences.name,
    }
  })

  // Create the instance presence derivation
  const presenceId = InstancePresenceRecordType.createId(yClientId)
  const presenceDerivation = createPresenceStateDerivation(
    userPreferences,
    presenceId
  )(store)

  // Set our initial presence from the derivation's current value
  room.awareness.setLocalStateField("presence", presenceDerivation.value)

  // When the derivation change, sync presence to to yjs awareness
  unsubs.push(
    react("when presence changes", () => {
      const presence = presenceDerivation.value
      requestAnimationFrame(() => {
        room.awareness.setLocalStateField("presence", presence)
      })
    })
  )

  // Sync yjs awareness changes to the store
  const handleUpdate = (update: {
    added: number[]
    updated: number[]
    removed: number[]
  }) => {
    const states = room.awareness.getStates() as Map<
      number,
      { presence: TLInstancePresence }
    >

    const toRemove: TLInstancePresence["id"][] = []
    const toPut: TLInstancePresence[] = []

    // Connect records to put / remove
    for (const clientId of update.added) {
      const state = states.get(clientId)
      if (state?.presence && state.presence.id !== presenceId) {
        toPut.push(state.presence)
      }
    }

    for (const clientId of update.updated) {
      const state = states.get(clientId)
      if (state?.presence && state.presence.id !== presenceId) {
        toPut.push(state.presence)
      }
    }

    for (const clientId of update.removed) {
      toRemove.push(InstancePresenceRecordType.createId(clientId.toString()))
    }

    // put / remove the records in the store
    store.mergeRemoteChanges(() => {
      if (toRemove.length) store.remove(toRemove)
      if (toPut.length) store.put(toPut)
    })
  }

  room.awareness.on("update", handleUpdate)
  unsubs.push(() => room.awareness.off("update", handleUpdate))

  setStoreWithStatus({
    store,
    status: "synced-remote",
    connectionStatus: "online",
  })
}

let hasConnectedBefore = false

function handleStatusChange({
  status,
}: {
  status: "disconnected" | "connected"
}) {
  // If we're disconnected, set the store status to 'synced-remote' and the connection status to 'offline'
  if (status === "disconnected") {
    setStoreWithStatus({
      store,
      status: "synced-remote",
      connectionStatus: "offline",
    })
    return
  }

  room.off("synced", handleSync)

  if (status === "connected") {
    if (hasConnectedBefore) return
    hasConnectedBefore = true
    room.on("synced", handleSync)
    unsubs.push(() => room.off("synced", handleSync))
  }
}