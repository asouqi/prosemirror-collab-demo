import { EditorState, Transaction } from "prosemirror-state"
import { Step } from "prosemirror-transform"
import { collab, receiveTransaction, sendableSteps, getVersion } from "prosemirror-collab"
import { schema } from "../shared/schema"

type Listener = (state: EditorState) => void

/**
 * Wraps version/steps/rebase protocol so index.ts can stay focused on editor itself.
 * This is the client-side mirror of server/instance.ts: the server is
 * the single authority on ordering, this class is what reconciles our local edits against the authority.
 */
export class Connection {
    state: EditorState | null = null
    private listener: Listener | null = null
    private sendingSteps = false

    constructor(private url: string) {}

    onUpdate(listener: Listener) {
        this.listener = listener
    }

    private emit() {
        if (this.state && this.listener) {
            this.listener(this.state)
        }
    }

    /**
     * Initial load: fetch doc + version, to build editor state with the
     * collab plugin attached, then start long-polling for updates.
     */
    async start() {
        const res = await fetch(`${this.url}/doc`)
        const data = await res.json()
        const doc = schema.nodeFromJSON(data.doc)

        this.state = EditorState.create({
            doc,
            plugins: [collab({ version: data.version })]
        })
        this.emit()
        this.poll()
    }

    /** Called by the editor whenever user or remote update changes the document */
    dispatch(tr: Transaction) {
        if (!this.state) return
        this.state = this.state.apply(tr)
        this.emit()
        this.trySend()
    }

    /**
     * Long-poll: ask the server for anything newer than our current version.
     * when something comes back, apply it via receiveTransaction(this is what
     * rebases our own in-flight unconfirmed steps, if any over the newly-arrived remote
     * steps) and immediately poll again.
     */
    private async poll() {
        if (!this.state) return
        const version = getVersion(this.state)
        try {
            const res = await fetch(`${this.url}/events?version=${version}`)

            /** we fell to far behind, we need to fully reload instead of incremental catch-up */
            if (res.status === 409) {
                await this.start()
                return
            }

            const data = await res.json()
            if (data.steps.length > 0) {
                const steps = data.steps.map((s: any) => Step.fromJSON(schema, s))
                const tr = receiveTransaction(this.state, steps, data.clientIds)
                this.state = this.state.apply(tr)
                this.emit()
                this.trySend() // remote steps may have unblocked a pending local send
            }
        } catch (e) {
            /** Network hiccup — brief backoff, then keep polling. */
            await new Promise(r => setTimeout(r, 1000))
        }
        this.poll()
    }

    /**
     * Submit any unconfirmed local steps. if the server rejects with 409(version conflict),
     * we do nothing here as the next poll() response will bring in the steps we were missing, rebase our
     * pending once via receiveTransaction, and then trySend() gets called again to retry.
     */
    private async trySend() {
        if (this.sendingSteps || !this.state) return

        const sandable = sendableSteps(this.state)

        if (!sandable) return

        this.sendingSteps = true
        try {
            const res = await fetch(`${this.url}/events`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    steps: sandable.steps.map(s => s.toJSON()),
                    version: sandable.version,
                    clientId: sandable.clientID
                })
            })

            /** Conflict: leave it to the next poll() to fetch+rebase, then trySend will be invoked again automatically */
            if (res.status === 409) {
                return
            }

            if (!res.ok) throw new Error(`submit failed: ${res.status}`)

            //

            // Success: mark those steps as confirmed by receiving them back
            // through receiveTransaction (with our own clientID repeated),
            // exactly like the server now has them recorded.

            /** Success: mark those steps as confirmed by receiving them back through
             * receiveTransaction(with our own clientId repeated) exactly like the server now has them recorded */
            const clientIds = sandable.steps.map(() => sandable.clientID)
            const tr = receiveTransaction(this.state, sandable.steps, clientIds)
            this.state = this.state.apply(tr)
            this.emit()
        } finally {
            this.sendingSteps = false
            /** In case more local edits queued up while we were sending */
            this.trySend()
        }
    }
}