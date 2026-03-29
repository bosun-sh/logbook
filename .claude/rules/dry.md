# DRY Enforcement

- Every piece of knowledge MUST have a single, authoritative representation.
- Logic duplicated in two places is a warning; in three places it MUST be extracted.
- Structural duplication (copy-paste with minor variations) is PROHIBITED — use
  parameterization, higher-order functions, or well-named abstractions.
- Configuration, constants, and schema definitions MUST live in exactly one location and
  be imported everywhere else.

**Rationale**: DRY violations are the primary cause of divergent behavior and
inconsistent bug fixes across a codebase.
