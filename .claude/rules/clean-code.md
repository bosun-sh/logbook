# Clean Code Standards

- Names MUST be intention-revealing: variables, functions, and types MUST communicate
  *what*, not *how*.
- Functions MUST be short (target: ≤ 20 lines). Functions exceeding 40 lines MUST be
  decomposed.
- Comments MUST explain *why*, never *what*. Code that requires a comment to explain what
  it does MUST be rewritten to be self-explanatory.
- Dead code, commented-out blocks, and unused imports are PROHIBITED.
- Nesting depth MUST NOT exceed 3 levels; use early returns, guard clauses, and
  functional composition to flatten logic.
- Boolean parameters in public APIs are PROHIBITED — use enumerations or named option
  types instead.

**Rationale**: Clean code is not aesthetic preference — it is the primary mechanism for
reducing cognitive load during review, debugging, and onboarding.
