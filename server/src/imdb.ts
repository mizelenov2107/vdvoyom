// Свои фильмы в колоде и рейтинги IMDb.
//
// Рейтинги берутся из официальной выгрузки IMDb (datasets.imdbws.com, только
// личное некоммерческое использование): раз в неделю качаем 8 МБ и собираем
// отдельную базу рядом с основной. В ночные копии она не попадает — её всегда
// можно скачать заново. Хранятся только оценки от 100 голосов: меньше — шум.
//
// Поиск — подсказки imdb.com, те же, что в строке поиска на сайте. С нашего
// сервера они отвечают и на русские запросы («брат» → Brother, 1997). Русское
// название, описание и жанры дотягиваем из Викиданных и Википедии; не
// ответили — фильм остаётся с английским названием. API IMDb с полными
// данными с российского адреса закрыт (403), поэтому без него.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { env } from "./env.ts";

const RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
const MIN_VOTES = 100;
const UA = `vdvoyom/1.0 (${env.publicUrl}/privacy)`;

// ——— рейтинги ———

let ratingsDb: DatabaseSync | null = null;
let ratingStmt: ReturnType<DatabaseSync["prepare"]> | null = null;

function openRatings(): DatabaseSync | null {
  if (ratingsDb) return ratingsDb;
  if (!fs.existsSync(env.imdbDbPath)) return null;
  ratingsDb = new DatabaseSync(env.imdbDbPath, { readOnly: true });
  ratingStmt = ratingsDb.prepare("SELECT rating, votes FROM ratings WHERE id = ?");
  return ratingsDb;
}

export function ratingOf(imdb: string | null | undefined): { rating: number; votes: number } | null {
  if (!imdb || !openRatings()) return null;
  return (ratingStmt!.get(imdb) as { rating: number; votes: number } | undefined) ?? null;
}

/** Когда рейтинги обновлялись в последний раз; null — ещё ни разу. */
export function ratingsUpdatedAt(): Date | null {
  try {
    return fs.statSync(env.imdbDbPath).mtime;
  } catch {
    return null;
  }
}

/**
 * Скачать выгрузку и собрать базу рейтингов заново. Пишем во временный файл
 * своим соединением (основную базу это не трогает), потом подменяем файл.
 */
export async function refreshRatings(fetcher: typeof fetch = fetch): Promise<number> {
  const res = await fetcher(RATINGS_URL, { signal: AbortSignal.timeout(120_000), headers: { "user-agent": UA } });
  if (!res.ok || !res.body) throw new Error(`IMDb ответил ${res.status}`);
  const tmp = `${env.imdbDbPath}.tmp`;
  fs.rmSync(tmp, { force: true });
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const out = new DatabaseSync(tmp);
  let n = 0;
  try {
    out.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    out.exec("CREATE TABLE ratings (id TEXT PRIMARY KEY, rating REAL NOT NULL, votes INTEGER NOT NULL) WITHOUT ROWID");
    const ins = out.prepare("INSERT OR REPLACE INTO ratings (id, rating, votes) VALUES (?, ?, ?)");
    out.exec("BEGIN");
    const lines = readline.createInterface({ input: Readable.fromWeb(res.body as never).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      const row = parseRatingLine(line);
      if (row && row.votes >= MIN_VOTES) {
        ins.run(row.id, row.rating, row.votes);
        n++;
      }
    }
    out.exec("COMMIT");
  } finally {
    out.close();
  }
  // Меньше ста тысяч строк — выгрузка оборвалась или поменялся формат: старую базу не трогаем
  if (n < 100_000 && !process.env.IMDB_ALLOW_SMALL) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`в выгрузке IMDb всего ${n} строк`);
  }
  ratingsDb?.close();
  ratingsDb = null;
  fs.renameSync(tmp, env.imdbDbPath);
  return n;
}

export function parseRatingLine(line: string): { id: string; rating: number; votes: number } | null {
  const [id, rating, votes] = line.split("\t");
  if (!id?.startsWith("tt")) return null;
  const r = Number(rating);
  const v = Number(votes);
  return Number.isFinite(r) && Number.isFinite(v) ? { id, rating: r, votes: v } : null;
}

// ——— поиск ———

export interface Candidate {
  imdb: string;
  title: string;
  year: number | null;
  /** «2011–2019» у сериалов */
  years: string | null;
  kind: "фильм" | "сериал" | "мини-сериал" | "ТВ-фильм";
  image: string | null;
  cast: string | null;
}

const KINDS: Record<string, Candidate["kind"]> = { movie: "фильм", tvSeries: "сериал", tvMiniSeries: "мини-сериал", tvMovie: "ТВ-фильм" };

