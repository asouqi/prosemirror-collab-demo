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
    /** true whenever a poll or a send is in flight */
    private busy = false

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
        this.loop()
    }

    /** Called by the editor whenever user or remote update changes the document */
    dispatch(tr: Transaction) {
        if (!this.state) return
        this.state = this.state.apply(tr)
        this.emit()
        /** don't call trySend() directly so the single loop decide whether to send or
         * poll next, * so we never have both in fight at once */
        if (!this.busy) this.loop()
    }

    /**
     * The one place that decides what to do next:
     * either there are unconfirmed local steps to send
     * or there's nothing to send and we should long-poll for remote updates.
     */
    private async loop() {
        if (this.busy || !this.state) return
        this.busy = true
        try {
            const sandable = sendableSteps(this.state)
            if (sandable) {
                await this.send(sandable)
            } else {
                await this.poll()
            }
        } finally {
            this.busy = false
            this.loop()
        }
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
            if (!res.ok) {
                await this.start()
                return
            }

            const data = await res.json()
            if (data.steps.length > 0) {
                const steps = data.steps.map((s: any) => Step.fromJSON(schema, s))
                const tr = receiveTransaction(this.state, steps, data.clientIDs)
                this.state = this.state.apply(tr)
                this.emit()
            }
        } catch (e) {
            /** Network hiccup — brief backoff, then keep polling. */
            await new Promise(r => setTimeout(r, 1000))
        }
    }

    /**
     * Submit any unconfirmed local steps. if the server rejects with 409(version conflict),
     * we do nothing here as the next poll() response will bring in the steps we were missing, rebase our
     * pending once via receiveTransaction, and then trySend() gets called again to retry.
     */
    private async send(sandable: ReturnType<typeof sendableSteps>) {
        if (!sandable || !this.state) return

        try {
            const res = await fetch(`${this.url}/events`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    steps: sandable.steps.map(s => s.toJSON()),
                    version: sandable.version,
                    clientID: sandable.clientID
                })
            })

            /** Conflict: leave it to the next poll() to fetch+rebase, then trySend will be invoked again automatically */
            if (res.status === 409) {
                return
            }
            /** stale — loop() will poll next and pick up what we missed */
            if (res.status === 400) {
                await this.start()
                return
            }

            if (!res.ok) throw new Error(`submit failed: ${res.status}`)

            /** Success: mark those steps as confirmed by receiving them back through
             * receiveTransaction(with our own clientID repeated) exactly like the server now has them recorded */
            const clientIDs = sandable.steps.map(() => sandable.clientID)
            const tr = receiveTransaction(this.state, sandable.steps, clientIDs)
            this.state = this.state.apply(tr)
            this.emit()
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000))
        }
    }
}