import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { Hono } from "hono";
import { get, run } from "../src/db.ts";
import type { AppEnv } from "../src/http.ts";
import type { UserRow } from "../src/model.ts";
import { ensurePair, joinPair } from "../src/pairs.ts";
import { fun } from "../src/routes/fun.ts";
import { mapGenres, parseRatingLine, parseSuggestions, refreshRatings, shortIntro } from "../src/imdb.ts";
import { movies } from "../src/content.ts";
import { blend, parseKpXml } from "../src/kinopoisk.ts";

// Сеть подменена: подсказки IMDb, Викиданные, Википедия, постер и выгрузка рейтингов
const RATINGS = "tconst\taverageRating\tnumVotes\ntt13238346\t7.8\t178295\ntt0000001\t5.7\t20\n";
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
  if (url.startsWith("https://v3.sg.media-imdb.com/")) {
    return json({
      d: [
        { id: "tt13238346", l: "Past Lives", qid: "movie", y: 2023, s: "Greta Lee, Teo Yoo", i: { imageUrl: "https://m.media-amazon.com/images/M/X@._V1_.jpg" } },
        { id: "tt9999999", l: "Past Lives: Episode 3", qid: "tvEpisode", y: 2024 },
        { id: "nm0000001", l: "Какой-то актёр" },
      ],
    });
  }
  if (url.startsWith("https://query.wikidata.org/")) {
    return json({
      results: {
        bindings: [
          { imdb: { value: "tt13238346" }, ru: { value: "Прошлые жизни" }, article: { value: "https://ru.wikipedia.org/wiki/%D0%9F%D1%80%D0%BE%D1%88%D0%BB%D1%8B%D0%B5_%D0%B6%D0%B8%D0%B7%D0%BD%D0%B8" }, dur: { value: "106" }, genre: { value: "drama film" }, kp: { value: "4516789" } },
          { imdb: { value: "tt13238346" }, ru: { value: "Прошлые жизни" }, genre: { value: "romance film" } },
        ],
      },
    });
  }
  if (url.startsWith("https://ru.wikipedia.org/")) {
    return json({ extract: "«Прошлые жизни» (англ. Past Lives) — американский фильм 2023 года режиссёра Селин Сон. Второе предложение. Третье." });
  }
  if (url.startsWith("https://rating.kinopoisk.ru/4516789.xml")) {
    return new Response('<?xml version="1.0" encoding="WINDOWS-1251"?><rating><kp_rating num_vote="45120">7.612</kp_rating><imdb_rating num_vote="178000">7.8</imdb_rating></rating>');
  }
  if (url.startsWith("https://rating.kinopoisk.ru/")) return new Response("<rating><kp_rating num_vote=\"0\">0</kp_rating></rating>");
  if (url.startsWith("https://m.media-amazon.com/")) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
  if (url.startsWith("https://datasets.imdbws.com/")) return new Response(new Uint8Array(zlib.gzipSync(RATINGS)));
  throw new Error(`неожиданный запрос ${url}`);
}) as typeof fetch;

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("user", get<UserRow>("SELECT * FROM users WHERE id = ?", Number(c.req.header("x-user")))!);
  await next();
});
app.route("/", fun);
const call = async (uid: number, path: string, body?: unknown, method?: string) => {
  const res = await app.request(path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "x-user": String(uid), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, any> };
};

test("подсказки IMDb: только фильмы и сериалы, годы сериала по-человечески", () => {
  const c = parseSuggestions({
    d: [
      { id: "tt1", l: "Фильм", qid: "movie", y: 2020 },
      { id: "tt2", l: "Мини", qid: "tvMiniSeries", y: 2001, yr: "2001-2001" },
      { id: "tt3", l: "Сериал", qid: "tvSeries", y: 2022, yr: "2022-" },
      { id: "tt4", l: "Серия", qid: "tvEpisode" },
      { id: "nm1", l: "Человек" },
      { id: "tt5", l: "Постер с чужого сайта", qid: "movie", i: { imageUrl: "http://evil.local/x.jpg" } },
    ],
  });
  assert.deepEqual(c.map((x) => x.imdb), ["tt1", "tt2", "tt3", "tt5"]);
  assert.equal(c[1].years, "2001");
  assert.equal(c[2].years, "2022–");
  assert.equal(c[3].image, null, "картинки берём только с m.media-amazon.com");
});

