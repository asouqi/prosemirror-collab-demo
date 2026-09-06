import { Op } from "./ops"

/**
 * transform(a, b) returns a new version of `b` that is safe to apply
 * after `a` has already been applied to the document, while preserving
 * b's original editing intent.
 */
export function transform(a: Op, b: Op): OP {
    if ((a.type === "insert" && b.type === "insert") ||
        (a.type === "insert" && b.type === "delete")) {
        if (a.pos <= b.pos) {
            // a inserted at or before b position -> shift b forward
            return {...b, pos: b.pos + a.text.length }
        } else {
            return b // b is unaffected
        }
    }

    if (a.type === "delete" && b.type === "insert") {
        if (a.pos + a.length <=b.pos) {
            // a deleted a range that is entirely before b -> shift b back
            return {...b, pos: b.pos - a.length }
        }
        if (a.pos >= b.pos) {
            // a deletion start at or after b insert point -> b unaffected
            return b
        }
        // b insert point falls inside a deleted range -> clamp to a.pos
        return {...b, pos: a.pos }
    }

    // a.type === "delete" && b.type === "delete"
    const del_a = a as Extract<Op, {type: "delete"}>
    const del_b = b as Extract<Op, {type: "delete"}>

    if (del_a.pos + del_a.length <= del_b.pos) {
        // a is entirely before b -> shift b back
        return {...del_b, pos: del_b.pos - del_a.length }
    }
    if (del_a.pos >= del_b.pos + del_b.length) {
        // a is entirely after b -> b unaffected
        return del_b
    }

    /** overlapping deletes -> shrink b to only the part that
     *  doesn't overlap with what a already removed */
    const overlapStart = Math.max(del_a.pos, del_b.pos)
    const overlapEnd = Math.min(del_a.pos + del_a.length, del_b.pos + del_b.length)
    const overlap = Math.max(0, overlapEnd - overlapStart)

    return {
        type: "delete",
        pos: Math.min(del_a.pos, del_b.pos),
        length: del_b.length - overlap
    }
}