# Contributing to @bosun-sh/logbook

Thank you for your interest in contributing to **@bosun-sh/logbook**!

## Prerequisites

- [Bun](https://bun.sh/) (latest stable — see `.bun-version` or `bunfig.toml` for the pinned version)
- Git

## Local development setup

```bash
git clone https://github.com/bosun-sh/logbook.git
cd logbook
bun install
bun run ci:premerge   # lint + build + test — must be green before you open a PR
```

## Running tests

```bash
bun test              # full suite
bun run ci:lint       # linting + type-check only
bun run ci:build      # build only
```

## Before submitting a pull request

Run the full gate and confirm it is green:

```bash
bun run ci:premerge
```

If the gate is red, fix the errors before opening the PR.

## Commit conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

feat:     new feature
fix:      bug fix
docs:     documentation only
chore:    build, tooling, CI
refactor: code change that is not a fix or feature
test:     adding or fixing tests
ci:       CI/CD changes
```

Keep the subject line under 72 characters. Use the body for motivation and context.

## Pull request process

1. Fork the repository and create a branch from `main`.
2. Make your changes with clear, focused commits.
3. Run `bun run ci:premerge` locally and ensure it passes.
4. Open a PR against `main`. Describe what changed and why.
5. A maintainer will review and merge. Expect a response within a few business days.

## Compatibility

- **Runtime**: Bun (see `engines.bun` in `package.json` for the minimum version)
- **OS**: macOS, Linux, and Windows (WSL2) are tested and supported

## Code of conduct

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating.
