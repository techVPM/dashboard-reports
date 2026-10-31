// Turns a client's plain-language "goals" block into the settings the report already understands.
//
// clients.json example:
//   "goals": {
//     "cost_per_conversion": 150,            (or a range: "200-300")
//     "spend_by_type": { "video": 10000, "search+pmax": 30000 },
//     "weekly_conversions": 70,
//     "secondary_conversions": ["Calls from ads", "Add to cart"],
//     "focus_conversions": ["Booked Call", "Lead - Form"],
//     "result_label": "Booked calls",
//     "roas": 4,
//     "monthly_conversions": 40,
//     "monthly_spend": 12000,
//     "note": "Goal is under $150 per booked call"
//   }
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v));

const names = (a) => (Array.isArray(a) ? a : typeof a === 'string' ? a.split(/\n|,(?![^(]*\))/) : []).map((x) => String(x).trim()).filter(Boolean);
const TYPES = ['video', 'search', 'pmax', 'shopping', 'display', 'other'];

// "200-300", "$200 to $300", 250, or { low, high }
export function parseCpa(v) {
  if (v == null || v === '') return { low: null, high: null };
  if (typeof v === 'object') { const lo = num(v.low), hi = num(v.high); return { low: lo && hi ? Math.min(lo, hi) : lo, high: lo && hi ? Math.max(lo, hi) : hi || lo }; }
  const nums = String(v).replace(/[$,]/g, '').match(/\d+(\.\d+)?/g) || [];
  if (nums.length >= 2) { const a = Number(nums[0]), b = Number(nums[1]); return { low: Math.min(a, b), high: Math.max(a, b) }; }
  return { low: null, high: num(nums[0]) };
}

export function cleanGoals(g) {
  g = g || {};
  const focus = names(g.focus_conversions);
  const cpa = parseCpa(g.cost_per_conversion);
  const sbt = [];
  for (const [k, v] of Object.entries(g.spend_by_type || {})) {
    const types = String(k).toLowerCase().split(/[+/,& ]+/).map((t) => (t === 'youtube' || t === 'yt' || t === 'demand_gen' ? 'video' : t === 'performance_max' ? 'pmax' : t)).filter((t) => TYPES.includes(t));
    if (types.length && num(v)) sbt.push({ types, amount: num(v) });
  }
  const out = {
    cost_per_conversion: cpa.high,
    cpa_low: cpa.low,
    spend_by_type: sbt,
    weekly_conversions: num(g.weekly_conversions),
    secondary_conversions: names(g.secondary_conversions),
    roas: num(g.roas),
    monthly_conversions: num(g.monthly_conversions),
    monthly_spend: num(g.monthly_spend),
    focus_conversions: focus,
    result_label: String(g.result_label || '').trim(),
    note: String(g.note || '').trim(),
  };
  out.any = !!(out.cost_per_conversion || out.roas || out.monthly_conversions || out.weekly_conversions || out.monthly_spend || out.spend_by_type.length || out.focus_conversions.length || out.note);
  return out;
}

// Returns a copy of the client with goals folded into outcomes, labels and targets.
// Anything set directly in outcomes, labels or targets wins over the goals block.
export function applyGoals(client) {
  const g = cleanGoals(client.goals);
  const c = { ...client, outcomes: { ...(client.outcomes || {}) }, labels: { ...(client.labels || {}) }, targets: { ...(client.targets || {}) } };
  const hasOutcomes = Object.values(c.outcomes).some((v) => Array.isArray(v) && v.length);
  if (!hasOutcomes && g.focus_conversions.length) {
    c.outcomes = { leads: g.focus_conversions };
    if (g.result_label && !c.labels.leads) c.labels.leads = g.result_label;
  }
  if (g.cost_per_conversion) {
    if (c.targets.cpl == null) c.targets.cpl = g.cost_per_conversion;
    if (c.targets.cpc == null) c.targets.cpc = g.cost_per_conversion;
  }
  if (g.roas && c.targets.roas == null) c.targets.roas = g.roas;
  return { client: c, goals: g };
}
