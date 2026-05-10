import { Ohtools } from "@bosun-sh/ohtools"
import { logbookPlugins } from "@logbook/plugin/registry.js"

export const createLogbookApp = () => {
  let app = new Ohtools({ name: "logbook" })

  for (const registryPlugin of logbookPlugins) {
    app = app.use(registryPlugin)
  }

  return app
}
