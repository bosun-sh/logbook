import { Effect } from "effect"

const lockTails = new Map<string, Promise<void>>()

export const withCanonicalWriteLock = <A, E>(
  filePath: string,
  effect: Effect.Effect<A, E>
): Effect.Effect<A, E> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = lockTails.get(filePath) ?? Promise.resolve()
      let capturedRelease: () => void = () => {
        /* replaced below */
      }
      const current = new Promise<void>((resolve) => {
        capturedRelease = resolve
      })
      const tail = previous.then(() => current)
      lockTails.set(filePath, tail)
      return { previous, tail, release: capturedRelease }
    }),
    ({ previous }) =>
      Effect.promise(async () => {
        await previous
      }).pipe(Effect.zipRight(effect)),
    ({ release, tail }) =>
      Effect.sync(() => {
        release()
        if (lockTails.get(filePath) === tail) {
          lockTails.delete(filePath)
        }
      })
  )
