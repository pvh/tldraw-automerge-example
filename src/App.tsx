import { Tldraw, track, useEditor } from '@tldraw/tldraw'
import '@tldraw/tldraw/tldraw.css'

import { useAutomergeStore } from "./automerge-tlstore/useAutomergeStore"
import { useBootstrap } from "@automerge/automerge-repo-react-hooks"
import { DEFAULT_STORE } from "./default_store"

export default function AutomergeExample({ userId }: { userId: string }) {
	const handle = useBootstrap({
		onNoDocument: (repo) => repo.create(DEFAULT_STORE.store)
	})
	const store = useAutomergeStore({ handle, userId })

	return (
		<div className="tldraw__editor">
			<Tldraw autoFocus store={store} shareZone={<NameEditor />} />
		</div>
	)
}

const NameEditor = track(() => {
	const editor = useEditor()

	const { color, name } = editor.user

	return (
		<div style={{ pointerEvents: 'all', display: 'flex' }}>
			<input
				type="color"
				value={color}
				onChange={(e) => {
					editor.user.updateUserPreferences({
						color: e.currentTarget.value,
					})
				}}
			/>
			<input
				value={name}
				onChange={(e) => {
					editor.user.updateUserPreferences({
						name: e.currentTarget.value,
					})
				}}
			/>
		</div>
	)
})
