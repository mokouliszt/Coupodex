import type { Coupon, Fix } from "./native";

/** 全半角・カタカナ/ひらがな・記号ゆれを吸収する。 */
export function norm(s: string): string {
  if (!s) return "";
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[ー―‐−\-\s・,.、。/]/g, "");
}

function bigrams(s: string): string[] {
  if (s.length < 2) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Dice 係数（2-gram）。 */
function dice(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const pool = new Map<string, number>();
  A.forEach((g) => pool.set(g, (pool.get(g) || 0) + 1));
  let hit = 0;
  B.forEach((g) => {
    const n = pool.get(g) || 0;
    if (n > 0) {
      hit++;
      pool.set(g, n - 1);
    }
  });
  return (2 * hit) / (A.length + B.length);
}

/** 順序を保った部分列一致（打ち漏らし・タイポ耐性）。 */
function subseq(needle: string, hay: string): number {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i / Math.max(needle.length, 1);
}

/** 0..1。1に近いほど一致。 */
export function score(query: string, target: string): number {
  const q = norm(query);
  const t = norm(target);
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;
  const d = dice(q, t);
  const s = subseq(q, t);
  return Math.max(d, s * 0.72);
}

export function searchable(c: Coupon): string {
  return [
    c.store,
    c.branch,
    c.service,
    c.place,
    c.notes,
    c.category,
    c.discount,
    c.address,
    c.code,
    (c.conditions || []).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

/** キーワード（AND）＋あいまい。しきい値未満は落とす。 */
export function match(query: string, c: Coupon): number {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const hay = searchable(c);
  const fields = [c.store, c.service, c.place, c.notes, c.category, c.discount].filter(Boolean) as string[];
  let total = 0;
  for (const w of words) {
    const best = Math.max(score(w, hay), ...fields.map((f) => score(w, f)));
    if (best < 0.34) return 0;
    total += best;
  }
  return total / words.length;
}

// ---- 期限 ----

export type ExpiryState = "none" | "expired" | "today" | "soon" | "month" | "ok";

export function daysLeft(expiry: string | null | undefined): number | null {
  if (!expiry) return null;
  const t = Date.parse(expiry + "T23:59:59");
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / 86400000);
}

export function expiryState(c: Coupon): ExpiryState {
  const d = daysLeft(c.expiry);
  if (d === null) return "none";
  if (d < 0) return "expired";
  if (d === 0) return "today";
  if (d <= 7) return "soon";
  if (d <= 30) return "month";
  return "ok";
}

export function expiryLabel(c: Coupon): string {
  const d = daysLeft(c.expiry);
  if (d === null) return c.expiryText || "期限なし";
  if (d < 0) return `${-d}日前に終了`;
  if (d === 0) return "今日まで";
  if (d === 1) return "明日まで";
  if (d <= 30) return `あと${d}日`;
  return `あと${Math.floor(d / 30)}ヶ月`;
}

// ---- 距離 ----

export function distanceM(fix: Fix | null, c: Coupon): number | null {
  if (!fix || c.lat == null || c.lng == null) return null;
  const R = 6371000;
  const dLat = ((c.lat - fix.lat) * Math.PI) / 180;
  const dLng = ((c.lng - fix.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fix.lat * Math.PI) / 180) * Math.cos((c.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export function distanceLabel(m: number): string {
  return m < 950 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${y}.${m}.${dd}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addMonthsISO(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function endOfMonthISO(): string {
  const d = new Date();
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`;
}
