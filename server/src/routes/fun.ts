// Весёлая часть: вопрос дня, колоды свайпов с мэтчами, тесты на совместимость, свои идеи.
import { all, get, run } from "../db.ts";
import { bad, int, needPair, oneOf, optStr, router, str } from "../http.ts";
import { displayName, type UserRow } from "../model.ts";
import { partnerOf } from "../pairs.ts";
import { changed, isOnline, send } from "../realtime.ts";
import { esc, notifyPartner, sendTo } from "../bot.ts";
import { catalogIdeas, GENRES, movieById, movies, placeById, places, questions, testsV1 } from "../content.ts";
import { candidateById, downloadPoster, filmDetails, ratingOf, searchImdb, wikiInfo } from "../imdb.ts";
import { blend, ensureKpRatings, kpRatingOf } from "../kinopoisk.ts";
import { cardLine, cardPhoto } from "../cardPhoto.ts";
import { needPlus, testLockedV1, TESTS_V1_TEXT } from "../limits.ts";
import { isBeta } from "../beta.ts";
import { bothAnswered, DAILY_REACTIONS, dailyState } from "../daily.ts";
import { genitive } from "../home.ts";
import { today } from "../time.ts";
import { mediaUrl } from "./media.ts";

export const fun = router();

// ——— вопрос дня ———

fun.get("/daily", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const partner = partnerOf(u);
  const state = dailyState(u, partner, today());
  const days = all<{ date: string }>(
    "SELECT DISTINCT date FROM daily_answers WHERE pair_id = ? AND user_id = ? AND date < ? ORDER BY date DESC LIMIT 90",
    pairId,
    u.id,
    today(),
  );
  const archive = days.map((d) => dailyState(u, partner, d.date)).filter(Boolean);
  return c.json({ today: state, archive });
});

fun.post("/daily", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const { text, date } = await c.req.json<{ text: string; date?: string }>();
  const d = date && date <= today() ? date : today();
  if (!get("SELECT 1 FROM daily WHERE pair_id = ? AND date = ?", pairId, d)) bad("На эту дату вопроса не было");
  run(
    "INSERT INTO daily_answers (pair_id, date, user_id, text) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET text = excluded.text",
    pairId, d, u.id, str(text, 3000),
  );
  const partner = partnerOf(u);
  changed(pairId, "daily");
  if (partner && d === today()) {
    const answered = get("SELECT 1 FROM daily_answers WHERE pair_id = ? AND date = ? AND user_id = ?", pairId, d, partner.id);
    const name = esc(genitive(displayName(u)));
    void notifyPartner(
      u,
      answered
        ? `💬 <b>Вы оба ответили на вопрос дня</b>\n\nСмотри, что отвечает ${esc(displayName(u))} 👀`
        : `💬 <b>Ответ ${name} на вопрос дня уже ждёт</b>\n\nОтветь тоже, и откроются оба ответа 🔓`,
      { button: { text: "Вопрос дня", go: "daily" }, quietIfOnline: true },
    );
  }
  return c.json({ ok: true });
});

/** Дата вопроса из запроса: не из будущего и такая, на которую вопрос был. */
function dailyDate(pairId: number, date: unknown): string {
  const d = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today() ? date : today();
  if (!bothAnswered(pairId, d)) bad("Реакции и ответы откроются, когда ответите оба", 409);
  return d;
}

const dailyQuestion = (pairId: number, d: string) => {
  const qid = get<{ question_id: number }>("SELECT question_id FROM daily WHERE pair_id = ? AND date = ?", pairId, d)?.question_id;
  return questions().find((q) => q.id === qid)?.text ?? "";
};

/** Реакция на ответ половинки: один смайлик, тот же ещё раз — снять. */
fun.post("/daily/react", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<{ date?: string; emoji: string | null }>();
  const d = dailyDate(pairId, b.date);
  if (b.emoji === null) {
    run("DELETE FROM daily_reactions WHERE pair_id = ? AND date = ? AND user_id = ?", pairId, d, u.id);
  } else {
    const emoji = oneOf(b.emoji, DAILY_REACTIONS);
    const before = get<{ emoji: string }>("SELECT emoji FROM daily_reactions WHERE pair_id = ? AND date = ? AND user_id = ?", pairId, d, u.id)?.emoji;
    run(
      "INSERT INTO daily_reactions (pair_id, date, user_id, emoji) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET emoji = excluded.emoji",
      pairId, d, u.id, emoji,
    );
    if (before !== emoji) {
      void notifyPartner(u, `${emoji} <b>${esc(displayName(u))} реагирует на твой ответ</b>\n\n«${esc(dailyQuestion(pairId, d))}»`, {
        button: { text: "Вопрос дня", go: "daily" },
        quietIfOnline: true,
      });
    }
  }
  changed(pairId, "daily");
  return c.json({ ok: true });
});