/** Ответ подсказок IMDb → кандидаты. Эпизоды, короткий метр, игры и людей отбрасываем. */
export function parseSuggestions(json: unknown): Candidate[] {
  const list = (json as { d?: Record<string, unknown>[] })?.d ?? [];
  const out: Candidate[] = [];
  for (const d of list) {
    const kind = KINDS[String(d.qid)];
    const id = String(d.id ?? "");
    if (!kind || !/^tt\d+$/.test(id) || !d.l) continue;
    const img = (d.i as { imageUrl?: string } | undefined)?.imageUrl ?? null;
    out.push({
      imdb: id,
      title: String(d.l),
      year: typeof d.y === "number" ? d.y : null,
      years: typeof d.yr === "string" ? yearsLabel(d.yr) : null,
      kind,
      image: img && isImdbImage(img) ? img : null,
      cast: d.s ? String(d.s) : null,
    });
  }
  return out;
}

/** «2011-2019» → «2011–2019», «2001-2001» → «2001», «2022-» — ещё идёт. */
function yearsLabel(yr: string): string {
  const [a, b] = yr.split("-");
  return a === b ? a : `${a}–${b ?? ""}`;
}

function isImdbImage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "m.media-amazon.com";
  } catch {
    return false;
  }
}

const searchCache = new Map<string, { at: number; items: Candidate[] }>();
const known = new Map<string, Candidate>();

