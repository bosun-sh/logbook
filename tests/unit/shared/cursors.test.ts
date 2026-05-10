import { describe, expect, test } from "bun:test"
import { PageCursor } from "@logbook/shared/pagination.js"

describe("PageCursor", () => {
  test("encodes cursor payloads as opaque base64url strings", () => {
    const result = PageCursor.encode({
      kind: "task.list",
      lastId: "task_01",
      lastSort: ["2026-01-01T00:00:00.000Z", "task_01"],
      providerCursor: "linear:abc123",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.data).toBe("string")
      expect(result.data).not.toContain("=")
    }
  })

  test("decodes valid cursors with matching kind and sort shape", () => {
    const payload = {
      kind: "task.list",
      lastId: "task_01",
      lastSort: ["2026-01-01T00:00:00.000Z", "task_01"],
    }

    const encoded = PageCursor.encode(payload)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) {
      throw new Error("expected cursor encoding to succeed")
    }

    const decoded = PageCursor.decode(encoded.data, {
      kind: "task.list",
      sortShape: ["string", "string"],
    })

    expect(decoded).toEqual({ ok: true, data: payload })
  })

  test("rejects malformed base64url and malformed JSON", () => {
    const malformedBase64 = PageCursor.decode("not a cursor?", {
      kind: "task.list",
      sortShape: ["string"],
    })
    const malformedJson = PageCursor.decode(Buffer.from("{").toString("base64url"), {
      kind: "task.list",
      sortShape: ["string"],
    })

    expect(malformedBase64.ok).toBe(false)
    expect(malformedJson.ok).toBe(false)
    if (!malformedBase64.ok && !malformedJson.ok) {
      expect(malformedBase64.error.code).toBe("validation_error")
      expect(malformedJson.error.code).toBe("validation_error")
    }
  })

  test("rejects wrong kind, missing fields, and mismatched sort shapes", () => {
    const validPayload = Buffer.from(
      JSON.stringify({ kind: "task.list", lastId: "task_01", lastSort: [1] })
    ).toString("base64url")
    const missingField = Buffer.from(JSON.stringify({ kind: "task.list", lastSort: [1] })).toString(
      "base64url"
    )

    const wrongKind = PageCursor.decode(validPayload, {
      kind: "story.list",
      sortShape: ["number"],
    })
    const missing = PageCursor.decode(missingField, {
      kind: "task.list",
      sortShape: ["number"],
    })
    const wrongShape = PageCursor.decode(validPayload, {
      kind: "task.list",
      sortShape: ["string"],
    })

    expect(wrongKind.ok).toBe(false)
    expect(missing.ok).toBe(false)
    expect(wrongShape.ok).toBe(false)
  })
})