/** Ответ на ответ: переписка под вопросом дня. */
fun.post("/daily/comment", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<{ date?: string; text: string }>();
  const d = dailyDate(pairId, b.date);
  const text = str(b.text, 1000);
  const { id } = run("INSERT INTO daily_comments (pair_id, date, user_id, text) VALUES (?, ?, ?, ?)", pairId, d, u.id, text);
  changed(pairId, "daily");
  void notifyPartner(u, `💬 <b>${esc(displayName(u))} отвечает на твой ответ</b>\n\n<blockquote>${esc(text.slice(0, 500))}</blockquote>`, {
    button: { text: "Ответить", go: "daily" },
    quietIfOnline: true,
  });
  return c.json({ id });
});

fun.delete("/daily/comment/:id", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  run("DELETE FROM daily_comments WHERE id = ? AND pair_id = ? AND user_id = ?", Number(c.req.param("id")), pairId, u.id);
  changed(pairId, "daily");
  return c.json({ ok: true });
});

// ——— колоды свайпов ———

const DECKS = ["movie", "idea", "place"] as const;
type Deck = (typeof DECKS)[number];

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], seed: number): T[] {
  const rnd = seeded(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type DeckItem = { id: string } & Record<string, unknown>;

function customIdeas(pairId: number): DeckItem[] {
  return all<Record<string, unknown> & { id: number; photo: string | null; author_id: number }>(
    "SELECT * FROM ideas WHERE pair_id = ? AND status != 'dropped'",
    pairId,
  ).map((r) => ({ ...r, id: `c:${r.id}`, custom: true, photoUrl: r.photo ? mediaUrl(r.photo) : null }));
}

interface FilmRow {
  imdb: string;
  title: string;
  original: string | null;
  year: number | null;
  genres: string;
  minutes: number | null;
  description: string | null;
  poster: string | null;
  series: number;
  kp: number | null;
}

function filmItem(f: FilmRow): DeckItem {
  return {
    id: `i:${f.imdb}`,
    title: f.title,
    original: f.original,
    year: f.year,
    genres: JSON.parse(f.genres) as string[],
    minutes: f.minutes,
    description: f.description,
    kp: f.kp,
    imdb: f.imdb,
    poster: null,
    posterUrl: f.poster ? `/film-posters/${f.poster}` : null,
    series: !!f.series,
  };
}

/** Фильмы, которые пара нашла на IMDb и добавила сама: в каталоге их нет. */
function addedFilms(pairId: number): DeckItem[] {
  return all<FilmRow>(
    "SELECT f.* FROM saved s JOIN films f ON s.item = 'i:' || f.imdb WHERE s.pair_id = ? AND s.deck = 'movie'",
    pairId,
  ).map(filmItem);
}

/** Общий рейтинг к карточке фильма: среднее Кинопоиска и IMDb, и обе оценки рядом — чтобы объяснить число. */
function rated(item: DeckItem): DeckItem {
  const s = blend(kpRatingOf(item.kp), ratingOf(item.imdb as string | undefined));
  return s ? { ...item, ...s } : item;
}

/** Что пара сохранила себе в колоду (например, фильмы из инстаграма): id → кто и откуда. */
function savedOf(pairId: number, deck: Deck): Map<string, { added_by: number; source: string; url: string | null }> {
  return new Map(
    all<{ item: string; added_by: number; source: string; url: string | null }>("SELECT item, added_by, source, url FROM saved WHERE pair_id = ? AND deck = ?", pairId, deck).map((r) => [r.item, r]),
  );
}

function itemsOf(deck: Deck, pairId: number): DeckItem[] {
  if (deck === "movie") return [...(movies() as unknown as DeckItem[]), ...addedFilms(pairId)];
  if (deck === "place") return places() as unknown as DeckItem[];
  return [...catalogIdeas().map((i) => ({ ...i, id: `g:${i.id}` })), ...customIdeas(pairId)];
}

export function findItem(deck: Deck, pairId: number, item: string): DeckItem | undefined {
  if (deck === "movie") {
    if (item.startsWith("i:")) {
      const f = get<FilmRow>(
        "SELECT f.* FROM saved s JOIN films f ON s.item = 'i:' || f.imdb WHERE s.pair_id = ? AND s.deck = 'movie' AND s.item = ?",
        pairId,
        item,
      );
      return f ? rated(filmItem(f)) : undefined;
    }
    const m = movieById(item) as unknown as DeckItem | undefined;
    return m ? rated(m) : undefined;
  }
  if (deck === "place") return placeById(item) as unknown as DeckItem | undefined;
  return itemsOf("idea", pairId).find((i) => i.id === item);
}

function genresOf(userId: number): string[] {
  const row = get<{ genres: string }>("SELECT genres FROM movie_prefs WHERE user_id = ?", userId);
  return row ? (JSON.parse(row.genres) as string[]) : [];
}

/** Шкала оценок карточки. Мэтч — когда обоим хотя бы «норм», а кому-то «хочу» или больше. */
export const SCORE_LABEL = ["", "не хочу", "не очень", "норм", "хочу", "очень хочу"];
export function isMatch(a: number, b: number): boolean {
  return Math.min(a, b) >= 3 && Math.max(a, b) >= 4;
}

function scoresOf(pairId: number, userId: number, deck: Deck): Map<string, number> {
  return new Map(
    all<{ item: string; score: number }>("SELECT item, score FROM swipes WHERE pair_id = ? AND user_id = ? AND deck = ?", pairId, userId, deck).map(
      (r) => [r.item, r.score],
    ),
  );
}

/**
 * Следующие карточки. Порядок общий для пары (перемешан от её id), поэтому
 * оба листают примерно одно и то же. В колоде «Куда сходить» сначала идут
 * места, которые предложила половинка, — открыто, с её оценкой: это её
 * список, а не тайный свайп. В фильмах и поездках её лайки подмешиваются
 * раньше через карточку, но не помечаются, чтобы свайп оставался честным.
 */
fun.get("/deck/:deck", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const deck = oneOf(c.req.param("deck"), DECKS);
  const limit = int(c.req.query("limit") ?? 20, 1, 50);
  const partner = partnerOf(u);
  const mine = scoresOf(pairId, u.id, deck);
  const theirs = partner ? scoresOf(pairId, partner.id, deck) : new Map<string, number>();
  // Сохранённое: фильмы из списка saved, идеи с источником (инстаграм)
  const saved = savedOf(pairId, deck);
  let pool = itemsOf(deck, pairId).filter((i) => !mine.has(i.id));
  if (deck === "movie") {
    // Жанры отсекают всё, где выбранного жанра нет среди жанров фильма («комедия» берёт и
    // «комедия, мелодрама»). Сохранёнки тоже: раньше они шли мимо фильтра и первыми, и при
    // 212 сохранёнках из инстаграма «комедия» выдавала что угодно (жалоба 04.10.2026).
    // Исключение одно — фильм, который половинка нашла и предложила сама: это приглашение,
    // оно помечено «… предлагает».
    const wanted = new Set([...genresOf(u.id), ...(partner ? genresOf(partner.id) : [])]);
    const proposedByPartner = (id: string) => !!partner && saved.get(id)?.source === "user" && saved.get(id)?.added_by === partner.id;
    if (wanted.size) pool = pool.filter((m) => proposedByPartner(m.id) || ((m.genres as string[]) ?? []).some((g) => wanted.has(g)));
  }
  const ordered = shuffle(pool, pairId * 7919 + deck.length);
  const wantedByPartner = (i: DeckItem) => (theirs.get(i.id) ?? 0) >= 3;
  const whoSaved = (i: DeckItem): number | null =>
    saved.get(i.id)?.added_by ?? (i.custom && i.source ? (i.author_id as number) : null);
  const savedName = (uid: number | null) => (uid === u.id ? "ты" : uid && partner && uid === partner.id ? displayName(partner) : null);
  const tag = (i: DeckItem): DeckItem => {
    const by = whoSaved(i);
    return by ? { ...i, savedBy: savedName(by), savedSource: saved.get(i.id)?.source ?? i.source ?? null, savedUrl: saved.get(i.id)?.url ?? i.url ?? null } : i;
  };
  let out: DeckItem[];
  if (deck === "idea") {
    const proposed = ordered.filter(wantedByPartner).sort((a, b) => (theirs.get(b.id) ?? 0) - (theirs.get(a.id) ?? 0));
    const mySaved = ordered.filter((i) => !wantedByPartner(i) && whoSaved(i) === u.id);
    const rest = ordered.filter((i) => !wantedByPartner(i) && whoSaved(i) !== u.id);
    out = [...proposed.map((i) => ({ ...tag(i), partnerScore: theirs.get(i.id), partnerName: partner ? displayName(partner) : null })), ...mySaved.map(tag), ...rest.map(tag)].slice(0, limit);
  } else {
    // Фильм, который половинка нашла и добавила сама, идёт первым и открыто: это её предложение
    const fromPartner = ordered.filter((i) => partner && saved.get(i.id)?.source === "user" && saved.get(i.id)?.added_by === partner.id);
    const others = ordered.filter((i) => !fromPartner.includes(i));
    // Свои сохранённые фильмы — следом: их ещё надо оценить самому
    const mySaved = others.filter((i) => whoSaved(i) === u.id);
    const pool2 = others.filter((i) => whoSaved(i) !== u.id);
    const liked = pool2.filter(wantedByPartner);
    const rest = pool2.filter((i) => !wantedByPartner(i));
    out = [...fromPartner, ...mySaved].slice(0, limit).map(tag);
    while (out.length < limit && (liked.length || rest.length)) {
      if (liked.length && (out.length % 2 === 1 || !rest.length)) out.push(tag(liked.shift()!));
      else if (rest.length) out.push(tag(rest.shift()!));
    }
  }
  return c.json({ items: deck === "movie" ? out.map(rated) : out, left: pool.length });
});

fun.post("/swipe", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<{ deck: Deck; item: string; liked?: boolean; score?: number }>();
  const deck = oneOf(b.deck, DECKS);
  const item = str(b.item, 80);
  const data = findItem(deck, pairId, item);
  if (!data) bad("Нет такой карточки", 404);
  const score = b.score !== undefined ? int(b.score, 1, 5) : b.liked ? 4 : 1;
  return c.json({ match: rate(u, pairId, deck, item, score, data!) });
});

