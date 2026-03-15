import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

describe('UndoManager view destroy/recreate lifecycle', () => {
  let editor: Editor
  let ydoc: Y.Doc
  const editorEls: Element[] = []

  afterEach(() => {
    editor?.destroy()
    ydoc?.destroy()
    editorEls.forEach(el => el.remove())
    editorEls.length = 0
  })

  function makeEl() {
    const el = document.createElement('div')

    document.body.appendChild(el)
    editorEls.push(el)
    return el
  }

  function createEditor(doc: Y.Doc) {
    return new Editor({
      element: makeEl(),
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: doc })],
    })
  }

  function getUndoManager(e: Editor) {
    return yUndoPluginKey.getState(e.state).undoManager
  }

  function getObserverCount(undoManager: any, name: string): number {
    // eslint-disable-next-line no-underscore-dangle
    const set = undoManager._observers.get(name)

    return set ? set.size : 0
  }

  function insertGapParagraph(doc: Y.Doc, text: string) {
    doc.transact(() => {
      const p = new Y.XmlElement('paragraph')

      p.insert(0, [new Y.XmlText(text)])
      doc.getXmlFragment('default').insert(0, [p])
    }, ySyncPluginKey)
  }

  it('should preserve undo tracking after view destroy/recreate', () => {
    ydoc = new Y.Doc()
    editor = createEditor(ydoc)

    editor.commands.insertContent('hello')
    const undoManager = getUndoManager(editor)

    expect(undoManager.undoStack.length).toBeGreaterThan(0)

    editor.view.destroy()

    expect(undoManager.trackedOrigins.has(undoManager)).toBe(true)

    // Force a new capture group so the gap transaction creates a new stack item
    // (otherwise it merges into the previous one within captureTimeout).
    undoManager.stopCapturing()
    const undoStackBefore = undoManager.undoStack.length

    insertGapParagraph(ydoc, 'gap-text')

    expect(undoManager.undoStack.length).toBeGreaterThan(undoStackBefore)
  })

  it('should not accumulate stale listeners after destroy/recreate', () => {
    ydoc = new Y.Doc()
    editor = createEditor(ydoc)

    const initialUndoManager = getUndoManager(editor)
    const initialAddedCount = getObserverCount(initialUndoManager, 'stack-item-added')
    const initialPoppedCount = getObserverCount(initialUndoManager, 'stack-item-popped')

    expect(initialAddedCount).toBeGreaterThan(0)
    expect(initialPoppedCount).toBeGreaterThan(0)

    editor.view.destroy()

    expect(getObserverCount(initialUndoManager, 'stack-item-added')).toBe(0)
    expect(getObserverCount(initialUndoManager, 'stack-item-popped')).toBe(0)

    editor = createEditor(ydoc)
    const newUndoManager = getUndoManager(editor)

    expect(getObserverCount(newUndoManager, 'stack-item-added')).toBe(initialAddedCount)
    expect(getObserverCount(newUndoManager, 'stack-item-popped')).toBe(initialPoppedCount)
  })

  it('should capture Yjs transactions during the gap on the undo stack', () => {
    ydoc = new Y.Doc()
    editor = createEditor(ydoc)

    const undoManager = getUndoManager(editor)

    editor.view.destroy()

    const stackBefore = undoManager.undoStack.length

    insertGapParagraph(ydoc, 'during-gap')

    expect(undoManager.undoStack.length).toBeGreaterThan(stackBefore)
  })

  it('should work correctly through multiple destroy/recreate cycles', () => {
    ydoc = new Y.Doc()
    editor = createEditor(ydoc)

    for (let i = 0; i < 3; i += 1) {
      editor.view.destroy()
      editor = createEditor(ydoc)
    }

    const undoManager = getUndoManager(editor)

    expect(undoManager.trackedOrigins.has(undoManager)).toBe(true)

    editor.commands.insertContent('after-cycles')
    expect(undoManager.undoStack.length).toBeGreaterThan(0)

    const result = editor.commands.undo()

    expect(result).toBe(true)
  })

  it('should not leak afterTransactionHandler on permanent editor destruction', () => {
    ydoc = new Y.Doc()
    editor = createEditor(ydoc)

    const undoManager = getUndoManager(editor)

    editor.destroy()

    expect(undoManager.trackedOrigins.has(undoManager)).toBe(false)

    const stackBefore = undoManager.undoStack.length

    insertGapParagraph(ydoc, 'after-destroy')

    expect(undoManager.undoStack.length).toBe(stackBefore)
  })

  it('unmount → gap insert → remount → undo works end-to-end', () => {
    ydoc = new Y.Doc()

    editor = new Editor({
      element: makeEl(),
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: ydoc })],
      content: '<p>initial</p>',
    })

    editor.commands.insertContent('hello')
    const um = getUndoManager(editor)

    expect(um.undoStack.length).toBeGreaterThan(0)

    editor.unmount()
    expect(um.trackedOrigins.has(um)).toBe(true)

    insertGapParagraph(ydoc, 'gap text')

    editor.mount(makeEl())

    const undoResult = editor.commands.undo()

    expect(undoResult).toBe(true)
  })

  it('unmount → remount → undo works without gap transaction', () => {
    ydoc = new Y.Doc()

    editor = new Editor({
      element: makeEl(),
      extensions: [Document, Paragraph, Text, Collaboration.configure({ document: ydoc })],
      content: '<p>initial</p>',
    })

    editor.commands.insertContent('hello')

    editor.unmount()
    editor.mount(makeEl())

    const undoResult = editor.commands.undo()

    expect(undoResult).toBe(true)
  })
})
