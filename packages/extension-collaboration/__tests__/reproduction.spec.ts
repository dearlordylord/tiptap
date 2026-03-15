import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import Collaboration from '../src/index.js'

describe('F1 bug reproduction: beforeTransaction return value ignored by Yjs', () => {
  /**
   * Part 1: Prove that Yjs ignores beforeTransaction return values.
   * This is the root cause of the bug.
   */
  it('Yjs ignores beforeTransaction return value (root cause)', () => {
    const ydoc = new Y.Doc()
    const fragment = ydoc.getXmlFragment('test')

    let handlerCalled = false

    ydoc.on('beforeTransaction', () => {
      handlerCalled = true
      return false // attempt to prevent the transaction
    })

    ydoc.transact(() => {
      const para = new Y.XmlElement('paragraph')

      para.insert(0, [new Y.XmlText('should not exist')])
      fragment.insert(0, [para])
    })

    expect(handlerCalled).toBe(true)
    // BUG: return false was ignored — the transaction applied anyway
    expect(fragment.length).toBe(1)
  })

  /**
   * Part 2: Full pipeline — dispatch a Yjs-origin transaction through the editor.
   *
   * y-prosemirror's own validation catches most invalid content before it reaches
   * filterTransaction. But if y-prosemirror ever has a bug or concurrent CRDT
   * merges produce invalid state, our filterTransaction is the last line of defense.
   *
   * We simulate this by dispatching a transaction with ySyncPluginKey meta
   * and a doc that fails check().
   *
   * On main (buggy): filterTransaction always returns true → editor gets corrupt content.
   * On fix branch: filterTransaction calls doc.check(), catches error, returns false.
   */
  let editor: Editor | null = null
  let el: HTMLElement | null = null

  afterEach(() => {
    editor?.destroy()
    el?.remove()
    editor = null
    el = null
  })

  it('filterTransaction rejects Yjs transaction with invalid content (full pipeline)', async () => {
    const ydoc = new Y.Doc()

    el = document.createElement('div')
    document.body.appendChild(el)

    let contentErrorFired = false

    editor = new Editor({
      element: el,
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: ydoc })],
      enableContentCheck: true,
      onContentError: () => {
        contentErrorFired = true
      },
    })

    await new Promise<void>(resolve => {
      setTimeout(resolve, 50)
    })

    const docBefore = editor.state.doc.toJSON()

    // Simulate what happens when y-prosemirror produces a transaction
    // with content that fails doc.check() (e.g., due to a CRDT merge bug)
    const tr = editor.state.tr.insertText('corrupt', 1)

    tr.setMeta(ySyncPluginKey, { isChangeOrigin: true })

    vi.spyOn(tr.doc, 'check').mockImplementation(() => {
      throw new RangeError('Invalid content for node doc')
    })

    // Dispatch through the full editor pipeline (not calling filterTransaction directly)
    editor.view.dispatch(tr)

    // On fix branch: transaction was rejected, editor unchanged
    expect(editor.state.doc.toJSON()).toEqual(docBefore)
    expect(contentErrorFired).toBe(true)

    // On main (buggy): this would FAIL because:
    //   - filterTransaction always returns true
    //   - The transaction applies, inserting 'corrupt' into the editor
    //   - contentErrorFired would be false (contentError emitted from beforeTransaction,
    //     but only for pre-tx state and return value is ignored anyway)
  })
})
