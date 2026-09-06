import {InsertOp, Op} from "./ops"

/**
 * Decides which of two inserts at the same position gets
 * the left slot.
 * Must be antisymmetric: winsLeft(a, b) === !winsLeft(b, a)
 * whenever the two ops are distinguishable. Falls back to comparing
 * without a site id still converge (identical text at an identical
 */
function winsLeft(a: InsertOp, b: InsertOp) {
    if (a.site !== undefined && b.site !== undefined && a.site !== b.site) {
        return a.site < b.site
    }
    return a.text < b.text
}

/** A zero-length delete is a no-op; drop it rather than emitting it. */
function del(pos: number, length: number): Op[] {
    return length > 0 ? [{ type: "delete", pos, length }] : []
}


/**
 * transform(a, b) returns a *list* of operations equivalent to `b`, safe to
 * apply in order after `a` has already been applied, preserving b's intent.
 *
 * A list is required because one concurrent edit can split another in two:
 * an insert landing inside a deleted range leaves the delete with a gap.
 * The list is also how a no-op is expressed (empty array).
 */
export function transform(a: Op, b: Op): Op[] {
    if (a.type === "insert" && b.type === "insert") {
        // a inserted at or before b position -> shift b forward
        if (a.pos < b.pos) return [{ ...b, pos: b.pos + a.text.length }]
        if (a.pos > b.pos) return [b]
        // tie: only shift b if a claimed the left slot
        return winsLeft(a, b) ? [{ ...b, pos: b.pos + a.text.length }] : [b]
    }

    if (a.type === "insert" && b.type === "delete") {
        if (a.pos <= b.pos) {
            // a landed at or before b's range -> shift the whole range right
            return [{...b, pos: b.pos + a.text.length }]
        }
        if (a.pos >= b.pos + b.length) {
            return [b]
        }
        // a landed strictly inside b's range -> split b around the new text.
        // After the left half is removed a's text sits at b.pos
        const leftLen = a.pos - b.pos
        return [
            ...del(b.pos, leftLen),
            ...del(b.pos + a.text.length, b.length - leftLen)
        ]
    }

    if (a.type === "delete" && b.type === "insert") {
        // a removed a range entirely before b -> shift b back
        if (a.pos + a.length <= b.pos) return [{ ...b, pos: b.pos - a.length }]
        if (a.pos >= b.pos) {
            // a's range starts at or after b's insert point -> b unaffected
            return [b]
        }
        // b's insert point fell inside a's removed range -> clamp to a.pos.
        // (The mirror case above splits, so the text survives on both paths.)
        return [{ ...b, pos: a.pos }]
    }

    // a.type === "delete" && b.type === "delete"
    const del_a = a as Extract<Op, {type: "delete"}>
    const del_b = b as Extract<Op, {type: "delete"}>

    if (del_a.pos + del_a.length <= del_b.pos) {
        // a is entirely before b -> shift b back
        return [{...del_b, pos: del_b.pos - del_a.length }]
    }
    if (del_a.pos >= del_b.pos + del_b.length) {
        // a is entirely after b -> b unaffected
        return [del_b]
    }

    /** overlapping deletes -> shrink b to only the part that
     *  doesn't overlap with what a already removed */
    const overlapStart = Math.max(del_a.pos, del_b.pos)
    const overlapEnd = Math.min(del_a.pos + del_a.length, del_b.pos + del_b.length)
    const overlap = Math.max(0, overlapEnd - overlapStart)

    return [{
        type: "delete",
        pos: Math.min(del_a.pos, del_b.pos),
        length: del_b.length - overlap
    }]
}