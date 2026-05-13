const normalizeListArg = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
    }
  } catch {}

  const trimmed = value.trim()
  return trimmed.length === 0 ? [] : [trimmed]
}

export const translateV1TaskArgs = (
  command: string,
  args: Record<string, string>
): Record<string, unknown> => {
  if (command === "create-task") {
    const result: Record<string, unknown> = {}
    if (args["definition-of-done"] !== undefined) {
      result.definition_of_done = normalizeListArg(args["definition-of-done"])
    }
    if (args["test-cases"] !== undefined) {
      result.test_cases = normalizeListArg(args["test-cases"])
    }
    if (args["predicted-k-tokens"] !== undefined) {
      result.predictedKTokens = Number.parseInt(args["predicted-k-tokens"], 10)
    }
    if (args["assigned-session"] !== undefined) {
      result.assigned_session = args["assigned-session"]
    }
    if (args["assigned-model"] !== undefined) {
      result.assigned_model = args["assigned-model"]
    }
    if (args.estimation !== undefined) {
      result.estimation = Number.parseInt(args.estimation, 10)
    }
    return result
  }

  if (command === "update-task") {
    const result: Record<string, unknown> = {}
    if (args["new-status"] !== undefined) {
      result.new_status = args["new-status"]
    }
    if (args["comment-title"] !== undefined) {
      result.comment_title = args["comment-title"]
    }
    if (args["comment-content"] !== undefined) {
      result.comment_content = args["comment-content"]
    }
    if (args["comment-reply-to"] !== undefined) {
      result.comment_reply_to = args["comment-reply-to"]
    }
    return result
  }

  return {}
}
