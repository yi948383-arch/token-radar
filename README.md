# Token Radar — radar-2

Build the best token launch radar. Reads the sealed DefiLlama snapshot,
ranks the protocols that record no token by implied value, and hands in a
dashboard with the board, a detail view for every protocol and the steps
to farm it.

## Model (radar-2)

`implied = round(tvl_usd x 0.25 x growthMult x maturityMult x chainMult)`

- `growthMult = 1 + clamp(change_7d, -60, 120) / 100 x 0.6` when growth is
  positive, `x 1.0` when it is negative: a falling TVL hurts more than a
  rising one helps.
- `maturityMult = 0.55 + min(age_days, 1095) / 1095 x 0.45`, where age is
  days since first listed (unknown age uses 365 days).
- `chainMult = 1 + 0.02 x min(chains - 1, 5)`: TVL spread over more chains
  earns a small resilience bonus.

No protocol name is special-cased. The board covers the whole watchlist
plus every rankable pre-token protocol below the $50M floor — no top-N
cut. Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking,
Restaked BTC and CEX protocols are not ranked: they are wrapped, staked
or bridged products of a token that already trades. Live-token protocols
are set aside with their market caps shown, never mixed into the ranking.

## Signal

Each row also carries a plain-language signal from the same figures:

- **strong**: the top 20 rows that are not falling fast.
- **steady**: the next 60 rows.
- **early**: the rest — small or young, the radar's reason for existing,
  and the riskiest to farm.

## Dashboard

The page shows a Top 10 strip, the biggest seven-day movers up and down,
and a category breakdown (rows and TVL by category, selectable to filter
the board). Filters: search, category, chain, and the pre-token / live
token tabs. Every row opens a detail view with the model's multipliers,
a one-sentence reason for its rank, and its seven-step farm plan.

## Run

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22.18 or later, standard library only, no network at run time.
