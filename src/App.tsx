
import { AutomergeUrl } from '@automerge/automerge-repo'
import { useHandle } from '@automerge/automerge-repo-react-hooks'
import { TLStoreSnapshot } from '@tldraw/tldraw'
import { TLDrawAutomergeExample } from './automerge-tlstore/TLDrawAutomergeExample'

export default function App({ docUrl, userId }: { docUrl: AutomergeUrl, userId: string }) {
	const handle = useHandle<TLStoreSnapshot>(docUrl)
	if (!handle) return null
	return <TLDrawAutomergeExample handle={handle} userId={userId} />
}

