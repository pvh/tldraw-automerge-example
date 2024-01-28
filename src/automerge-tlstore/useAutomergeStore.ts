import {
  TLAnyShapeUtilConstructor,
  TLRecord,
  TLStoreWithStatus,
  createTLStore,
  defaultShapeUtils,
  HistoryEntry,
  getUserPreferences,
  setUserPreferences,
  defaultUserPreferences,
  createPresenceStateDerivation,
  InstancePresenceRecordType,
  computed,
  react,
  TLStoreSnapshot,
} from "@tldraw/tldraw"
import { useEffect, useState } from "react"
import { DocHandle, DocHandleChangePayload } from "@automerge/automerge-repo"
import {
  useLocalAwareness,
  useRemoteAwareness,
} from "@automerge/automerge-repo-react-hooks"

import { applyAutomergePatchesToTLStore } from "./AutomergeToTLStore.js"
import { applyTLStoreChangesToAutomerge } from "./TLStoreToAutomerge.js"

export function useAutomergeStore({
  handle,
  userId,
  shapeUtils = [],
}: {
  handle: DocHandle<TLStoreSnapshot>
  userId: string
  shapeUtils?: TLAnyShapeUtilConstructor[]
}): TLStoreWithStatus {
  const [store] = useState(() => {
    const store = createTLStore({
      shapeUtils: [...defaultShapeUtils, ...shapeUtils],
    })
    return store
  })

  const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
    status: "loading",
  })

  const [, updateLocalState] = useLocalAwareness({
    handle,
    userId,
    initialState: {},
  })

  const [peerStates] = useRemoteAwareness({
    handle,
    localUserId: userId,
  })

  /* ----------- Presence stuff ----------- */
  useEffect(() => {
    // TODO: peer removal when they go away
    const toRemove = [] as TLRecord["id"][]
    const toPut = Object.values(peerStates) as TLRecord[]

    // put / remove the records in the store
    if (toRemove.length) store.remove(toRemove)
    if (toPut.length) store.put(toPut)
  }, [store, peerStates])

  useEffect(() => {
    /* ----------- Presence stuff ----------- */
    // TODO: this should not be in this code
    setUserPreferences({ id: userId })
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

    const presenceId = InstancePresenceRecordType.createId(userId)
    const presenceDerivation = createPresenceStateDerivation(
      userPreferences,
      presenceId
    )(store)

    return react("when presence changes", () => {
      const presence = presenceDerivation.value
      requestAnimationFrame(() => {
        updateLocalState(presence)
      })
    })
  }, [store, userId, updateLocalState])
  /* ----------- End presence stuff ----------- */

  /* -------------------- TLDraw <--> Automerge -------------------- */
  useEffect(() => {
    const unsubs: (() => void)[] = []

    // A hacky workaround to prevent local changes from being applied twice
    // once into the automerge doc and then back again.
    let preventPatchApplications = false

    /* TLDraw to Automerge */
    function syncStoreChangesToAutomergeDoc({
      changes,
    }: HistoryEntry<TLRecord>) {
      preventPatchApplications = true
      handle.change((doc) => {
        applyTLStoreChangesToAutomerge(doc, changes)
      })
      preventPatchApplications = false
    }

    unsubs.push(
      store.listen(syncStoreChangesToAutomergeDoc, {
        source: "user",
        scope: "document",
      })
    )

    /* Automerge to TLDraw */
    const syncAutomergeDocChangesToStore = ({
      patches,
    }: DocHandleChangePayload<any>) => {
      if (preventPatchApplications) return

      applyAutomergePatchesToTLStore(patches, store)
    }

    handle.on("change", syncAutomergeDocChangesToStore)
    unsubs.push(() => handle.off("change", syncAutomergeDocChangesToStore))

    /* Defer rendering until the document is ready */
    // TODO: need to think through the various status possibilities here and how they map
    handle.whenReady().then(() => {
      const doc = handle.docSync()
      if (!doc) throw new Error("Document not found")
      if (!doc.store) throw new Error("Document store not initialized")

      store.mergeRemoteChanges(() => {
        store.loadSnapshot({
          store: JSON.parse(JSON.stringify(doc.store)),
          schema: doc.schema,
        })
      })

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
