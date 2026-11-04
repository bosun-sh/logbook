import { defineTool } from "@bosun-sh/ohtools"
import { type BoardInput, renderBoard } from "@logbook/board/board.js"

const asBoardInput = (input: unknown): BoardInput => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {}
  const r = input as Record<string, unknown>
  return {
    ...(typeof r.root === "string" ? { root: r.root } : {}),
    ...(typeof r.out === "string" ? { out: r.out } : {}),
    ...(r.open === true ? { open: true } : {}),
  }
}

export const boardRenderTool = defineTool({
  id: "board.render",
  description: "Render every logbook board under a root as one read-only HTML kanban.",
  run: (input: unknown) => renderBoard(asBoardInput(input)),
})
