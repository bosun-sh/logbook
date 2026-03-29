# SOLID Discipline

- **S — Single Responsibility**: Every module, class, and function MUST have exactly one
  reason to change. Mixed concerns MUST be separated before review.
- **O — Open/Closed**: Behavior MUST be extended through composition and interfaces, not
  by modifying existing code.
- **L — Liskov Substitution**: Subtypes MUST be fully substitutable for their base types.
  Overriding methods that throw `UnsupportedOperationException` or weaken contracts is
  PROHIBITED.
- **I — Interface Segregation**: Interfaces MUST be narrow. A consumer MUST NOT be forced
  to depend on methods it does not use.
- **D — Dependency Inversion**: High-level modules MUST depend on abstractions. Concrete
  dependencies MUST be injected, not instantiated internally.

**Rationale**: SOLID constraints prevent coupling and keep each unit independently
replaceable and testable.
