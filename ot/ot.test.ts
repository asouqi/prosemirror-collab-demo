import { describe, it, expect } from "vitest"
import { apply, Op } from "./ops"
import { transform } from "./transform"

const applyAll = (doc: string, ops: Op[]) => ops.reduce(apply, doc)

/**
 * The core OT convergence property:
 *
 *   apply(apply(doc, A), transform(A, B)) === apply(apply(doc, B), transform(B, A))
 *
 * No matter which of two concurrent operations is applied first, both
 * clients must end up with the exact same final document once they've
 * incorporated (a transformed version of) the other's operation.
 */
function assertConverges(doc: string, A: Op, B: Op) {
    const path1 = applyAll(apply(doc, A), transform(A, B))
    const path2 = applyAll(apply(doc, B), transform(B, A))
    expect(path1).toBe(path2)
    return path1
}

describe("OT convergence", () => {
    it("insert + delete of a later, unrelated word", () => {
        const doc = "Hello world"
        const A: Op = { type: "insert", pos: 6, text: "cruel " }
        const B: Op = { type: "delete", pos: 6, length: 5 } // deletes "world"

        const result = assertConverges(doc, A, B)
        expect(result).toBe("Hello cruel ")
    })

    it("two inserts at different positions", () => {
        const doc = "Hello world"
        const A: Op = { type: "insert", pos: 0, text: ">> " }
        const B: Op = { type: "insert", pos: 11, text: "!" }

        const result = assertConverges(doc, A, B)
        expect(result).toBe(">> Hello world!")
    })

    it("two inserts at the exact same position (tie-break: a wins the left slot)", () => {
        const doc = "Hello world"
        const A: Op = { type: "insert", pos: 6, text: "big " }
        const B: Op = { type: "insert", pos: 6, text: "cruel " }

        // Both are valid convergent outcomes as long as A and B agree
        // consistently -- our transform() rule is "a.pos <= b.pos shifts b",
        // so ties always favor `a` being written first.
        const result = assertConverges(doc, A, B)
        expect(result).toBe("Hello big cruel world")
    })

    it("delete that fully contains another delete", () => {
        const doc = "Hello wonderful world"
        const A: Op = { type: "delete", pos: 6, length: 16 } // deletes "wonderful world"
        const B: Op = { type: "delete", pos: 6, length: 10 } // deletes "wonderful "

        const result = assertConverges(doc, A, B)
        expect(result).toBe("Hello ")
    })

    it("overlapping deletes with partial overlap", () => {
        const doc = "Hello wonderful world"
        const A: Op = { type: "delete", pos: 6, length: 10 } // deletes "wonderful "
        const B: Op = { type: "delete", pos: 10, length: 8 } // deletes "erful wo"

        const result = assertConverges(doc, A, B)
        expect(result).toBe("Hello rld")
    })

    it("insert landing exactly at the boundary of a delete range", () => {
        const doc = "Hello world"
        const A: Op = { type: "delete", pos: 6, length: 5 } // deletes "world"
        const B: Op = { type: "insert", pos: 11, text: "!" } // right after "world"

        const result = assertConverges(doc, A, B)
        expect(result).toBe("Hello !")
    })

    it("insert landing inside a delete range gets clamped", () => {
        const doc = "Hello world"
        const A: Op = { type: "delete", pos: 6, length: 5 } // deletes "world"
        const B: Op = { type: "insert", pos: 8, text: "XX" } // inside "wor|ld"

        const result = assertConverges(doc, A, B)
        expect(result).toBe("Hello XX")
    })
})
