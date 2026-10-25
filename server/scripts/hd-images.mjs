// Картинки колод в хорошем качестве. Запускать на маке из server/:
//   node scripts/hd-images.mjs            — всё, что ещё не -hd
//   node scripts/hd-images.mjs posters    — только постеры
// Нужен cwebp (brew install webp).
//
// Почему: постеры каталога взяты из Википедии, а она хранит их по 220–260 px
// (правило несвободных файлов). Карточка свайпа на айфоне — около 1000 px,
// постер растягивался в четыре раза. Теперь:
// - постеры — с IMDb по tt-номеру, 720 px по ширине, WebP q70 (~95 КБ);
// - места и направления — с Викисклада по ссылке из credit, 1200 px, WebP q72.
// Файлы получают новые имена <id>-hd.webp: старые адреса закэшированы у людей
// на 30 дней (immutable), с прежним именем обновление никто бы не увидел.
// Не нашлось картинки — остаётся старая, в конце скрипт пишет список.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve(import.meta.dirname, "..", "data");
const TMP = fs.mkdtempSync("/tmp/vdvoyom-hd-");
const UA = "vdvoyom/1.0 (https://github.com/mizelenov2107/vdvoyom)";
const only = process.argv[2];

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return r;
      if (r.status === 404) return null;
    } catch {
      /* повтор */
    }
    await new Promise((r) => setTimeout(r, 1500 * i));
  }
  return null;
}

function toWebp(src, dst, width, q) {
  execFileSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", "-sharp_yuv", "-resize", String(width), "0", src, "-o", dst]);
}

/** По несколько за раз, чтобы не долбить чужие сервера. */
async function each(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) await fn(list[i++]);
  }));
}

async function posters() {
  const file = path.join(DATA, "movies.json");
  const movies = JSON.parse(fs.readFileSync(file, "utf8"));
  const todo = movies.filter((m) => m.imdb && !String(m.poster).includes("-hd."));
  const failed = [];
  let done = 0;
  await each(todo, 5, async (m) => {
    const r = await get(`https://v3.sg.media-imdb.com/suggestion/x/${m.imdb}.json`);
    const img = r ? (await r.json()).d?.find((d) => d.id === m.imdb)?.i?.imageUrl : null;
    if (!img) return failed.push(`${m.title} (${m.imdb}): у IMDb нет постера`);
    const jpg = await get(img.replace(/\._V1_[^/]*\.jpg$/, "._V1_QL90_UX720_.jpg"));
    if (!jpg) return failed.push(`${m.title}: постер не скачался`);
    const tmp = path.join(TMP, `${m.id}.jpg`);
    fs.writeFileSync(tmp, Buffer.from(await jpg.arrayBuffer()));
    const name = `${m.id}-hd.webp`;
    toWebp(tmp, path.join(DATA, "posters", name), 720, 70);
    const old = m.poster;
    m.poster = name;
    if (old && old !== name) fs.rmSync(path.join(DATA, "posters", old), { force: true });
    if (++done % 50 === 0) console.log(`постеры: ${done} из ${todo.length}`);
  });
  fs.writeFileSync(file, JSON.stringify(movies, null, 1) + "\n");
  console.log(`постеры: обновлено ${done} из ${todo.length}`);
  return failed;
}

/** Картинки мест и направлений: файл Викисклада из credit.source, 1200 px. */
async function commons(kind) {
  const file = path.join(DATA, `${kind}.json`);
  const items = JSON.parse(fs.readFileSync(file, "utf8"));
  const todo = items.filter((it) => it.image && !it.image.includes("-hd.") && /commons\.wikimedia\.org\/wiki\/File:/.test(it.credit?.source ?? ""));
  const failed = items.filter((it) => it.image && !it.image.includes("-hd.") && !todo.includes(it)).map((it) => `${it.name ?? it.title}: нет ссылки на Викисклад`);
  let done = 0;
  await each(todo, 2, async (it) => {
    const title = decodeURIComponent(it.credit.source.split("/wiki/File:")[1]);
    const r = await get(`https://commons.wikimedia.org/w/index.php?title=Special:FilePath/${encodeURIComponent(title)}&width=1400`);
    if (!r) return failed.push(`${it.name ?? it.title}: Викисклад не отдал файл`);
    const tmp = path.join(TMP, `${it.id}.src`);
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    const name = `${it.id}-hd.webp`;
    try {
      toWebp(tmp, path.join(DATA, kind, name), 1200, 72);
    } catch {
      return failed.push(`${it.name ?? it.title}: не перекодировался`);
    }
    const old = it.image;
    it.image = name;
    if (old && old !== name) fs.rmSync(path.join(DATA, kind, old), { force: true });
    done++;
  });
  fs.writeFileSync(file, JSON.stringify(items, null, 1) + "\n");
  console.log(`${kind}: обновлено ${done} из ${todo.length}`);
  return failed;
}

const failed = [];
if (!only || only === "posters") failed.push(...(await posters()));
if (!only || only === "places") failed.push(...(await commons("places")));
if (!only || only === "ideas") failed.push(...(await commons("ideas")));
fs.rmSync(TMP, { recursive: true, force: true });
if (failed.length) console.log(`\nОстались старые (${failed.length}):\n${failed.join("\n")}`);
