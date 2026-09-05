# Contributing to DiagramC

Thanks for contributing. DiagramC values small, reviewable changes backed by tests and clear user-facing documentation.

## Before you start

1. Search existing issues and pull requests.
2. For a non-trivial feature, open an issue first and describe the user problem, expected behavior and validation plan.
3. Do not include API keys, access tokens, personal data, local Studio state or generated build artifacts in a pull request.

## Local setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pnpm install --frozen-lockfile
make check
```

## Pull request expectations

- Keep the change focused and explain the user-visible result.
- Add or update tests for behavior changes.
- Run `make check` before requesting review.
- Update README, docs or examples when a workflow changes.
- Preserve backwards compatibility where practical; otherwise call out the migration impact.
- Use clear commit messages, preferably in imperative form: `Add SVG source apply action`.

## Code conventions

- Python is formatted and checked with Ruff.
- TypeScript must pass `pnpm typecheck` and the frontend quality checks.
- Prefer explicit names, narrow APIs and actionable error messages.
- Keep user data local by default. Shared state must never contain an API key.

## Reporting security issues

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
