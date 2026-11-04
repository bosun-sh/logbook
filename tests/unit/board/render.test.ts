import { expect, test } from "bun:test"
import { renderBoardHtml } from "@logbook/board/render.js"

const task = (title: string, description: string) =>
  ({
    id: "t1",
    project: "p",
    milestone: "m",
    title,
    description,
    definitionOfDone: "d",
    status: "need_info",
    priority: 1,
    comments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as never

const extract = (html: string) =>
  JSON.parse(html.split('id="board-data">')[1]?.split("</script>")[0] ?? "")

test("escapes embedded data and round-trips", () => {
  const data = {
    generatedAt: "now",
    boards: [
      { label: "a/b", tasks: [task("Unique title", "</script><script>alert(1)</script>  ")] },
    ],
    warnings: [],
  }
  const html = renderBoardHtml(data)
  expect(html).toContain("Unique title")
  expect(html).not.toContain("</script><script>alert(1)")
  expect(extract(html)).toEqual(JSON.parse(JSON.stringify(data)))
})

test("renders with no boards and references no network resources", () => {
  const html = renderBoardHtml({ generatedAt: "now", boards: [], warnings: [] })
  expect(html).toContain("No logbook boards found")
  expect(html).not.toMatch(/(src|href)=["']https?:/)
  expect(html).not.toContain("http://")
})
