// Картинка карточки колоды на нашем диске — для сообщений бота: постер
// фильма, фото направления или места. Строка под заголовком — год, рейтинг
// и жанры, как на карточке в приложении.
import path from "node:path";
import { env } from "./env.ts";
import type { Photo } from "./bot.ts";

type Card = Record<string, unknown> | null | undefined;

export function cardPhoto(deck: string, item: Card): Photo | null {
  if (!item) return null;
  if (deck === "movie") {
    const own = typeof item.posterUrl === "string" && item.posterUrl.startsWith("/film-posters/");
    if (own) return { path: path.join(env.filmPostersDir, path.basename(String(item.posterUrl))) };
    return item.poster ? { path: path.join(env.dataDir, "posters", path.basename(String(item.poster))) } : null;
  }
  if (deck === "place") return item.image ? { path: path.join(env.dataDir, "places", path.basename(String(item.image))) } : null;
  // Место: своё фото пары или картинка из каталога
  if (typeof item.photo === "string" && item.photo) return { path: path.join(env.photosDir, item.photo) };
  return item.image ? { path: path.join(env.dataDir, "ideas", path.basename(String(item.image))) } : null;
}

/** «★ 8,3 · 2022 · сериал, фантастика» для фильма; для мест — где и сколько стоит. */
export function cardLine(deck: string, item: Card): string {
  if (!item) return "";
  const parts: string[] = [];
  if (deck === "movie") {
    if (typeof item.score === "number") parts.push(`★ ${item.score.toFixed(1).replace(".", ",")}`);
    if (item.year) parts.push(String(item.year));
    const g = (item.genres as string[] | undefined)?.slice(0, 2).join(", ");
    if (g) parts.push(g);
  } else if (deck === "place") {
    if (item.country) parts.push(`${item.flag ?? ""} ${item.country}`.trim());
    if (item.route) parts.push(String(item.route));
  } else {
    if (item.place) parts.push(`📍 ${item.place}`);
    if (item.price) parts.push(String(item.price));
  }
  return parts.join(" · ");
}
