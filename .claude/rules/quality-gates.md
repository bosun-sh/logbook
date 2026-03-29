# Quality Gates

## MUST pass before merge

1. All tests pass (zero failures, zero skips without documented reason).
2. No linting errors or warnings.
3. No duplication detected above the DRY threshold (3 occurrences).
4. Peer review by at least one subagent.

## Review process

- Reviewers MUST verify SOLID and DRY compliance, not just correctness.
- Comments that suggest adding abstraction for future flexibility MUST be declined unless a concrete present need is demonstrated.

## Commit Discipline

- Each commit MUST represent a single logical change.
- Commit messages MUST follow Conventional Commits: `type(scope): description`
- Work-in-progress commits (`wip:`, `fixup:`) are acceptable during development but MUST be squared before merge.
