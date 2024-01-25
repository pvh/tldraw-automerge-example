import {
  TLAnyShapeUtilConstructor,
  TLRecord,
  TLStoreWithStatus,
  createTLStore,
  defaultShapeUtils,
  HistoryEntry,
  RecordId,
} from "@tldraw/tldraw"
import { useEffect, useState } from "react"
import { DEFAULT_STORE } from "./default_store"
import { type Patch } from "@automerge/automerge/next"
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

    // A hacky workaround to prevent local changes from being applied twice
    // once into the automerge doc and then back again.
    let preventPatchApplications = false

    /* -------------------- TLDraw to Automerge -------------------- */
    function syncStoreChangesToAutomergeDoc({
      changes,
    }: HistoryEntry<TLRecord>) {
      preventPatchApplications = true
      handle.change((doc) => {
        Object.values(changes.added).forEach((record) => {
          doc[record.id] = record
        })

        Object.values(changes.updated).forEach(([_, record]) => {
          deepCompareAndUpdate(doc[record.id], record)
        })

        Object.values(changes.removed).forEach((record) => {
          delete doc[record.id]
        })
      })
      preventPatchApplications = false
    }

    /* -------------------- Automerge to TLDraw -------------------- */
    const syncAutomergeDocChangesToStore = ({
      patches,
    }: DocHandleChangePayload<any>) => {
      if (preventPatchApplications) return

      const toRemove: TLRecord["id"][] = []
      const updatedObjects: { [id: string]: TLRecord } = {}

      // For each patch
      // if we don't have the object, copy it out of the store
      // put it in the map of objects to put back in the store
      // apply the patch to that object

      // path: "/camera:page:page/x" => "camera:page:page"
      const pathToId = (path: string[]): RecordId<any> => {
        return path[0] as RecordId<any>
      }

      const applyInsertToObject = (patch: Patch, object: any): TLRecord => {
        const { path, values } = patch
        let current = object
        const insertionPoint = path[path.length - 1]
        const pathEnd = path[path.length - 2]
        const parts = path.slice(1, -2)
        for (const part of parts) {
          if (current[part] === undefined) {
            throw new Error("NO WAY")
          }
          current = current[part]
        }
        // splice is a mutator... yay.
        const clone = current[pathEnd].slice(0)
        clone.splice(insertionPoint, 0, ...values)
        current[pathEnd] = clone
        return object
      }

      const applyPutToObject = (patch: Patch, object: any): TLRecord => {
        const { path, value } = patch
        let current = object
        // special case
        if (path.length === 1) {
          // this would be creating the object, but we have done
          return object
        }

        const parts = path.slice(1, -2)
        const property = path[path.length - 1]
        const target = path[path.length - 2]

        if (path.length === 2) {
          return { ...object, [property]: value }
        }

        // default case
        for (const part of parts) {
          current = current[part]
        }
        current[target] = { ...current[target], [property]: value }
        return object
      }

      const applyUpdateToObject = (patch: Patch, object: any): TLRecord => {
        const { path, value } = patch
        let current = object
        const parts = path.slice(1, -1)
        const pathEnd = path[path.length - 1]
        for (const part of parts) {
          if (current[part] === undefined) {
            throw new Error("NO WAY")
          }
          current = current[part]
        }
        current[pathEnd] = value
        return object
      }

      const applySpliceToObject = (patch: Patch, object: any): TLRecord => {
        const { path, value } = patch
        let current = object
        const insertionPoint = path[path.length - 1]
        const pathEnd = path[path.length - 2]
        const parts = path.slice(1, -2)
        for (const part of parts) {
          if (current[part] === undefined) {
            throw new Error("NO WAY")
          }
          current = current[part]
        }
        // TODO: we're not supporting actual splices yet because TLDraw won't generate them natively
        if (insertionPoint !== 0) {
          throw new Error("Splices are not supported yet")
        }
        current[pathEnd] = value // .splice(insertionPoint, 0, value)
        return object
      }

      patches.forEach((patch) => {
        const id = pathToId(patch.path)
        const record =
          updatedObjects[id] || JSON.parse(JSON.stringify(store.get(id) || {}))

        switch (patch.action) {
          case "insert": {
            updatedObjects[id] = applyInsertToObject(patch, record)
            break
          }
          case "put":
            updatedObjects[id] = applyPutToObject(patch, record)
            break
          case "update": {
            updatedObjects[id] = applyUpdateToObject(patch, record)
            break
          }
          case "splice": {
            updatedObjects[id] = applySpliceToObject(patch, record)
            break
          }
          case "del": {
            const id = pathToId(patch.path)
            toRemove.push(id as TLRecord["id"])
            break
          }
          default: {
            console.log("Unsupported patch:", patch)
          }
        }
      })

      const doc = handle.docSync()
      if (!doc) {
        return
      }

      const toPut = Object.values(updatedObjects)

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

      setStoreWithStatus({
        store,
        status: "synced-remote",
        connectionStatus: "online",
      })
    })

    return () => {
      unsubs.forEach((fn) => fn())
      unsubs.length = 0
    }
  }, [handle, store])

  return storeWithStatus
}

import _ from "lodash"
function deepCompareAndUpdate(objectA: any, objectB: any) {
  // eslint-disable-line
  if (_.isArray(objectB)) {
    if (!_.isArray(objectA)) {
      // if objectA is not an array, replace it with objectB
      objectA = objectB.slice()
    } else {
      // compare and update array elements
      for (let i = 0; i < objectB.length; i++) {
        if (i >= objectA.length) {
          objectA.push(objectB[i])
        } else {
          if (_.isObject(objectB[i]) || _.isArray(objectB[i])) {
            // if element is an object or array, recursively compare and update
            deepCompareAndUpdate(objectA[i], objectB[i])
          } else if (objectA[i] !== objectB[i]) {
            // update the element
            objectA[i] = objectB[i]
          }
        }
      }
      // remove extra elements
      if (objectA.length > objectB.length) {
        objectA.splice(objectB.length)
      }
    }
  } else if (_.isObject(objectB)) {
    _.forIn(objectB, (value, key) => {
      if (objectA[key] === undefined) {
        // if key is not in objectA, add it
        objectA[key] = value
      } else {
        if (_.isObject(value) || _.isArray(value)) {
          // if value is an object or array, recursively compare and update
          deepCompareAndUpdate(objectA[key], value)
        } else if (objectA[key] !== value) {
          // update the value
          objectA[key] = value
        }
      }
    })
  }
}

/*
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

  /* -------------------- Awareness ------------------- * /

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

*/
