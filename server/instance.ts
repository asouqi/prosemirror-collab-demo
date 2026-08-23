import { Step } from "prosemirror-transform"
import { Node } from "prosemirror-model"
import { schema } from "../shared/schema"

export interface StoredStep {
    step: Step
    clientId: string
}

const MAX_STEP_HISTORY = 1000

export class Instance {
    doc: Node
    version = 0
    steps: StoredStep[] = []

    constructor(doc?: Node) {
        this.doc = doc ?? schema.nodes.doc.create(null, [
            schema.nodes.paragraph.create(null, [
                schema.text('This is a collaborative demo document.')
            ])
        ])
    }

    checkVersion(version: number) {
        if (version < 0 || version > this.version) {
            const error: any = new Error(`Invalid version ${version}`)
            error.status = 400
            throw error
        }
    }

    /**
     * a client submits steps along with version it based them on.
     * we only accept steps if that version is still current otherwise
     * we return false and the client must fetch what it missed(via getEventsSince) and
     * rebase before retrying.
     */
    addSteps(version: number, steps: Step[], clientId: string) {
        this.checkVersion(version)
        if (this.version !== version) return false

        let doc = this.doc
        steps.forEach(step => {
            const result = step.apply(doc)
            if (!result.doc) {
                const error: any = new Error(result.failed || 'Step failed to apply')
                error.status = 400
                throw error
            }
            doc = result.doc
        })

        this.doc = doc
        this.version += steps.length
        this.steps = this.steps.concat(steps.map(step => ({ step, clientId })))

        if (this.steps.length > MAX_STEP_HISTORY) {
            this.steps.slice(this.steps.length = MAX_STEP_HISTORY)
        }

        return { version: this.version }
    }

    /**
     * Used both by the client that are polling for updates, and by a client
     * whose submission was rejected and needs to catch up before retrying.
     */
    getEventsSince(version: number) {
        this.checkVersion(version)

        const startIndex = this.steps.length - (this.version - version)

        if (startIndex < 0) return false

        const slice = this.steps.slice(startIndex)
        return {
            steps: slice.map(({ step }) => step),
            clientIds: slice.map(({ clientId }) => clientId)
        }
    }
}

/** For this learning demo we only ever have one document instance, which
 *  focused on the version/step/rebase mechanics rather than multi-document management*/
export const instance = new Instance()
