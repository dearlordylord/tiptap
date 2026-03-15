import './styles.scss'

import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { EditorContent, useEditor } from '@tiptap/react'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import React, { useCallback, useRef, useState } from 'react'
import * as Y from 'yjs'

// Two Y.Docs synced locally (simulates two collab peers, no server needed)
const ydocA = new Y.Doc()
const ydocB = new Y.Doc()

ydocA.on('update', update => Y.applyUpdate(ydocB, update))
ydocB.on('update', update => Y.applyUpdate(ydocA, update))

const EditorPane = ({ label, ydoc, showInjectButton }) => {
  const [log, setLog] = useState([])
  const [errorBanner, setErrorBanner] = useState(null)
  const editorRef = useRef(null)

  const addLog = useCallback(msg => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }, [])

  const editor = useEditor({
    extensions: [Document, Paragraph, Text, Collaboration.configure({ document: ydoc })],
    enableContentCheck: true,
    onContentError: ({ error, disableCollaboration }) => {
      addLog(`❌ contentError fired: ${error.message}`)
      setErrorBanner(`Content Error: ${error.message}`)
      disableCollaboration()
      addLog('🔒 Collaboration disabled, editor protected')
    },
  })

  editorRef.current = editor

  const injectCorruptTransaction = useCallback(() => {
    if (!editor) {return}

    addLog('⚡ Injecting corrupt Yjs-origin transaction...')

    const tr = editor.state.tr.insertText('💀 CORRUPT CONTENT 💀', 1)

    tr.setMeta(ySyncPluginKey, { isChangeOrigin: true })

    // Simulate what happens when y-prosemirror produces content that fails doc.check()
    // (e.g., due to a CRDT merge bug or schema mismatch)
    const originalCheck = tr.doc.check.bind(tr.doc)

    tr.doc.check = () => {
      throw new RangeError('Invalid content for node doc: concurrent CRDT merge produced invalid structure')
    }

    try {
      editor.view.dispatch(tr)
      addLog('⚠️ Transaction was ACCEPTED — editor is now corrupt!')
    } catch (e) {
      addLog(`💥 Dispatch threw: ${e.message}`)
    }

    // Check final state
    try {
      originalCheck()
      addLog(`📄 Editor content: "${editor.getText()}"`)
    } catch {
      addLog('🔴 Editor doc is INVALID')
    }
  }, [editor, addLog])

  const injectValidYjsTransaction = useCallback(() => {
    if (!editor) {return}

    addLog('✅ Injecting valid Yjs-origin transaction...')

    const tr = editor.state.tr.insertText('synced text ', 1)

    tr.setMeta(ySyncPluginKey, { isChangeOrigin: true })

    // doc.check() passes normally — this should go through
    try {
      editor.view.dispatch(tr)
      addLog(`📄 Transaction accepted. Content: "${editor.getText()}"`)
    } catch (e) {
      addLog(`💥 Dispatch threw: ${e.message}`)
    }
  }, [editor, addLog])

  if (!editor) {return null}

  return (
    <div className="editor-pane">
      <h3>{label}</h3>

      {errorBanner && (
        <div className="error-banner">
          {errorBanner}
          <br />
          <small>Collaboration disabled. Editor is read-only for Yjs sync.</small>
        </div>
      )}

      <EditorContent editor={editor} className="editor-content" />

      {showInjectButton && (
        <div className="button-row">
          <button className="btn-corrupt" onClick={injectCorruptTransaction}>
            Inject Corrupt Transaction
          </button>
          <button className="btn-valid" onClick={injectValidYjsTransaction}>
            Inject Valid Transaction
          </button>
        </div>
      )}

      <div className="log-panel">
        <strong>Log:</strong>
        {log.length === 0 && <div className="log-empty">No events yet. Click a button above.</div>}
        {log.map((entry, i) => (
          <div key={i} className="log-entry">
            {entry}
          </div>
        ))}
      </div>
    </div>
  )
}

const App = () => {
  return (
    <div className="demo-container">
      <div className="demo-header">
        <h2>F1 Bug Reproduction: beforeTransaction Return Value Ignored</h2>
        <p>
          The left editor has <code>enableContentCheck: true</code>. Click &quot;Inject Corrupt Transaction&quot; to
          simulate a Yjs sync that produces invalid ProseMirror content.
        </p>
        <p>
          <strong>On main (buggy):</strong> the corrupt text appears in the editor.
          <br />
          <strong>On fix branch:</strong> <code>filterTransaction</code> rejects it, fires <code>contentError</code>,
          and disables collaboration.
        </p>
      </div>

      <div className="editors-row">
        <EditorPane label="Editor (enableContentCheck: true)" ydoc={ydocA} showInjectButton />
        <EditorPane label="Peer Editor (sync target)" ydoc={ydocB} showInjectButton={false} />
      </div>
    </div>
  )
}

export default App
