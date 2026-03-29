# Tigerstyle Correctness (NON-NEGOTIABLE)

Correctness MUST be proven, not assumed.

- Assertions MUST be used at every trust boundary — never elide them for performance.
- Silent failures are PROHIBITED. Every error MUST be explicit, typed, and handled at
  the call site. Swallowing errors (`catch {}`, `_ =`, `unwrap_or_default()` without
  comment) is FORBIDDEN.
- Code MUST be written so that impossible states are unrepresentable in the type system.
  A runtime panic from an "impossible" case indicates a modeling failure.
- Defensive programming is MANDATORY at system boundaries (user input, network, filesystem).
  Internal functions MAY assume valid inputs only when the type system enforces it.
- Performance optimizations MUST NOT precede a correct, readable baseline implementation.

**Rationale**: TigerStyle (from TigerBeetle) treats correctness as the primary invariant.
A fast, incorrect system is strictly worse than a slow, correct one.
