import express from "express"
import { Step } from "prosemirror-transform"
import { schema } from "../shared/schema"
import { instance } from "./instance"
import * as process from "node:process";

const app = express()

app.use(express.json())
app.use(express.static('public'))

/** Long-poll bookkeeping: requests waiting for a new version to appear */
type Waiter = {
    resolve: () => void
}

let waiting: Waiter[] = []

function notifyWaiters() {
    waiting.forEach(w => w.resolve())
    waiting = []
}

/** GET /doc initial load: current document + version */
app.get('/doc', (_req, res) => {
    res.json({ doc: instance.doc.toJSON(), version: instance.version })
})

/** GET /events?version=N long-poll for steps since version N. if steps are already available,
 * respond immediately; otherwise wait (up to a timeout) for the next addSteps() call to happen.*/
app.get('/events', async (req, res) => {
    const version = Number(req.query.version)
    try {
        let data = instance.getEventsSince(version)
        if (!data) {
            /** Client is too far behind (we have pruned that history)
             * client needs to do a full reload instead of trying to catch up incrementally*/
            res.status(410).json({ error: "history no longer available"})
            return
        }

        if(data.steps.length === 0) {
            await new Promise<void>(resolve => {
                const timer = setTimeout(resolve, 30000)
                waiting.push({ resolve: () => {
                    clearTimeout(timer)
                    resolve()
                }})
            })
            data = instance.getEventsSince(version) || { steps: [], clientIDs: [] }
        }

        res.json({
            version: instance.version,
            steps: data.steps.map((s) => s.toJSON()),
            clientIDs: data.clientIDs
        })
    } catch (err: any) {
        res.status(err.status || 500).json({ error: err.message })
    }
})

/** POST /events a client submitting its local steps.
 * Body: { version, steps: JSON[], clientID } */
app.post('/events', (req, res) => {
    const { version, steps: stepsJson, clientID } = req.body

    try {
        const steps = (stepsJson as any[]).map(s => Step.fromJSON(schema, s))
        const result = instance.addSteps(version, steps, clientID)
        if(!result) {
            /** version conflict: someone commited first. client must poll /events, rebase its pending steps
             * over what it gets back, and resubmit */
            res.status(409).json({ error: "version conflict, please rebase and retry"})
            return
        }
        notifyWaiters()
        res.json(result)
    } catch (err: any) {
        res.status(err.status || 500).json({ error: err.message })
    }
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`)
})