/** Записать оценку и, если у половинки встречная, завести мэтч. Возвращает карточку нового мэтча. */
function rate(u: UserRow, pairId: number, deck: Deck, item: string, score: number, data: DeckItem): DeckItem | null {
  run(
    `INSERT INTO swipes (pair_id, user_id, deck, item, liked, score) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET liked = excluded.liked, score = excluded.score, created_at = datetime('now')`,
    pairId, u.id, deck, item, score >= 3 ? 1 : 0, score,
  );
  const partner = partnerOf(u);
  const theirs = partner ? get<{ score: number }>("SELECT score FROM swipes WHERE pair_id = ? AND user_id = ? AND deck = ? AND item = ?", pairId, partner.id, deck, item)?.score : undefined;
  if (!partner || theirs === undefined || !isMatch(score, theirs)) {
    // Оценку понизили — несостоявшийся мэтч убираем, если по нему ещё ничего не делали
    run("DELETE FROM matches WHERE pair_id = ? AND deck = ? AND item = ? AND status = 'new'", pairId, deck, item);
    changed(pairId, "matches");
    return null;
  }
  const created = run("INSERT OR IGNORE INTO matches (pair_id, deck, item) VALUES (?, ?, ?)", pairId, deck, item).changes > 0;
  changed(pairId, "matches");
  if (!created) return null;
  send(pairId, "match", { deck, item: data, by: u.id });
  const title = esc(String(data.title ?? data.name));
  const hot = score === 5 && theirs === 5;
  const head = hot ? "🔥 <b>Мэтч! Вы оба очень хотите</b>" : "💞 <b>Мэтч! Вы оба хотите</b>";
  const what =
    deck === "movie" ? `🍿 посмотреть <b>${title}</b>` :
    deck === "place" ? `✈️ поехать в <b>${title}</b>` :
    `${esc(String(data.emoji ?? "📍"))} <b>${title}</b>`;
  const line = esc(cardLine(deck, data));
  const next = deck === "movie" ? "Осталось выбрать вечер 😉" : deck === "place" ? "Самое время завести копилку 🐷" : "Выберите окно — и вперёд 🗓";
  const text = `${head}\n\n${what}${line ? `\n${line}` : ""}\n\n${next}`;
  // Кто сейчас в приложении, увидит мэтч вживую; остальным — в чат, с постером или фото места
  if (!isOnline(pairId, partner.id)) void sendTo(partner.id, text, { text: "Открыть мэтчи", go: `matches:${deck}` }, cardPhoto(deck, data));
  return data;
}

