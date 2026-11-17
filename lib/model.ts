// Token Radar, model radar-2.
//
// One snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist (the floor, never a ceiling) and every rankable
// pre-token protocol below that floor — no TVL cutoff on the early radar.
// A protocol is rankable when it records no token and is not a wrapped,
// staked or bridged product of a token that already trades, not a CEX, and
// not a versioned pool of another protocol. The same exclusion the
// watchlist itself uses, applied to the early rows too: WBTC is Bitcoin on
// Ethereum and Binance staked ETH is ETH in a staking product, neither is
// a protocol still waiting on a launch of its own.
//
// Implied value follows only from the snapshot's own figures, never from a
// hand-written list of names:
//
//   base        = tvl_usd x 0.25
//   growth      = clamp(change_7d, -60, 120) per cent
//   growthMult  = 1 + growth/100 x 0.6   when growth >= 0
//               = 1 + growth/100 x 1.0   when growth < 0
//                 (a falling TVL hurts more than a rising one helps:
//                  momentum is noisy, a drawdown is a signal)
//   maturity    = 0.55 + min(age_days, 1095) / 1095 x 0.45
//                 (age = days since first listed; unknown age uses 365)
//   chainMult   = 1 + 0.02 x min(chains - 1, 5)
//                 (multi-chain TVL is less single-chain risk, capped)
//   implied     = max(1, round(base x growthMult x maturity x chainMult))
//
// Farm plans are derived from the same record (category, chains, TVL,
// age): seven steps each, an action with what it costs and how long it
// takes, a second qualifying action, a hold, a claim check and an exit
// log. No name is ever special-cased.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight_up: 0.6,
  growth_weight_down: 1.0,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 5,
};

export const MODEL_VERSION = 'radar-2';

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  /** A plain-language signal from the same figures: strong, steady or early. */
  signal: 'strong' | 'steady' | 'early';
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  signal: 'strong' | 'steady' | 'early';
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** One category's share of the board, for the dashboard's breakdown. */
export interface CategoryStat {
  category: string;
  rows: number;
  tvl_usd: number;
  top_implied_usd: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategoryStat[];
  top_movers: { slug: string; name: string; change_7d: number | null }[];
  bottom_movers: { slug: string; name: string; change_7d: number | null }[];
  summary: BoardSummary;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_weight_up : model.growth_weight_down;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = Math.max(0, protocol.chains.length - 1);
  const chainMult = 1 + model.chain_step * Math.min(chainCount, model.chain_cap);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** Categories that are wrapped, staked or bridged products of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token, not excluded, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

/** A plain-language signal from the same figures the model scores,
 * applied after ranking so it stays relative to the board: strong is
 * the top 20 rows that are not falling fast, steady is the next 60,
 * early is the rest — small or young, the radar's reason for existing,
 * and the riskiest to farm. No name is special-cased. */
export function signalFor(p: SnapshotProtocol, age: number | null, rank: number): 'strong' | 'steady' | 'early' {
  const growth = p.change_7d ?? 0;
  if (rank <= 20 && growth >= -5) return 'strong';
  if (rank <= 80) return 'steady';
  return 'early';
}

/** The board in one paragraph of figures: median implied value, the
 * biggest category by TVL, and how many rows grew in the last week.
 * Every number comes from the board the model just wrote. */
export interface BoardSummary {
  median_implied_usd: number;
  top_category: string;
  top_category_rows: number;
  growing_rows: number;
  total_tvl_usd: number;
}

export function boardSummary(board: BoardRow[]): BoardSummary {
  const sorted = [...board].sort((a, b) => a.implied_value_usd - b.implied_value_usd);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const median = mid === undefined ? 0 : mid.implied_value_usd;
  const byCat = new Map<string, { rows: number; tvl: number }>();
  for (const r of board) {
    const key = r.category ?? 'Other';
    const cur = byCat.get(key);
    if (cur === undefined) byCat.set(key, { rows: 1, tvl: r.tvl_usd });
    else { cur.rows += 1; cur.tvl += r.tvl_usd; }
  }
  let topCategory = 'Other';
  let topRows = 0;
  let topTvl = -1;
  for (const [cat, v] of byCat) {
    if (v.tvl > topTvl) { topTvl = v.tvl; topCategory = cat; topRows = v.rows; }
  }
  return {
    median_implied_usd: median,
    top_category: topCategory,
    top_category_rows: topRows,
    growing_rows: board.filter((r) => (r.change_7d ?? 0) > 0).length,
    total_tvl_usd: board.reduce((acc, r) => acc + r.tvl_usd, 0),
  };
}

/** One category's share of the board, strongest implied value first. */
export function categoryStats(board: BoardRow[]): CategoryStat[] {
  const byCat = new Map<string, CategoryStat>();
  for (const r of board) {
    const key = r.category ?? 'Other';
    const cur = byCat.get(key);
    if (cur === undefined) {
      byCat.set(key, { category: key, rows: 1, tvl_usd: r.tvl_usd, top_implied_usd: r.implied_value_usd });
    } else {
      cur.rows += 1;
      cur.tvl_usd += r.tvl_usd;
      cur.top_implied_usd = Math.max(cur.top_implied_usd, r.implied_value_usd);
    }
  }
  return [...byCat.values()].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.category < b.category ? -1 : 1));
}

/** The board's biggest seven-day movers, up and down, by reported growth. */
export function movers(board: BoardRow[]): {
  top: { slug: string; name: string; change_7d: number | null }[];
  bottom: { slug: string; name: string; change_7d: number | null }[];
} {
  const withGrowth = board.filter((r) => r.change_7d !== null);
  const pick = (list: BoardRow[]) => list.slice(0, 5).map((r) => ({ slug: r.slug, name: r.name, change_7d: r.change_7d }));
  const top = pick([...withGrowth].sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0)));
  const bottom = pick([...withGrowth].sort((a, b) => (a.change_7d ?? 0) - (b.change_7d ?? 0)));
  return { top, bottom };
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor.
  // No TVL cutoff, no top-N: the radar exists to find these early.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    signal: signalFor(s.p, s.age, i + 1),
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Use $${capital} of USDC in ${name}'s own app on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action, so the plan is not one deposit and a wait. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp')) return `Borrow $${small} against the deposit on ${name}, then repay it the same week so the borrow is on record.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap $${small} through ${name}'s pool on ${chain} so the address shows a trade as well as liquidity.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge, then open a second small position on ${name} in a different market.`;
  if (c.includes('prediction')) return `Settle the first market, then place a second position on a different ${name} market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Move $${small} into a second ${name} vault on ${chain} with a different strategy.`;
  if (c.includes('rwa') || c.includes('stable')) return `Redeem $${small} of the asset, then mint it again on ${name} so both directions are on record.`;
  return `Make a second, smaller deposit of $${small} on ${name} from the same wallet a week later.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: action, cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: second, cost: `about $${Math.max(10, Math.round(capital / 5))} of capital and $2 of gas`, time: '10 minutes' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, never from a link in a message or a search ad.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log, then unwind in the reverse order you entered so nothing is left locked.`, cost: 'nothing but the log, plus gas to unwind', time: '5 minutes to log, 15 minutes to unwind' },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at,
    age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    signal: row.signal,
    growth_multiplier: row.model.growth_multiplier, maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const mv = movers(board);
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length,
    rows: board.map(radarRow), live,
    categories: categoryStats(board),
    top_movers: mv.top,
    bottom_movers: mv.bottom,
    summary: boardSummary(board),
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