test("информер Кинопоиска и общий рейтинг", () => {
  assert.deepEqual(parseKpXml('<rating><kp_rating num_vote="1194517">8.684</kp_rating><imdb_rating num_vote="2500000">8.7</imdb_rating></rating>'), { rating: 8.684, votes: 1194517 });
  assert.equal(parseKpXml('<rating><kp_rating num_vote="12">6.1</kp_rating></rating>'), null, "двенадцать голосов — не оценка");
  assert.equal(blend({ rating: 8.684, votes: 1 }, { rating: 8.7, votes: 1 })?.score, 8.7);
  assert.equal(blend({ rating: 7.612, votes: 1 }, { rating: 7.8, votes: 1 })?.score, 7.7);
  assert.equal(blend(null, { rating: 6.4, votes: 1 })?.score, 6.4, "одна оценка — берём её");
  assert.equal(blend(null, null), null);
});

test("строки выгрузки рейтингов", () => {
  assert.deepEqual(parseRatingLine("tt0816692\t8.7\t2611246"), { id: "tt0816692", rating: 8.7, votes: 2611246 });
  assert.equal(parseRatingLine("tconst\taverageRating\tnumVotes"), null);
});

test("жанры по меткам Викиданных, а без них — по первой фразе статьи", () => {
  assert.deepEqual(mapGenres(["science fiction film", "drama film", "psychological thriller"]), ["фантастика", "драма", "триллер"]);
  assert.deepEqual(mapGenres(["family drama"]), ["драма"], "семейная драма — не семейный фильм");
  assert.deepEqual(mapGenres([], "«Х» — американский фильм ужасов 2020 года. Драма тут ни при чём."), ["ужасы"]);
});

test("описание из статьи: без скобок с оригиналом, не длиннее двух фраз", () => {
  const s = shortIntro("«Бра́т» (англ. Brother) — российский криминальный фильм 1997 года. Второе. Третье.");
  assert.equal(s, "«Брат» — российский криминальный фильм 1997 года. Второе.");
});

