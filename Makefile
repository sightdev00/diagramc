.PHONY: install web-install test lint format format-check typecheck build check demo schema

install:
	pip install -e ".[dev]"

web-install:
	pnpm install --frozen-lockfile

test:
	python3 -m pytest -q

lint:
	ruff check src tests
	pnpm lint:web

format:
	ruff format src tests
	pnpm exec biome format --write apps/web/src

format-check:
	ruff format --check src tests
	pnpm exec biome format apps/web/src

typecheck:
	pnpm typecheck

build:
	pnpm build

check: lint format-check test typecheck build

demo:
	bash scripts/demo.sh

schema:
	archviz schema -o diagram.schema.json
