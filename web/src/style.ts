// Цвет вещи по фото и подбор парных луков. Всё считается на телефоне правилами:
// модель для этого не нужна, а ответ мгновенный и объяснимый.

export type Category = "top" | "bottom" | "dress" | "outer" | "shoes" | "accessory";
export type StyleTag = "casual" | "smart" | "sport";

export interface WItem {
  id: number;
  owner_id: number;
  url: string;
  category: Category;
  color: string;
  color_name: string;
  warmth: number;
  styles: StyleTag[];
  title: string | null;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  top: "Верх",
  bottom: "Низ",
  dress: "Платье",
  outer: "Верхняя одежда",
  shoes: "Обувь",
  accessory: "Аксессуар",
};
export const STYLE_LABEL: Record<StyleTag, string> = { casual: "повседневное", smart: "нарядное", sport: "спорт" };

/** Палитра имён. neutral — сочетается со всем; hue — оттенок для правил гармонии. */
export const NAMED: { name: string; hex: string; neutral?: boolean; hue?: number }[] = [
  { name: "чёрный", hex: "#1f1f22", neutral: true },
  { name: "белый", hex: "#f2f0ec", neutral: true },
  { name: "серый", hex: "#8b8c90", neutral: true },
  { name: "бежевый", hex: "#d6c1a1", neutral: true },
  { name: "коричневый", hex: "#6f4a31", neutral: true },
  { name: "джинсовый", hex: "#3e5f8f", neutral: true },
  { name: "хаки", hex: "#7a7a4d", hue: 60 },
  { name: "красный", hex: "#c8322e", hue: 2 },
  { name: "бордовый", hex: "#6e1f2b", hue: 350 },
  { name: "розовый", hex: "#e791b3", hue: 335 },
  { name: "оранжевый", hex: "#e7843b", hue: 26 },
  { name: "жёлтый", hex: "#e6c346", hue: 48 },
  { name: "зелёный", hex: "#3e8e5a", hue: 140 },
  { name: "оливковый", hex: "#5c6a2e", hue: 75 },
  { name: "мятный", hex: "#9fd8c3", hue: 158 },
  { name: "голубой", hex: "#8ec5ea", hue: 203 },
  { name: "синий", hex: "#274c9c", hue: 222 },
  { name: "фиолетовый", hex: "#7757b3", hue: 265 },
  { name: "лавандовый", hex: "#c2b1e2", hue: 262 },
];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  // Взвешенное расстояние: глаз чувствительнее к зелёному
  const r = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