test("свой фильм из поиска: у половинки первым, вопреки её жанрам, и уходит целиком", async () => {
  process.env.IMDB_ALLOW_SMALL = "1";
  assert.equal(await refreshRatings(fakeFetch), 1, "меньше ста голосов не храним");
  globalThis.fetch = fakeFetch;

  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9101, 'Аня', 1), (9102, 'Боря', 1)");
  const pair = ensurePair(9101);
  assert.equal(joinPair(9102, pair.invite_code).ok, true);
  // У Бори в колоде только комедии, а «Прошлые жизни» — драма
  run("INSERT OR REPLACE INTO movie_prefs (user_id, genres) VALUES (9102, '[\"комедия\"]')");

  const found = await call(9101, "/movies/search?q=past lives");
  assert.equal(found.status, 200);
  assert.equal(found.data.items.length, 1, "эпизоды и люди отброшены");
  assert.equal(found.data.items[0].title, "Прошлые жизни");
  assert.equal(found.data.items[0].original, "Past Lives");
  assert.equal(found.data.items[0].score, 7.7, "среднее Кинопоиска 7,6 и IMDb 7,8");
  assert.equal(found.data.items[0].added, false);

  const added = await call(9101, "/movies", { imdb: "tt13238346" });
  assert.equal(added.status, 200);
  assert.equal(added.data.id, "i:tt13238346");
  const film = get<{ title: string; genres: string; minutes: number; description: string; poster: string }>("SELECT * FROM films WHERE imdb = 'tt13238346'")!;
  assert.equal(film.title, "Прошлые жизни");
  assert.deepEqual(JSON.parse(film.genres), ["мелодрама", "драма"]);
  assert.equal(film.minutes, 106);
  assert.equal(film.poster, "tt13238346.jpg");
  assert.equal((film as { kp?: number }).kp, 4516789, "номер Кинопоиска из Викиданных");
  assert.equal(get<{ score: number }>("SELECT score FROM swipes WHERE user_id = 9101 AND item = 'i:tt13238346'")?.score, 4, "у добавившего сразу «хочу»");

  const deck = await call(9102, "/deck/movie?limit=5");
  const first = deck.data.items[0];
  assert.equal(first.id, "i:tt13238346");
  assert.equal(first.savedSource, "user");
  assert.equal(first.savedBy, "Аня");
  assert.equal(first.score, 7.7);
  assert.equal(first.kpRating, 7.6);
  assert.equal(first.imdbRating, 7.8);
  assert.equal(first.kp, 4516789, "ссылка на Кинопоиск будет прямой");
  assert.equal(first.posterUrl, "/film-posters/tt13238346.jpg");

  const again = await call(9101, "/movies/search?q=past lives");
  assert.equal(again.data.items[0].added, true);

  const swipe = await call(9102, "/swipe", { deck: "movie", item: "i:tt13238346", score: 5 });
  assert.equal(swipe.data.match?.title, "Прошлые жизни");
  const matches = await call(9101, "/matches/movie");
  assert.equal(matches.data.matches[0].data.score, 7.7);

  const list = await call(9101, "/movies/added");
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].mine, true);

  const del = await call(9102, "/movies/added/i%3Att13238346", undefined, "DELETE");
  assert.equal(del.status, 200);
  const after = await call(9102, "/deck/movie?limit=50");
  assert.ok(!after.data.items.some((i: { id: string }) => i.id === "i:tt13238346"));
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM matches WHERE pair_id = ? AND item = 'i:tt13238346'", pair.id)!.n, 0);
});

test("фильм из каталога добавляется без сети и встречает готовый лайк мэтчем", async () => {
  globalThis.fetch = (async () => {
    throw new Error("сеть не нужна");
  }) as typeof fetch;
  const m = movies()[0];
  const pairId = get<UserRow>("SELECT * FROM users WHERE id = 9101")!.pair_id!;
  run("INSERT INTO swipes (pair_id, user_id, deck, item, liked, score) VALUES (?, 9102, 'movie', ?, 1, 4)", pairId, m.id);
  const r = await call(9101, "/movies", { imdb: m.imdb });
  assert.equal(r.status, 200);
  assert.equal(r.data.id, m.id);
  assert.equal(r.data.match?.id, m.id, "Боря уже хотел этот фильм — сразу мэтч");
});

test("жанры отсекают и сохранёнки: «комедия» — только фильмы с комедией среди жанров", async () => {
  run("INSERT OR REPLACE INTO users (id, first_name, onboarded) VALUES (9121, 'Жанровый', 1)");
  const pairId = ensurePair(9121).id;
  // Сохранёнка из инстаграма — драма: раньше она шла первой мимо фильтра
  const drama = (movies() as { id: string; genres: string[] }[]).find((m) => !m.genres.includes("комедия"))!;
  run("INSERT INTO saved (pair_id, deck, item, added_by, source) VALUES (?, 'movie', ?, 9121, 'instagram')", pairId, drama.id);
  run("INSERT OR REPLACE INTO movie_prefs (user_id, genres) VALUES (9121, ?)", JSON.stringify(["комедия"]));
  const deck = await call(9121, "/deck/movie?limit=40");
  const items = deck.data.items as { id: string; genres: string[] }[];
  assert.ok(items.length >= 20);
  assert.ok(items.every((i) => i.genres.includes("комедия")), "все карточки — с комедией");
  assert.ok(items.some((i) => i.genres.length > 1 && i.genres.includes("мелодрама")), "«комедия, мелодрама» тоже в колоде");
  assert.ok(!items.some((i) => i.id === drama.id), "сохранённая драма отсечена");
});
