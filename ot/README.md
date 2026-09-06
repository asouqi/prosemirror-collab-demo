# A minimal, standalone Operational Transformation (OT) implementation 
with no  ProseMirror, no server, no client — just plain text and two operations
(`insert`, `delete`). The goal is to make the *core idea* of OT concrete
and debuggable, separate from the production-grade machinery ProseMirror
uses for rich documents.

Background reading: [Marijn Haverbeke's "Collaborative Editing"](https://marijnhaverbeke.nl/blog/collaborative-editing.html)
and its follow-up ["Collaborative Editing in CodeMirror"](https://marijnhaverbeke.nl/blog/collaborative-editing-cm.html).

## The idea

Two clients start from the same document and independently produce operations
`A` and `B`. Each client applies its own operation immediately (optimistic
local edit), then needs to incorporate the other's operation. But it can't
just reapply the other operation's raw positions — the document has moved
underneath it. So it must **transform** the incoming operation against the
one it already applied, adjusting positions so the *intent* is preserved.


The convergence property this guarantees:
``
apply(apply(doc, A), transform(A, B)) === apply(apply(doc, B), transform(B, A))
``

In words: no matter which client applies which operation first, both
clients converge on the exact same final document.