fun.post("/swipe/undo", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<{ deck: Deck; item: string }>();
  const deck = oneOf(b.deck, DECKS);
  run("DELETE FROM swipes WHERE pair_id = ? AND user_id = ? AND deck = ? AND item = ?", pairId, u.id, deck, str(b.item, 80));
  run("DELETE FROM matches WHERE pair_id = ? AND deck = ? AND item = ? AND status = 'new' AND created_at > datetime('now', '-2 minutes')", pairId, deck, b.item);
  changed(pairId, "matches");
  return c.json({ ok: true });
});

fun.delete("/swipes/:deck", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const deck = oneOf(c.req.param("deck"), DECKS);
  // Лайки остаются: иначе пропали бы будущие мэтчи. Сбрасываются «не хочу» и «не очень».
  run("DELETE FROM swipes WHERE pair_id = ? AND user_id = ? AND deck = ? AND score < 3", pairId, u.id, deck);
  return c.json({ ok: true });
});

/** Мэтчи рейтингом: наверху то, чего вы оба хотите сильнее всего. */
fun.get("/matches/:deck", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const deck = oneOf(c.req.param("deck"), DECKS);
  const partner = partnerOf(u);
  const mine = scoresOf(pairId, u.id, deck);
  const theirs = partner ? scoresOf(pairId, partner.id, deck) : new Map<string, number>();
  const rows = all<{ item: string; status: string; created_at: string; done_on: string | null }>(
    "SELECT * FROM matches WHERE pair_id = ? AND deck = ?",
    pairId,
    deck,
  )
    .map((r) => ({ ...r, mine: mine.get(r.item) ?? null, partner: theirs.get(r.item) ?? null, data: findItem(deck, pairId, r.item) }))
    .filter((r) => r.data)
    .sort((a, b) =>
      (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) ||
      (b.mine ?? 0) + (b.partner ?? 0) - ((a.mine ?? 0) + (a.partner ?? 0)) ||
      b.created_at.localeCompare(a.created_at),
    );
  const matched = new Set(rows.map((r) => r.item));
  // Что хочу я, но пока без ответа половинки — «ждут её оценки»
  const pending = [...mine.entries()]
    .filter(([item, sc]) => sc >= 3 && !matched.has(item) && !theirs.has(item))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([item, sc]) => ({ ...findItem(deck, pairId, item), myScore: sc }))
    .filter((x) => x.id);
  return c.json({ matches: rows, myLikes: pending, hasPartner: !!partner });
});

