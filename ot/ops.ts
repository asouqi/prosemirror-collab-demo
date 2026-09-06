export type InsertOp = { type: "insert", pos: number, text: string }
export type DeleteOp = { type: "delete", pos: number, length: number }
export type Op = InsertOp | DeleteOp

/** apply a single operation to a plain string document */
export const apply = (doc: string, op: Op) => {
    if (op.type === "insert") {
        return doc.slice(0, op.pos) + op.text + doc.slice(op.pos)
    } else {
        return doc.slice(0, op.pos) + doc.slice(op.pos + op.length)
    }
}