export async function searchImdb(q: string, fetcher: typeof fetch = fetch): Promise<Candidate[]> {
  const key = q.trim().toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.items;
  const res = await fetcher(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(key)}.json`, {
    signal: AbortSignal.timeout(8000),
    headers: { "user-agent": UA },
  });
  if (!res.ok) throw new Error(`IMDb ответил ${res.status}`);
  const items = parseSuggestions(await res.json());
  if (searchCache.size > 500) searchCache.clear();
  searchCache.set(key, { at: Date.now(), items });
  for (const c of items) known.set(c.imdb, c);
  return items;
}

/** Кандидат по id: из недавнего поиска или тем же поиском по tt-номеру. */
export async function candidateById(imdb: string, fetcher: typeof fetch = fetch): Promise<Candidate | null> {
  return known.get(imdb) ?? (await searchImdb(imdb, fetcher)).find((c) => c.imdb === imdb) ?? null;
}

// ——— Викиданные и Википедия ———

async function sparql(query: string, fetcher: typeof fetch): Promise<Record<string, { value: string }>[]> {
  const res = await fetcher(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(6000),
    headers: { "user-agent": UA, accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`Викиданные ответили ${res.status}`);
  return ((await res.json()) as { results: { bindings: Record<string, { value: string }>[] } }).results.bindings;
}

/** Русские названия и номера Кинопоиска для списка tt-номеров одним запросом. Не ответили — пустой словарь. */
export async function wikiInfo(ids: string[], fetcher: typeof fetch = fetch): Promise<Map<string, { ru?: string; kp?: number }>> {
  const map = new Map<string, { ru?: string; kp?: number }>();
  const clean = ids.filter((id) => /^tt\d+$/.test(id));
  if (!clean.length) return map;
  try {
    const rows = await sparql(
      `SELECT ?imdb ?ru ?kp WHERE {
        VALUES ?imdb { ${clean.map((i) => `"${i}"`).join(" ")} }
        ?item wdt:P345 ?imdb .
        OPTIONAL { ?item rdfs:label ?ru FILTER(lang(?ru) = "ru") }
        OPTIONAL { ?item wdt:P2603 ?kp }
      }`,
      fetcher,
    );
    for (const r of rows) {
      const cur = map.get(r.imdb.value) ?? {};
      if (r.ru && !cur.ru) cur.ru = r.ru.value;
      if (r.kp && !cur.kp && /^\d+$/.test(r.kp.value)) cur.kp = Number(r.kp.value);
      map.set(r.imdb.value, cur);
    }
  } catch (e) {
    console.warn("imdb: Викиданные для поиска", (e as Error).message);
  }
  return map;
}

// Жанры — те же правила, что у каталога (scripts/build-movies.py), по английской
// метке жанра из Викиданных и, если меток нет, по первой фразе статьи.
const EN_RULES: [RegExp, string][] = [
  [/\banime\b/, "аниме"],
  [/(?<!live-action\/)animat|stop-motion|stop motion|cartoon|claymation/, "мультфильм"],
  [/comed|parody|satir|slapstick|farce|mockumentary|spoof|screwball|stoner film/, "комедия"],
  [/romanc|romantic|melodrama|love story/, "мелодрама"],
  [/horror|slasher|zombie|splatter|ghost film|vampire film|found footage|werewolf/, "ужасы"],
  [/science fiction|sci-fi|science-fiction|cyberpunk|space opera|dystopi|post-apocalyptic|superhero|time travel|alien invasion|kaiju|apocalyptic|space western|steampunk|mecha/, "фантастика"],
  [/fantasy|sword and sorcery|fairy tale|fairy-tale|fairytale|magic realism|magical realism/, "фэнтези"],
  [/\baction\b|martial arts|kung fu|wuxia|superhero|gun fu|swashbuckler|chase film|samurai/, "боевик"],
  [/thriller|suspense|disaster film|spy film|espionage|conspiracy/, "триллер"],
  [/crime|gangster|heist|neo-noir|film noir|\bnoir\b|mafia|yakuza|caper|hood film|prison film/, "криминал"],
  [/mystery|detective|whodunit|police procedural/, "детектив"],
  [/adventure|swashbuckler|western|treasure|survival film|road movie|jungle/, "приключения"],
  [/family film|children's film|children film|\bkids\b|christmas film/, "семейный"],
  [/\bwar film|war drama|anti-war|war movie|military film|world war|\bwar\b/, "военный"],
  [/histor|period|sword-and-sandal|sword and sandal|costume drama|jidaigeki|peplum/, "исторический"],
  [/musical|music film|dance film|\bmusic\b|concert/, "музыкальный"],
  [/biograph|biopic/, "биография"],
  [/sport|boxing|football|baseball|basketball|racing film|surf film/, "спорт"],
  [/drama|tragedy|tragicomedy/, "драма"],
];
const EN_EXCLUDE: Record<string, RegExp> = { семейный: /family drama|family saga/, исторический: /alternate history/, мультфильм: /live-action/ };
const INTRO_RULES: [RegExp, string][] = [
  [/аниме/, "аниме"],
  [/мультфильм|мультипликац|анимационн/, "мультфильм"],
  [/комеди|трагикомед|пародий/, "комедия"],
  [/мелодрам|романтическ/, "мелодрама"],
  [/фильм ужасов|хоррор|слэшер/, "ужасы"],
  [/фантастическ|научно-фантаст|антиутоп|супергеро/, "фантастика"],
  [/фэнтези|сказк/, "фэнтези"],
  [/боевик/, "боевик"],
  [/триллер|фильм-катастроф/, "триллер"],
  [/криминальн|гангстерск|нуар/, "криминал"],
  [/детектив/, "детектив"],
  [/приключенческ|вестерн|роуд-муви/, "приключения"],
  [/семейн\S* (?:фильм|комеди|мульт)|детск\S* фильм/, "семейный"],
  [/военн\S* (?:фильм|драм)|о войне/, "военный"],
  [/историческ/, "исторический"],
  [/музыкальн|мюзикл/, "музыкальный"],
  [/биографическ|байопик/, "биография"],
  [/спортивн/, "спорт"],
  [/драм/, "драма"],
];
const PRIORITY = ["аниме", "мультфильм", "комедия", "мелодрама", "ужасы", "фантастика", "фэнтези", "боевик", "криминал", "драма", "триллер", "детектив", "военный", "биография", "спорт", "музыкальный", "исторический", "приключения", "семейный"];

/** Жанры фильма: сколько меток попало в жанр, при равенстве — порядок PRIORITY. Не больше трёх. */
export function mapGenres(enLabels: string[], intro = ""): string[] {
  const score = new Map<string, number>();
  for (const raw of enLabels) {
    const label = raw.toLowerCase();
    for (const [re, g] of EN_RULES) if (re.test(label) && !EN_EXCLUDE[g]?.test(label)) score.set(g, (score.get(g) ?? 0) + 1);
  }
  if (!score.size && intro) {
    // Первая фраза: «американский научно-фантастический фильм…» — до первой точки
    const first = intro.toLowerCase().split(/(?<=[.!?])\s/)[0];
    for (const [re, g] of INTRO_RULES) if (re.test(first)) score.set(g, 1);
  }
  return [...score.keys()].sort((a, b) => (score.get(b)! - score.get(a)!) || PRIORITY.indexOf(a) - PRIORITY.indexOf(b)).slice(0, 3);
}

/** Первые одно-два предложения статьи без ударений и скобок с оригинальным названием. */
export function shortIntro(extract: string, max = 280): string {
  const text = extract
    .replace(/́/g, "")
    .replace(/\s*\((?:[^()]|\([^()]*\))*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/);
  let out = sentences[0] ?? "";
  if (sentences[1] && out.length + sentences[1].length < max) out += " " + sentences[1];
  return out.length > max ? out.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : out;
}

export interface FilmRecord {
  imdb: string;
  title: string;
  original: string | null;
  year: number | null;
  genres: string[];
  minutes: number | null;
  description: string | null;
  series: boolean;
  /** Номер на Кинопоиске: для оценки и прямой ссылки */
  kp: number | null;
}

/** Всё, что знаем о фильме: IMDb даёт основу, Викиданные и Википедия — русский текст. */
export async function filmDetails(c: Candidate, fetcher: typeof fetch = fetch): Promise<FilmRecord> {
  const series = c.kind === "сериал" || c.kind === "мини-сериал";
  const rec: FilmRecord = { imdb: c.imdb, title: c.title, original: null, year: c.year, genres: [], minutes: null, description: null, series, kp: null };
  let article: string | null = null;
  const genreLabels = new Set<string>();
  try {
    const rows = await sparql(
      `SELECT ?ru ?article ?dur ?genre ?kp WHERE {
        ?item wdt:P345 "${c.imdb}" .
        OPTIONAL { ?item wdt:P2603 ?kp }
        OPTIONAL { ?item rdfs:label ?ru FILTER(lang(?ru) = "ru") }
        OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://ru.wikipedia.org/> }
        OPTIONAL { ?item wdt:P2047 ?dur }
        OPTIONAL { ?item wdt:P136 ?g . ?g rdfs:label ?genre FILTER(lang(?genre) = "en") }
      } LIMIT 200`,
      fetcher,
    );
    for (const r of rows) {
      if (r.ru && rec.title === c.title) rec.title = r.ru.value;
      if (r.article && !article) article = decodeURIComponent(r.article.value.split("/wiki/")[1] ?? "");
      if (r.dur && !rec.minutes && !series) rec.minutes = Math.round(Number(r.dur.value)) || null;
      if (r.genre) genreLabels.add(r.genre.value);
      if (r.kp && !rec.kp && /^\d+$/.test(r.kp.value)) rec.kp = Number(r.kp.value);
    }
  } catch (e) {
    console.warn("imdb: Викиданные", c.imdb, (e as Error).message);
  }
  if (rec.title !== c.title) rec.original = c.title;
  let intro = "";
  if (article) {
    try {
      const res = await fetcher(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article)}`, {
        signal: AbortSignal.timeout(6000),
        headers: { "user-agent": UA },
      });
      if (res.ok) intro = String(((await res.json()) as { extract?: string }).extract ?? "");
    } catch (e) {
      console.warn("imdb: Википедия", article, (e as Error).message);
    }
  }
  if (intro) rec.description = shortIntro(intro);
  else if (c.cast) rec.description = `В ролях: ${c.cast}.`;
  const genres = mapGenres([...genreLabels], intro);
  rec.genres = series ? ["сериал", ...genres.filter((g) => g !== "сериал")].slice(0, 3) : genres;
  return rec;
}