fun.patch("/matches/:deck/:item", async (c) => {
  const pairId = needPair(c.get("user"));
  const deck = oneOf(c.req.param("deck"), DECKS);
  const { status } = await c.req.json<{ status: string }>();
  const st = oneOf(status, ["new", "planned", "done"] as const);
  run(
    "UPDATE matches SET status = ?, done_on = ? WHERE pair_id = ? AND deck = ? AND item = ?",
    st, st === "done" ? today() : null, pairId, deck, c.req.param("item"),
  );
  changed(pairId, "matches");
  return c.json({ ok: true });
});

fun.delete("/matches/:deck/:item", (c) => {
  const pairId = needPair(c.get("user"));
  const deck = oneOf(c.req.param("deck"), DECKS);
  run("DELETE FROM matches WHERE pair_id = ? AND deck = ? AND item = ?", pairId, deck, c.req.param("item"));
  changed(pairId, "matches");
  return c.json({ ok: true });
});

// ——— фильмы: жанры и приглашение ———

fun.get("/movies/genres", (c) => {
  const u = c.get("user");
  const partner = partnerOf(u);
  const counts: Record<string, number> = {};
  for (const m of movies()) for (const g of m.genres) counts[g] = (counts[g] ?? 0) + 1;
  return c.json({
    genres: GENRES.filter((g) => counts[g]).map((g) => ({ name: g, count: counts[g] })),
    mine: genresOf(u.id),
    partner: partner ? genresOf(partner.id) : [],
    total: movies().length,
  });
});

fun.post("/movies/prefs", async (c) => {
  const u = c.get("user");
  const { genres } = await c.req.json<{ genres: string[] }>();
  const clean = (Array.isArray(genres) ? genres : []).filter((g) => GENRES.includes(g));
  run(
    "INSERT INTO movie_prefs (user_id, genres) VALUES (?, ?) ON CONFLICT DO UPDATE SET genres = excluded.genres, updated_at = datetime('now')",
    u.id,
    JSON.stringify(clean),
  );
  if (u.pair_id) changed(u.pair_id, "movie_prefs");
  return c.json({ ok: true });
});

