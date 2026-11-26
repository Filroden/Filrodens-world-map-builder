# NPM

## Packing the distribution folders

`npm run pack`
`npm run pack:web`

## Runnng the test web server

`npm run serve:web`
`npm run serve:web -- --dist` serves that build exactly as it will be deployed

## Probing the name filter

`node scripts/name-probe.mjs` draws 20,000 place names from each name base and reports the share the name filter blocks and the words that block them (`--words`, `--examples`). Run it after changing `src/kernel/names/data/BlockedWords.js`: no base should lose more than `NAME_FILTER.CAP` (1%).
