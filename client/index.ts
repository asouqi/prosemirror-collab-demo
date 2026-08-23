import { EditorView } from "prosemirror-view"
import { exampleSetup } from "prosemirror-example-setup"
import { schema } from "../shared/schema"
import { Connection } from "./connection"

const connection = new Connection("http://localhost:3000")

let view: EditorView | null = null

connection.start()

connection.onUpdate(state => {
    if (view) {
        view.updateState(state)
    } else {
        view = new EditorView(document.querySelector("#editor"), {
            state,
            dispatchTransaction: (tr) => connection.dispatch(tr)
        })
    }
})