fun.post("/movies/invite", async (c) => {
  const u = c.get("user");
  needPair(u);
  const recent = get("SELECT 1 FROM sent WHERE key = ?", `invite:${u.id}:${Math.floor(Date.now() / 120_000)}`);
  if (recent) return c.json({ ok: true });
  run("INSERT OR IGNORE INTO sent (key) VALUES (?)", `invite:${u.id}:${Math.floor(Date.now() / 120_000)}`);
  await notifyPartner(u, `🍿 <b>${esc(displayName(u))} зовёт выбрать фильм на вечер</b>\n\nЗаходи свайпать вместе: совпадёте — фильм выбран 🎬`, {
    button: { text: "Выбирать фильм", go: "movies" },
  });
  return c.json({ ok: true });
});

// ——— свои фильмы: поиск по IMDb ———

/** Название для сравнения: без регистра, «ё» и знаков препинания. */
function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

fun.get("/movies/search", async (c) => {
  const pairId = needPair(c.get("user"));
  const q = (c.req.query("q") ?? "").trim().slice(0, 80);
  if (norm(q).length < 2) return c.json({ items: [], failed: false });
  const saved = savedOf(pairId, "movie");
  const catalog = new Map(movies().map((m) => [m.imdb, m]));
  const nq = norm(q);
  // Сначала свой каталог: там русские названия и описания, и отвечает он сразу
  const local = movies().filter((m) => norm(m.title).includes(nq) || norm(m.original).includes(nq)).slice(0, 4);
  let remote: Awaited<ReturnType<typeof searchImdb>> = [];
  let failed = false;
  try {
    remote = await searchImdb(q);
  } catch (e) {
    failed = true;
    console.warn("imdb: поиск", (e as Error).message);
  }
  const shown = new Set(local.map((m) => m.imdb));
  const fresh = remote.filter((r) => !shown.has(r.imdb));
  const wiki = await wikiInfo(fresh.filter((r) => !catalog.has(r.imdb)).map((r) => r.imdb));
  const fromCatalog = (m: (typeof local)[number]) => ({
    imdb: m.imdb, id: m.id, title: m.title, original: m.original !== m.title ? m.original : null,
    year: m.year, years: null, kind: m.series ? "сериал" : "фильм", thumb: `/posters/${m.poster}`, cast: null, kp: m.kp,
  });
  const items = [
    ...local.map(fromCatalog),
    ...fresh.map((r) => {
      const m = catalog.get(r.imdb);
      if (m) return fromCatalog(m);
      const title = wiki.get(r.imdb)?.ru;
      return {
        imdb: r.imdb, id: `i:${r.imdb}`, title: title ?? r.title, original: title && title !== r.title ? r.title : null,
        year: r.year, years: r.years, kind: r.kind, thumb: r.image ? `/film-thumb/${r.imdb}` : null, cast: r.cast,
        kp: wiki.get(r.imdb)?.kp ?? null,
      };
    }),
  ];
  // Ближе к запросу — выше: IMDb по «брат» ставит первыми «Братьев по оружию», каталог — «Властелина колец»
  const closeness = (t: string | null) => {
    const n = norm(t);
    return n === nq ? 0 : n.startsWith(nq) ? 1 : n.split(" ").some((w) => w.startsWith(nq)) ? 2 : 3;
  };
  const rank = (it: (typeof items)[number]) => Math.min(closeness(it.title), closeness(it.original));
  const ranked = items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map((x) => x.it);
  await ensureKpRatings(ranked.map((it) => it.kp).filter((kp): kp is number => !!kp));
  const out = ranked.map((it) => ({ ...it, score: blend(kpRatingOf(it.kp), ratingOf(it.imdb))?.score ?? null, added: saved.has(it.id!) }));
  return c.json({ items: out, failed: failed && !local.length });
});

