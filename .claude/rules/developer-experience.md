# Developer Experience (DX) First

- Error messages MUST be actionable: include what failed, why, and how to fix it.
- APIs MUST be ergonomic: the most common use case MUST be the easiest to express.
- Every public interface MUST include a minimal usage example in its documentation.
- Build, test, and lint cycles MUST complete in under 60 seconds for incremental changes.
- Local development setup MUST be achievable with a single command and documented in
  `quickstart.md`.
- Breaking API changes MUST be communicated with a deprecation notice one version prior.

**Rationale**: Good DX compresses the feedback loop and lowers the cost of doing the
right thing, making every principle in this constitution easier to follow in practice.
