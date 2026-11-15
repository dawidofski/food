# food

Personal food diary with proactive health warnings.

## Development

- `npm install`
- `npm run dev` – local dev server
- `npm test` – secret guard, then Vitest
- `npm run build` – typecheck and production build (served under `/food/`)

The repository is public: never commit secrets or personal profile values. `scripts/check-no-secrets.sh` enforces this before every test run.