const thumbs = new Map<string, Buffer>();

/**
 * Маленький постер для списка результатов. Идёт через наш сервер, а не прямо
 * с Amazon: телефону не нужно ходить к чужому хосту, и отдаём только то, что
 * недавно пришло в поиске, — открытым прокси это не становится.
 */
export async function thumbnail(imdb: string, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  const hit = thumbs.get(imdb);
  if (hit) return hit;
  const img = known.get(imdb)?.image;
  if (!img || !isImdbImage(img)) return null;
  try {
    const res = await fetcher(img.replace(/\._V1_[^/]*\.jpg$/, "._V1_QL70_UX120_.jpg"), { signal: AbortSignal.timeout(8000), headers: { "user-agent": UA } });
    if (!res.ok || !String(res.headers.get("content-type")).startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 500_000) return null;
    if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
    thumbs.set(imdb, buf);
    return buf;
  } catch {
    return null;
  }
}

/** Постер с IMDb в ширину 720 px, как у каталога (у их картинок размер задаётся прямо в имени файла): на карточке он во весь экран. */
export async function downloadPoster(c: Candidate, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!c.image || !isImdbImage(c.image)) return null;
  const url = c.image.replace(/\._V1_[^/]*\.jpg$/, "._V1_QL85_UX720_.jpg");
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": UA } });
    if (!res.ok || !String(res.headers.get("content-type")).startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 3_000_000) return null;
    const file = `${c.imdb}.jpg`;
    fs.mkdirSync(env.filmPostersDir, { recursive: true });
    fs.writeFileSync(path.join(env.filmPostersDir, file), buf);
    return file;
  } catch (e) {
    console.warn("imdb: постер", c.imdb, (e as Error).message);
    return null;
  }
}
