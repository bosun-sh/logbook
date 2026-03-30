import { readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { Effect } from "effect"
import type { SessionRegistry } from "../task/session-registry.js"

type SessionMap = Record<string, number>

/**
 * PID-based session registry persisted to sessions.json alongside the tasks file.
 *
 * Liveness is checked via `process.kill(pid, 0)`: throws if the PID is dead, succeeds otherwise.
 * A missing entry (clean deregistration) is also considered dead.
 */
export class PidSessionRegistry implements SessionRegistry {
  private readonly sessionsFile: string

  constructor(tasksFile: string) {
    this.sessionsFile = path.join(path.dirname(tasksFile), "sessions.json")
  }

  isAlive(sessionId: string): Effect.Effect<boolean, never> {
    return Effect.promise(async () => {
      const map = await this.readMap()
      const pid = map[sessionId]
      if (pid === undefined) return false
      try {
        process.kill(pid, 0)
        return true
      } catch {
        // Dead PID — lazily remove to keep the file tidy
        await this.removeEntry(sessionId)
        return false
      }
    })
  }

  register(sessionId: string, pid: number): Effect.Effect<void, never> {
    return Effect.promise(async () => {
      const map = await this.readMap()
      map[sessionId] = pid
      await this.writeMap(map)
    })
  }

  deregister(sessionId: string): Effect.Effect<void, never> {
    return Effect.promise(() => this.removeEntry(sessionId))
  }

  private async readMap(): Promise<SessionMap> {
    try {
      const raw = await readFile(this.sessionsFile, "utf8")
      return JSON.parse(raw) as SessionMap
    } catch {
      return {}
    }
  }

  private async writeMap(map: SessionMap): Promise<void> {
    await writeFile(this.sessionsFile, JSON.stringify(map), "utf8")
  }

  private async removeEntry(sessionId: string): Promise<void> {
    const map = await this.readMap()
    delete map[sessionId]
    await this.writeMap(map)
  }
}
