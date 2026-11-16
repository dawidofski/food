# food

Personal food diary with proactive health warnings.

## Development

- `npm install`
- `npm run dev` – local dev server
- `npm test` – secret guard, then Vitest
- `npm run build` – typecheck and production build (served under `/food/`)

The repository is public: never commit secrets or personal profile values. `scripts/check-no-secrets.sh` enforces this before every test run.

## Where the food data comes from

This app ships one food database and can look products up in a second. Neither is this project's own work.

- **USDA FoodData Central** — the bundled dataset: FNDDS survey foods, their portion weights, and the FPED
  cup-equivalents derived from them. Published by the US Department of Agriculture, Agricultural Research Service.
  Released into the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/);
  <https://fdc.nal.usda.gov/>. These are US survey foods, so a product bought in another country may match a
  different food, or none.
- **Open Food Facts** — looked up by barcode, one product per scan, when the app is online. Product data is made
  available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/) and the
  individual contents under the
  [Database Contents License 1.0](https://opendatacommons.org/licenses/dbcl/1-0/); <https://openfoodfacts.org>.
  It is crowdsourced — anyone can edit any product — so anything logged from a scan is marked as such in the app,
  with the date that product was last edited. A lookup sends the barcode and nothing else. What the app refuses to
  read from it, and why, is in `docs/build-log-barcode.md`.
