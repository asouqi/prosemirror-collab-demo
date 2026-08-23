# prosemirror-collab-demo

A small, heavily-commented, from-scratch demo for learning how ProseMirror's
collaborative editing model works: a **central authority server**, **steps**
as atomic edits, and **rebasing** to reconcile concurrent changes.

## Why this exists

The goal isn't to build a production-ready collaborative editor — it's to
strip the [official ProseMirror collab example](https://github.com/ProseMirror/website/tree/master/src/collab)
down to the smallest possible version (one document, no comments, no auth,
no persistence) so the **version / steps / rebase** flow is easy to see and
reason about.

Background reading: [Marijn Haverbeke's "Collaborative Editing" post](https://marijnhaverbeke.nl/blog/collaborative-editing.html).
