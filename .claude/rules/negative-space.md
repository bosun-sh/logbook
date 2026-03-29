# Negative Space Design (NON-NEGOTIABLE)

What code MUST NOT do is as important as what it does.

- Complexity MUST be prohibited before it is permitted. The default answer to adding
  abstraction, indirection, or a new concept is **no** — justify with a concrete present
  need.
- YAGNI is absolute: features, parameters, and abstractions for hypothetical future needs
  are FORBIDDEN.
- Global state is PROHIBITED. Class-level mutation shared across calls is PROHIBITED.
- Inheritance hierarchies deeper than 1 level are PROHIBITED (prefer composition).
- Magic values, implicit defaults, and ambient configuration are PROHIBITED — every
  behavior must be explicitly declared at the call site.
- `null`/`nil`/`undefined` as a meaningful return value is PROHIBITED; use a typed
  `Option`/`Maybe`/`Result` type instead.

**Rationale**: Negative space programming defines a hard boundary around complexity.
Prohibiting things by default and permitting them only when justified produces leaner,
more auditable codebases.