fun.post("/movies", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const { imdb } = await c.req.json<{ imdb: string }>();
  if (typeof imdb !== "string" || !/^tt\d{5,10}$/.test(imdb)) bad("Нет такого фильма");
  const inCatalog = movies().find((m) => m.imdb === imdb);
  const item = inCatalog ? inCatalog.id : `i:${imdb}`;
  if (!get("SELECT 1 FROM saved WHERE pair_id = ? AND deck = 'movie' AND item = ?", pairId, item)) {
    needPlus(pairId, "films", get<{ n: number }>("SELECT COUNT(*) n FROM saved WHERE pair_id = ? AND deck = 'movie' AND source = 'user'", pairId)!.n);
  }
  if (!inCatalog && !get("SELECT 1 FROM films WHERE imdb = ?", imdb)) {
    const cand = await candidateById(imdb).catch(() => null);
    if (!cand) bad("IMDb сейчас не отвечает, попробуй через минуту", 404);
    const [rec, poster] = await Promise.all([filmDetails(cand), downloadPoster(cand)]);
    run(
      "INSERT OR IGNORE INTO films (imdb, title, original, year, genres, minutes, description, poster, series, kp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      rec.imdb, rec.title, rec.original, rec.year, JSON.stringify(rec.genres), rec.minutes, rec.description, poster, rec.series, rec.kp,
    );
  }
  // Оценка Кинопоиска нужна сразу, иначе общий рейтинг до ночного обновления будет только по IMDb
  const kp = inCatalog?.kp ?? get<{ kp: number | null }>("SELECT kp FROM films WHERE imdb = ?", imdb)?.kp;
  if (kp) await ensureKpRatings([kp]);
  run("INSERT OR IGNORE INTO saved (pair_id, deck, item, added_by, source) VALUES (?, 'movie', ?, ?, 'user')", pairId, item, u.id);
  const data = findItem("movie", pairId, item)!;
  // Кто добавил, тот «за»: оценка не ниже «хочу». Если половинка уже хотела его — сразу мэтч
  const prev = get<{ score: number }>("SELECT score FROM swipes WHERE pair_id = ? AND user_id = ? AND deck = 'movie' AND item = ?", pairId, u.id, item)?.score ?? 0;
  const match = rate(u, pairId, "movie", item, Math.max(prev, 4), data);
  changed(pairId, "films");
  if (!match) {
    const line = esc(cardLine("movie", data));
    void notifyPartner(u, `🎬 <b>${esc(displayName(u))} предлагает посмотреть</b>\n\n<b>${esc(String(data.title))}</b>${line ? `\n${line}` : ""}\n\nСвайпни, если тоже хочешь 👇`, {
      button: { text: "Свайпнуть", go: "movies" },
      quietIfOnline: true,
      photo: cardPhoto("movie", data),
    });
  }
  return c.json({ id: item, title: data.title, match });
});

/** Что пара добавила сама, — чтобы видеть список и убирать лишнее. */
fun.get("/movies/added", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const partner = partnerOf(u);
  const rows = all<{ item: string; added_by: number }>(
    "SELECT item, added_by FROM saved WHERE pair_id = ? AND deck = 'movie' AND source = 'user' ORDER BY created_at DESC",
    pairId,
  );
  const items = rows.flatMap((r) => {
    const data = findItem("movie", pairId, r.item);
    return data ? [{ ...data, mine: r.added_by === u.id, by: r.added_by === u.id ? "ты" : partner ? displayName(partner) : null }] : [];
  });
  return c.json({ items });
});

fun.delete("/movies/added/:item", (c) => {
  const pairId = needPair(c.get("user"));
  const item = c.req.param("item");
  if (!get("SELECT 1 FROM saved WHERE pair_id = ? AND deck = 'movie' AND item = ? AND source = 'user'", pairId, item)) bad("Этого фильма нет среди добавленных", 404);
  run("DELETE FROM saved WHERE pair_id = ? AND deck = 'movie' AND item = ?", pairId, item);
  // Фильм из поиска уходит из колоды вместе с оценками; фильм каталога остаётся обычной карточкой
  if (item.startsWith("i:")) {
    run("DELETE FROM swipes WHERE pair_id = ? AND deck = 'movie' AND item = ?", pairId, item);
    run("DELETE FROM matches WHERE pair_id = ? AND deck = 'movie' AND item = ?", pairId, item);
  }
  changed(pairId, "films");
  return c.json({ ok: true });
});

// ——— свои идеи «куда сходить» ———

const DURATIONS = ["2h", "half", "day", "night"] as const;

fun.post("/ideas", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const b = await c.req.json<Record<string, unknown>>();
  const { id } = run(
    "INSERT INTO ideas (pair_id, author_id, title, place, price, duration, emoji, note, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    pairId, u.id, str(b.title, 120), optStr(b.place, 120), optStr(b.price, 60),
    b.duration ? oneOf(b.duration, DURATIONS) : null, optStr(b.emoji, 8), optStr(b.note, 500), optStr(b.url, 2000),
  );
  // Автор своей идеи, конечно, «за» — сразу лайк от него
  run("INSERT OR IGNORE INTO swipes (pair_id, user_id, deck, item, liked, score) VALUES (?, ?, 'idea', ?, 1, 4)", pairId, u.id, `c:${id}`);
  changed(pairId, "ideas");
  const where = optStr(b.place, 120);
  void notifyPartner(u, `💡 <b>Новая идея от ${esc(genitive(displayName(u)))}</b>\n\n${esc(optStr(b.emoji, 8) ?? "📍")} <b>${esc(str(b.title, 120))}</b>${where ? `\n📍 ${esc(where)}` : ""}\n\nСвайпни, если тоже хочешь 👇`, {
    button: { text: "Свайпнуть", go: "ideas" },
    quietIfOnline: true,
  });
  return c.json({ id: `c:${id}` });
});