export function nearestName(hex: string): string {
  const c = rgb(hex);
  let best = NAMED[0];
  let bd = Infinity;
  for (const n of NAMED) {
    const d = dist(c, rgb(n.hex));
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best.name;
}

const toHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/**
 * Главный цвет вещи. Фон оценивается по краям кадра (вещь обычно в центре на
 * кровати, стуле или вешалке), пиксели, похожие на фон, отбрасываются, а из
 * оставшихся берётся самый крупный кластер цветов.
 */
export async function dominantColor(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  const px = (x: number, y: number): [number, number, number] => {
    const i = (y * S + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const border: [number, number, number][] = [];
  for (let i = 0; i < S; i++) border.push(px(i, 0), px(i, S - 1), px(0, i), px(S - 1, i));
  const bg = [0, 1, 2].map((k) => border.map((p) => p[k]).sort((a, b) => a - b)[border.length >> 1]) as [number, number, number];
  // Центральные 70% кадра, без похожего на фон
  const pts: [number, number, number][] = [];
  const m = Math.round(S * 0.15);
  for (let y = m; y < S - m; y++) for (let x = m; x < S - m; x++) {
    const p = px(x, y);
    if (dist(p, bg) > 60) pts.push(p);
  }
  const src = pts.length > 80 ? pts : Array.from({ length: (S - 2 * m) ** 2 }, (_, i) => px(m + (i % (S - 2 * m)), m + Math.floor(i / (S - 2 * m))));
  // Корзины по 4 бита на канал: быстро и достаточно для имени цвета
  const buckets = new Map<number, { n: number; s: [number, number, number] }>();
  for (const p of src) {
    const key = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
    const b = buckets.get(key) ?? { n: 0, s: [0, 0, 0] };
    b.n++;
    b.s[0] += p[0];
    b.s[1] += p[1];
    b.s[2] += p[2];
    buckets.set(key, b);
  }
  // Соседние корзины складываются, чтобы тени одной ткани не дробили цвет
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  const center = top.s.map((v) => v / top.n) as [number, number, number];
  let n = 0;
  const sum = [0, 0, 0];
  for (const p of src) if (dist(p, center) < 70) {
    n++;
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  return toHex(sum.map((v) => v / Math.max(n, 1)));
}

// ——— подбор ———

export type Occasion = "date" | "walk" | "photo" | "evening" | "sport";
export const OCCASIONS: [Occasion, string, string][] = [
  ["date", "💞", "Свидание"],
  ["walk", "🌳", "Прогулка"],
  ["photo", "📸", "Фотосессия"],
  ["evening", "🎭", "Театр, ресторан"],
  ["sport", "🏃", "Активный день"],
];
const OCCASION_STYLES: Record<Occasion, StyleTag[]> = {
  date: ["smart", "casual"],
  walk: ["casual", "sport"],
  photo: ["casual", "smart"],
  evening: ["smart"],
  sport: ["sport", "casual"],
};

export type PairMode = "auto" | "match" | "complement" | "tone";
export const PAIR_MODES: [PairMode, string][] = [
  ["auto", "Как лучше"],
  ["match", "В тон"],
  ["complement", "Дополняют"],
  ["tone", "Одна гамма"],
];

export interface Weather {
  tmin: number;
  tmax: number;
  rain: number;
}

const info = (name: string) => NAMED.find((n) => n.name === name);
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
/** Тёплый или холодный: для правила «одна гамма». */
const temperature = (name: string): "warm" | "cool" | null => {
  const i = info(name);
  if (!i || i.neutral) return name === "бежевый" || name === "коричневый" ? "warm" : name === "джинсовый" ? "cool" : null;
  return i.hue! < 90 || i.hue! > 320 ? "warm" : "cool";
};

/** Гармония одного образа: нейтральные сочетаются со всем, акцентов лучше один-два. */
function harmony(items: WItem[]): { score: number; accents: string[] } {
  const accents = [...new Set(items.map((i) => i.color_name).filter((n) => !info(n)?.neutral))];
  let score = 0;
  if (accents.length === 0) score += 1.5;
  else if (accents.length === 1) score += 3;
  else if (accents.length === 2) {
    const g = hueGap(info(accents[0])?.hue ?? 0, info(accents[1])?.hue ?? 0);
    score += g < 45 ? 2 : g > 150 ? 1.5 : -2;
  } else score -= 3;
  return { score, accents };
}

/** Насколько вещь подходит к погоде: при холоде нужна верхняя одежда потеплее. */
function warmthFit(items: WItem[], w: Weather | null): number {
  if (!w) return 0;
  const t = (w.tmin + w.tmax) / 2;
  const outer = items.find((i) => i.category === "outer");
  const main = items.filter((i) => i.category === "top" || i.category === "dress" || i.category === "bottom");
  let s = 0;
  if (t < 12 && !outer) s -= 4;
  if (t < 3 && outer && outer.warmth < 3) s -= 3;
  if (t >= 20 && outer) s -= 2;
  if (t >= 22 && main.some((i) => i.warmth === 3)) s -= 3;
  if (t < 8 && main.some((i) => i.warmth === 1)) s -= 1;
  if (t >= 12 && t < 20 && outer && outer.warmth <= 2) s += 1;
  return s;
}

export interface Outfit {
  items: WItem[];
  score: number;
  accents: string[];
  palette: string[];
}

/** Все разумные образы одного человека под повод и погоду, лучшие сверху. */
export function outfitsFor(items: WItem[], occasion: Occasion, w: Weather | null, locked: number[] = []): Outfit[] {
  const ok = OCCASION_STYLES[occasion];
  const fit = items.filter((i) => i.styles.some((s) => ok.includes(s)) || locked.includes(i.id));
  const by = (c: Category) => fit.filter((i) => i.category === c);
  const needOuter = w ? (w.tmin + w.tmax) / 2 < 17 : false;
  const bases: WItem[][] = [];
  for (const d of by("dress")) bases.push([d]);
  for (const t of by("top")) for (const b of by("bottom")) bases.push([t, b]);
  const shoes = by("shoes");
  const outers = by("outer");
  const out: Outfit[] = [];
  for (const base of bases) {
    const shoeOpts = shoes.length ? shoes : [null];
    const outerOpts = needOuter && outers.length ? outers : [null];
    for (const sh of shoeOpts) for (const o of outerOpts) {
      const set = [...base, ...(sh ? [sh] : []), ...(o ? [o] : [])];
      if (locked.length && !locked.every((id) => set.some((i) => i.id === id) || !items.some((x) => x.id === id))) continue;
      const h = harmony(set);
      out.push({
        items: set,
        score: h.score + warmthFit(set, w) + (sh ? 0.5 : -1),
        accents: h.accents,
        palette: [...new Set(set.map((i) => i.color_name))],
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 40);
}

export interface PairLook {
  mine: Outfit;
  theirs: Outfit;
  score: number;
  why: string;
}

/** Как образы двоих смотрятся рядом. */
function pairScore(a: Outfit, b: Outfit, mode: PairMode): { score: number; why: string } {
  const shared = a.palette.filter((c) => b.palette.includes(c));
  const sharedAccent = shared.filter((c) => !info(c)?.neutral);
  const variants: { k: PairMode; score: number; why: string }[] = [];
  // В тон: общий акцентный цвет или общая база
  variants.push({
    k: "match",
    score: sharedAccent.length ? 4 : shared.length >= 2 ? 2.5 : shared.length ? 1 : -1,
    why: sharedAccent.length ? `в тон: у обоих ${sharedAccent.join(" и ")}` : shared.length ? `общая база: ${shared.join(", ")}` : "",
  });
  // Дополняют: акценты на противоположных сторонах цветового круга
  const comp = a.accents.some((x) => b.accents.some((y) => { const g = hueGap(info(x)?.hue ?? 0, info(y)?.hue ?? 0); return g > 140; }));
  variants.push({ k: "complement", score: comp ? 3.5 : 0, why: comp ? `дополняют: ${a.accents[0]} + ${b.accents[0]}` : "" });
  // Одна гамма: оба тёплые или оба холодные
  const ta = a.palette.map(temperature).filter(Boolean);
  const tb = b.palette.map(temperature).filter(Boolean);
  const same = ta.length && tb.length && ta.every((x) => x === ta[0]) && tb.every((x) => x === ta[0]);
  variants.push({ k: "tone", score: same ? 3 : 0, why: same ? `одна гамма: оба в ${ta[0] === "warm" ? "тёплых" : "холодных"} тонах` : "" });
  // Слишком одинаково — выглядит как униформа
  const clone = a.palette.length === b.palette.length && a.palette.every((c) => b.palette.includes(c)) ? -1.5 : 0;
  const pick = mode === "auto" ? variants.sort((x, y) => y.score - x.score)[0] : variants.find((v) => v.k === mode)!;
  return { score: pick.score + clone, why: pick.why || "спокойное сочетание" };
}

/** Лучшие парные луки: разнообразные, без повторов одной и той же вещи подряд. */
export function pairLooks(mineItems: WItem[], theirItems: WItem[], occasion: Occasion, mode: PairMode, w: Weather | null, locked: number[] = []): PairLook[] {
  const A = outfitsFor(mineItems, occasion, w, locked).slice(0, 18);
  const B = outfitsFor(theirItems, occasion, w, locked).slice(0, 18);
  const all: PairLook[] = [];
  for (const a of A) for (const b of B) {
    const p = pairScore(a, b, mode);
    all.push({ mine: a, theirs: b, score: a.score + b.score + p.score * 1.6, why: p.why });
  }
  all.sort((x, y) => y.score - x.score);
  const out: PairLook[] = [];
  const used = new Map<number, number>();
  for (const l of all) {
    const ids = [...l.mine.items, ...l.theirs.items].map((i) => i.id);
    if (ids.some((id) => (used.get(id) ?? 0) >= 2)) continue;
    ids.forEach((id) => used.set(id, (used.get(id) ?? 0) + 1));
    out.push(l);
    if (out.length >= 8) break;
  }
  return out;
}

/** Подсказка, чего не хватает для подбора. */
export function missing(items: WItem[]): string | null {
  const has = (c: Category) => items.some((i) => i.category === c);
  if (!has("dress") && !(has("top") && has("bottom"))) return "нужен хотя бы верх и низ или платье";
  if (!has("shoes")) return "добавь обувь — образ без неё неполный";
  return null;
}

export function weatherLine(w: Weather | null): string {
  if (!w) return "без прогноза";
  const t = `${Math.round(w.tmin)}…${Math.round(w.tmax)}°`;
  return w.rain >= 50 ? `${t}, возможен дождь` : t;
}
