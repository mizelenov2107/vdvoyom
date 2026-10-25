#!/usr/bin/env python3
"""Добавить в каталог фильмы и сериалы по названиям (например, из сохранёнок).

    python3 add-films.py названия.json [--contact почта]

На входе — JSON-массив {"ru", "en", "year"}; ищет каждое название в Wikidata,
берёт фильм или сериал с русской статьёй, описанием и постером — тем же путём,
что и основная сборка build-movies.py, но без порога по году: в сохранёнках
есть классика 1950-х. Новые записи дописываются в data/movies.json, найденные
id печатаются в stdout одним JSON-массивом.
"""
import importlib.util
import json
import re
import sys
import unicodedata
from pathlib import Path

spec = importlib.util.spec_from_file_location("bm", Path(__file__).with_name("build-movies.py"))
bm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bm)

SERIES = {"Q5398426", "Q581714", "Q63952888", "Q1259759", "Q117467246"}
FILM_OK = set(bm.FILM_TYPES) | SERIES


def norm(s):
    s = unicodedata.normalize("NFKC", s or "").lower().replace("ё", "е")
    return re.sub(r"[^a-zа-я0-9]+", "", s)


def search(title, lang):
    text = bm.fetch(bm.WD_API, data={"action": "wbsearchentities", "search": title, "language": lang,
                                     "uselang": lang, "type": "item", "limit": "8", "format": "json"})
    return [r["id"] for r in json.loads(text).get("search", [])]


def choose(want):
    ids = []
    for q, lang in [(want["ru"], "ru"), (want.get("en"), "en")]:
        if q:
            ids += [i for i in search(q, lang) if i not in ids]
    if not ids:
        return None
    films = bm.film_details(ids, GENRE_LABELS)
    good = [films[i] for i in ids if i in films and set(films[i]["types"]) & FILM_OK
            and not (set(films[i]["types"]) | set(films[i]["genres_q"])) & bm.BANNED
            and films[i]["ru"] and films[i]["ru_article"] and films[i]["year"]]
    if not good:
        return None
    names = {norm(want["ru"]), norm(want.get("en"))} - {""}

    def rank(f):
        exact = norm(bm.clean_title(f["ru"])) in names or norm(f["en"]) in names
        year = want.get("year") and abs(f["year"] - want["year"]) <= 1
        return (not year, not exact)

    good.sort(key=rank)
    best = good[0]
    # Без года и без точного совпадения имени — лучше пропустить, чем угадать не то
    if rank(best) == (True, True):
        return None
    return best


GENRE_LABELS = {}


def season_images(f):
    """У сериала в карточке статьи обычно логотип; вертикальный постер есть в статье о первом сезоне."""
    base = f["en_article"] or f["en"]
    if not base:
        return []
    stem = re.sub(r" \((?:[A-Za-z]+ )?(?:\d{4} )?TV series\)$", "", base)
    cands = []
    for b in dict.fromkeys([base, stem]):
        cands += [f"{b} season 1", f"{b} (season 1)", f"{b} series 1", f"{b} (series 1)"]
    imgs = bm.page_images("en", cands)
    return [imgs[c] for c in cands if c in imgs]


def main():
    args = sys.argv[1:]
    if "--contact" in args:
        bm.UA = f"VdvoyomCatalog/0.1 ({args[args.index('--contact') + 1]})"
        bm.GAPS["api"] = 0.5
    wants = json.loads(Path(args[0]).read_text())
    catalog = json.loads(bm.OUT.read_text())
    have = {m["id"] for m in catalog}
    found, added, skipped = [], [], []
    picked = []
    for w in wants:
        f = choose(w)
        if not f:
            skipped.append(w["ru"])
            continue
        if f["id"] in have:
            found.append(f["id"])
            continue
        picked.append(f)
        print(f"  {w['ru']} → {f['ru']} ({f['year']}, {f['id']})", file=sys.stderr)
    texts = bm.ru_wikitexts(f["ru_article"] for f in picked)
    intros = bm.ru_intros([f["ru_article"] for f in picked])
    en_imgs = bm.page_images("en", [f["en_article"] for f in picked if f["en_article"]])
    ru_imgs = bm.page_images("ru", [f["ru_article"] for f in picked])
    for f in picked:
        rec = bm.build_record(f, GENRE_LABELS, texts.get(f["ru_article"]), intros.get(f["ru_article"]))
        if rec is None:
            skipped.append(f"{f['ru']} (нет жанра или описания)")
            continue
        if set(f["types"]) & SERIES:
            rec["genres"] = (["сериал"] + [g for g in rec["genres"] if g != "сериал"])[:3]
            rec["series"] = True
        imgs = [en_imgs.get(f["en_article"]), ru_imgs.get(f["ru_article"])]
        if f["countries"] & set(bm.RU_COUNTRIES):
            imgs.reverse()
        imgs = [i for i in imgs if bm.poster_ok(i)]
        if set(f["types"]) & SERIES:
            # Обложка сезона бывает чуть шире постера (DVD-бокс), ей прощаем пропорции до 1,1
            imgs += [i for i in season_images(f) if i[1] >= 120 and 1.1 <= i[2] / i[1] <= 1.9
                     and not i[3].lower().endswith((".svg", ".gif"))]
        if not imgs or not any(bm.download_poster(f["id"], i[0]) for i in imgs):
            skipped.append(f"{f['ru']} (нет постера)")
            continue
        catalog.append(rec)
        have.add(rec["id"])
        added.append(rec["id"])
        found.append(rec["id"])
    bm.OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n")
    print(f"добавлено {len(added)}, уже было {len(found) - len(added)}, пропущено {len(skipped)}", file=sys.stderr)
    for s in skipped:
        print(f"    пропущено: {s}", file=sys.stderr)
    print(json.dumps({"ids": found, "added": added}, ensure_ascii=False))


if __name__ == "__main__":
    main()
