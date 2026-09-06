# How prosemirror-collab works in this demo

## The core idea

There is **one authority**: the server. It owns the canonical `version` number
and the canonical document. Every client is just a local replica that:

1. Applies its own edits **optimistically** (instantly, locally).
2. Sends those edits to the server as a list of **steps** tagged with the
   `version` they were based on.
3. If the server's version has moved on since then (someone else committed
   first), the client's steps are rejected. The client must fetch what it
   missed, **rebase** its own pending steps on top, and retry.

`prosemirror-collab` (the plugin) is what tracks "which of my local steps are
still unconfirmed" and does the rebasing math for you via
`sendableSteps` / `receiveTransaction` / `getVersion`.

## Sequence diagram: two clients editing concurrently

```mermaid
sequenceDiagram
    participant A as Client A (connection.ts)
    participant S as Server (server.ts + instance.ts)
    participant B as Client B (connection.ts)

    A->>S: GET /doc
    S-->>A: { doc, version: 5 }
    B->>S: GET /doc
    S-->>B: { doc, version: 5 }

    Note over A,B: Both clients now poll long-lived GET /events?version=5

    A->>A: user types -> local step, version still 5 (unconfirmed)
    A->>S: POST /events { version:5, steps:[s1], clientID:A }
    S->>S: instance.addSteps(5, [s1], A) -> version becomes 6
    S-->>A: 200 { version: 6 }
    S->>S: notifyWaiters() wakes pending /events polls

    Note over A: receiveTransaction() marks s1 as confirmed

    B->>B: user types -> local step, version still 5 (unconfirmed)
    B->>S: POST /events { version:5, steps:[s2], clientID:B }
    S->>S: checkVersion: instance.version(6) != 5 -> reject
    S-->>B: 409 conflict

    Note over B: B does nothing yet - the in-flight /events long-poll<br/>will bring s1 down next

    S-->>B: (long-poll resolves) { version:6, steps:[s1], clientIDs:[A] }
    B->>B: receiveTransaction(s1) -> rebases B's pending s2 on top of s1
    B->>S: POST /events { version:6, steps:[s2'], clientID:B }
    S->>S: addSteps(6, [s2'], B) -> version becomes 7
    S-->>B: 200 { version: 7 }
    S-->>A: (long-poll resolves) { version:7, steps:[s2'], clientIDs:[B] }
    A->>A: receiveTransaction(s2') applied locally

    Note over A,B: Both clients converge on the same document at version 7
```

## State machine: the client's `loop()`

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> CheckSendable: loop() called (after dispatch or previous cycle)
    CheckSendable --> Sending: sendableSteps() has pending local steps
    CheckSendable --> Polling: nothing to send

    Sending --> Confirmed: 200 OK\nreceiveTransaction(own steps)
    Sending --> Conflict: 409\n(do nothing, wait for poll)
    Sending --> Stale: 400\n(full reload via start())

    Polling --> AppliedRemote: steps arrived\nreceiveTransaction(remote steps)
    Polling --> NoChange: 30s timeout, empty response
    Polling --> Stale: non-OK (e.g. 410 history pruned)

    Confirmed --> Idle
    Conflict --> Idle
    AppliedRemote --> Idle
    NoChange --> Idle
    Stale --> [*]: start() re-fetches /doc from scratch

    Idle --> [*]: (loop always re-enters itself)
```

## Key pieces and where they live

| Concept | Client | Server |
|---|---|---|
| Canonical version | tracked via `getVersion(state)` (plugin-managed) | `instance.version` |
| Pending/unconfirmed steps | tracked via `sendableSteps(state)` (plugin-managed) | n/a (server has no concept of "pending") |
| Rebasing | `receiveTransaction(state, steps, clientIDs)` | n/a — server never rebases, it only accepts-or-rejects |
| History for catch-up | n/a (client only holds current state) | `instance.steps` (capped at `MAX_STEP_HISTORY`) |
| Conflict resolution | retry loop: reject → poll → rebase → resend | reject via `409` if `version !== instance.version` |
| "I've fallen too far behind" | `start()` does a full reload | `410` when `getEventsSince` can't find `startIndex >= 0` |

## Why rebasing works safely

Each step operates on document *positions*. `receiveTransaction` doesn't just
concatenate steps — it maps your own not-yet-confirmed steps forward through
whatever remote steps just arrived, using ProseMirror's `Step.map`/transform
mapping, so insert/delete offsets stay correct even though the document
changed underneath them. This is the same mechanism described in
[Marijn Haverbeke's Collaborative Editing post](https://marijnhaverbeke.nl/blog/collaborative-editing.html).