fun.delete("/ideas/:id", (c) => {
  const pairId = needPair(c.get("user"));
  const raw = c.req.param("id").replace(/^c:/, "");
  run("UPDATE ideas SET status = 'dropped' WHERE id = ? AND pair_id = ?", Number(raw), pairId);
  run("DELETE FROM matches WHERE pair_id = ? AND deck = 'idea' AND item = ?", pairId, `c:${raw}`);
  changed(pairId, "ideas");
  return c.json({ ok: true });
});

// ——— тесты на совместимость, старые (до 08.10.2026) ———
//
// Новые тесты (формат 2, routes/testy.ts) пока только у пары владельца (beta.ts).
// Остальные пары видят эти семь тестов, как раньше. Маршруты /tests и /tests/:id
// общие с новыми: бете этот обработчик уступает дорогу (next) — дальше отвечает testy.ts.

fun.get("/tests", async (c, next) => {
  const u = c.get("user");
  if (isBeta(u)) return next();
  const pairId = needPair(u);
  const partner = partnerOf(u);
  const done = all<{ test_id: string; user_id: number }>("SELECT test_id, user_id FROM test_answers WHERE pair_id = ?", pairId);
  return c.json({
    tests: testsV1().map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      emoji: t.emoji,
      description: t.description,
      minutes: t.minutes,
      count: t.questions.length,
      locked: testLockedV1(pairId, t.id),
      mine: done.some((d) => d.test_id === t.id && d.user_id === u.id),
      partner: !!partner && done.some((d) => d.test_id === t.id && d.user_id === partner.id),
    })),
  });
});

fun.get("/tests/:id", async (c, next) => {
  const u = c.get("user");
  if (isBeta(u)) return next();
  const pairId = needPair(u);
  const test = testsV1().find((t) => t.id === c.req.param("id"));
  if (!test) bad("Нет теста", 404);
  if (testLockedV1(pairId, test!.id)) needPlus(pairId, "tests", 0, TESTS_V1_TEXT);
  const partner = partnerOf(u);
  const row = (uid: number) =>
    get<{ answers: string }>("SELECT answers FROM test_answers WHERE pair_id = ? AND test_id = ? AND user_id = ?", pairId, test!.id, uid);
  const mine = row(u.id);
  const theirs = partner ? row(partner.id) : undefined;
  return c.json({
    test,
    mine: mine ? JSON.parse(mine.answers) : null,
    partnerDone: !!theirs,
    // Ответы половинки открываются, только когда прошли оба
    partner: mine && theirs ? JSON.parse(theirs.answers) : null,
  });
});

fun.post("/tests/:id", async (c, next) => {
  const u = c.get("user");
  if (isBeta(u)) return next();
  const pairId = needPair(u);
  const test = testsV1().find((t) => t.id === c.req.param("id"));
  if (!test) bad("Нет теста", 404);
  if (testLockedV1(pairId, test!.id)) needPlus(pairId, "tests", 0, TESTS_V1_TEXT);
  const { answers } = await c.req.json<{ answers: unknown }>();
  const json = JSON.stringify(answers ?? {});
  if (json.length > 20000) bad("Слишком большой ответ");
  run(
    "INSERT INTO test_answers (pair_id, test_id, user_id, answers) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET answers = excluded.answers, finished_at = datetime('now')",
    pairId, test!.id, u.id, json,
  );
  changed(pairId, "tests");
  const partner = partnerOf(u);
  if (partner) {
    const both = get("SELECT 1 FROM test_answers WHERE pair_id = ? AND test_id = ? AND user_id = ?", pairId, test!.id, partner.id);
    void notifyPartner(
      u,
      both
        ? `${test!.emoji} <b>Результаты готовы!</b>\n\nВы оба прошли тест «${esc(test!.title)}». Смотри, насколько совпали 💞`
        : `${test!.emoji} <b>${esc(displayName(u))} проходит тест «${esc(test!.title)}»</b>\n\nПройди тоже, и откроется общий результат 🔓`,
      { button: { text: both ? "Смотреть" : "Пройти", go: `test:${test!.id}` }, quietIfOnline: true },
    );
  }
  return c.json({ ok: true });
});
