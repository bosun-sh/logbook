# Functional Core (NON-NEGOTIABLE)

Code MUST default to pure functions: same inputs always produce same outputs, no hidden
state, no observable side effects within the core domain.

- All side effects (I/O, time, randomness, mutations) MUST be pushed to the outermost
  boundary of the system — never buried inside domain logic.
- Data MUST be treated as immutable by default; mutable state requires explicit justification.
- Functions MUST be small and composable; a function that cannot be described in one
  sentence MUST be decomposed.
- Shared mutable state is PROHIBITED. Concurrency MUST be achieved through message-passing
  or immutable data structures.

**Rationale**: Pure functions are independently testable, trivially parallelizable, and
eliminate entire classes of bugs caused by action-at-a-distance.
