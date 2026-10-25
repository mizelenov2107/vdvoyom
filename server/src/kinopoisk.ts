// Оценка Кинопоиска и общий рейтинг фильма.
//
// Кинопоиск отдаёт оценку фильма открытым информером rating.kinopoisk.ru/<id>.xml
// (его ставят на сайты виджетом). Страницы фильмов с сервера уводят на вход
// Яндекса, поэтому только он. Оценки лежат в kp_ratings и обновляются раз в
// неделю понемногу — по 25 фильмов в минуту, чтобы не долбить их сервер.
//
// Общий рейтинг — среднее Кинопоиска и IMDb: первый ближе к нашим зрителям,
// второй — к мировым. Есть только одна оценка — берём её.
import { all, get, run } from "./db.ts";
import { movies } from "./content.ts";

const WEEK_SQL = "-7 days";
/** Меньше ста голосов — оценка случайная, как и у IMDb. */
const MIN_VOTES = 100;

export function parseKpXml(xml: string): { rating: number; votes: number } | null {
  const m = /<kp_rating[^>]*num_vote="(\d+)"[^>]*>([\d.]+)<\/kp_rating>/.exec(xml);
  if (!m) return null;
  const rating = Number(m[2]);
  const votes = Number(m[1]);
  return rating > 0 && votes >= MIN_VOTES ? { rating, votes } : null;
}

export function kpRatingOf(kp: unknown): { rating: number; votes: number } | null {
  if (!kp) return null;
  const row = get<{ rating: number | null; votes: number | null }>("SELECT rating, votes FROM kp_ratings WHERE kp = ?", Number(kp));
  return row?.rating ? { rating: row.rating, votes: row.votes ?? 0 } : null;
}

/** Спросить Кинопоиск и запомнить ответ. Сеть упала — ничего не пишем, повторим позже. */
export async function fetchKpRating(kp: number, fetcher: typeof fetch = fetch): Promise<{ rating: number; votes: number } | null> {
  const res = await fetcher(`https://rating.kinopoisk.ru/${kp}.xml`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Кинопоиск ответил ${res.status}`);
  const r = parseKpXml(await res.text());
  // Оценки нет (фильм не вышел, мало голосов) — тоже запоминаем, чтобы не спрашивать каждую минуту
  run(
    `INSERT INTO kp_ratings (kp, rating, votes, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT DO UPDATE SET rating = excluded.rating, votes = excluded.votes, updated_at = excluded.updated_at`,
    kp, r?.rating ?? null, r?.votes ?? null,
  );
  return r;
}

/** Оценки для списка фильмов разом: чего нет в базе, спрашиваем параллельно. */
export async function ensureKpRatings(ids: number[], fetcher: typeof fetch = fetch): Promise<void> {
  const missing = ids.filter((kp) => kp && !get("SELECT 1 FROM kp_ratings WHERE kp = ?", kp));
  await Promise.all(missing.map((kp) => fetchKpRating(kp, fetcher).catch(() => null)));
}

/** Для крона: несколько фильмов, чья оценка старше недели или ещё не спрошена. */
export async function refreshStaleKp(limit = 25, fetcher: typeof fetch = fetch): Promise<number> {
  const fresh = new Set(all<{ kp: number }>(`SELECT kp FROM kp_ratings WHERE updated_at > datetime('now', '${WEEK_SQL}')`).map((r) => r.kp));
  const ids = [...movies().map((m) => m.kp), ...all<{ kp: number }>("SELECT kp FROM films WHERE kp IS NOT NULL").map((r) => r.kp)];
  const stale = [...new Set(ids)].filter((kp): kp is number => !!kp && !fresh.has(kp)).slice(0, limit);
  let n = 0;
  for (const kp of stale) {
    try {
      await fetchKpRating(kp, fetcher);
      n++;
    } catch {
      break; // Кинопоиск не отвечает — дождёмся следующей минуты
    }
  }
  return n;
}

export interface Score {
  score: number;
  kpRating: number | null;
  kpVotes: number | null;
  imdbRating: number | null;
  imdbVotes: number | null;
}

/** Общий рейтинг: среднее двух оценок, округлённое до десятых. */
export function blend(kp: { rating: number; votes: number } | null, imdb: { rating: number; votes: number } | null): Score | null {
  const parts = [kp?.rating, imdb?.rating].filter((x): x is number => typeof x === "number");
  if (!parts.length) return null;
  return {
    score: Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10,
    kpRating: kp ? Math.round(kp.rating * 10) / 10 : null,
    kpVotes: kp?.votes ?? null,
    imdbRating: imdb?.rating ?? null,
    imdbVotes: imdb?.votes ?? null,
  };
}
