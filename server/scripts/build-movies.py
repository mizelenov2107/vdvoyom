#!/usr/bin/env python3
"""Собирает каталог фильмов для свайп-колоды «что посмотреть вдвоём».

Источники без ключей:
  * Wikidata SPARQL — кандидаты, сортировка по числу sitelinks, метаданные;
  * API ru-Википедии — просмотры статей (для отбора советских и российских хитов)
    и описание из вводной части статьи (extracts);
  * API en/ru-Википедии (pageimages) — постер.

Результат: server/data/movies.json и server/data/posters/<id>.jpg (sips -Z 600).
Фильмы без постера выбрасываются.

Запуск: python3 server/scripts/build-movies.py [--main 520] [--ru 80]
Ответы API кэшируются во временной папке (см. CACHE), повторный прогон быстрый;
--fresh очищает кэш.
"""

import argparse
import gzip
import hashlib
import html
import http.client
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SERVER = Path(__file__).resolve().parent.parent
DATA = SERVER / "data"
POSTERS = DATA / "posters"
OUT = DATA / "movies.json"
CACHE = Path(tempfile.gettempdir()) / "vdvoyom-build-movies"

UA = "VdvoyomCatalog/0.1 (personal non-commercial movie list builder)"
SPARQL = "https://query.wikidata.org/sparql"
WIKI_API = "https://{lang}.wikipedia.org/w/api.php"

MIN_YEAR = 1970
MIN_SITELINKS_MAIN = 40     # порог для общего списка кандидатов
MIN_SITELINKS_RU = 5        # порог для советских и российских фильмов
RU_PREFILTER = 700          # сколько советских/российских кандидатов проверять по просмотрам
MIN_RU_VIEWS = 1000         # просмотров статьи ru-Википедии за 60 дней: отсекает фильмы,
                            # которые раздуты по sitelinks, но в Рунете почти неизвестны
MIN_MINUTES = 60

# Классы фильмов (P31).
FILM_TYPES = ["Q11424", "Q202866", "Q29168811", "Q20650540", "Q24869", "Q506240"]
ANIMATED_TYPES = {"Q202866", "Q29168811", "Q20650540"}
ANIME_TYPES = {"Q20650540"}
RU_COUNTRIES = ["Q15180", "Q159", "Q2184"]  # СССР, Россия, РСФСР
JAPAN = "Q17"

# Что выкидываем: документальное, порно, концерты, короткий метр.
BANNED = {
    "Q93204",     # documentary film
    "Q185529",    # pornographic film
    "Q1033891",   # concert film
    "Q24862",     # short film
    "Q17517379",  # animated short film
    "Q226730",    # silent film
    "Q20667187",  # compilation film
    "Q24856",     # film series
}

GENRES = ["комедия", "драма", "мелодрама", "боевик", "триллер", "ужасы", "фантастика",
          "фэнтези", "детектив", "приключения", "мультфильм", "семейный", "криминал",
          "военный", "исторический", "музыкальный", "аниме", "биография", "спорт"]

# Жанры фильма ранжируются по числу значений P136, которые в них попали
# (у «Криминального чтива» шесть «криминальных» меток из пятнадцати), а при равенстве —
# по этому порядку. Формат (аниме, мультфильм) всегда идёт первым.
GENRE_PRIORITY = ["аниме", "мультфильм", "комедия", "мелодрама", "ужасы", "фантастика",
                  "фэнтези", "боевик", "криминал", "драма", "триллер", "детектив", "военный",
                  "биография", "спорт", "музыкальный", "исторический", "приключения",
                  "семейный"]

# Правила маппинга P136 по английской метке жанра. Порядок не важен, берётся объединение.
EN_RULES = [
    (r"\banime\b", ["аниме"]),
    (r"(?<!live-action/)animat|stop-motion|stop motion|cartoon|claymation", ["мультфильм"]),
    (r"comed|parody|satir|slapstick|farce|mockumentary|spoof|screwball|stoner film", ["комедия"]),
    (r"romanc|romantic|melodrama|love story", ["мелодрама"]),
    (r"horror|slasher|zombie|splatter|ghost film|vampire film|found footage|werewolf", ["ужасы"]),
    (r"science fiction|sci-fi|science-fiction|cyberpunk|space opera|dystopi|post-apocalyptic"
     r"|superhero|time travel|alien invasion|kaiju|tokusatsu|apocalyptic|space western|steampunk"
     r"|mecha", ["фантастика"]),
    (r"fantasy|sword and sorcery|fairy tale|fairy-tale|fairytale|magic realism|magical realism", ["фэнтези"]),
    (r"\baction\b|martial arts|kung fu|wuxia|superhero|gun fu|swashbuckler|chase film|samurai", ["боевик"]),
    (r"thriller|suspense|disaster film|spy film|espionage|conspiracy", ["триллер"]),
    (r"crime|gangster|heist|neo-noir|film noir|\bnoir\b|mafia|yakuza|caper|hood film|prison film", ["криминал"]),
    (r"mystery|detective|whodunit|police procedural", ["детектив"]),
    (r"adventure|swashbuckler|western|treasure|survival film|road movie|jungle", ["приключения"]),
    (r"family film|children's film|children film|\bkids\b|christmas film|teen film for children", ["семейный"]),
    (r"\bwar film|war drama|anti-war|war movie|military film|world war|\bwar\b", ["военный"]),
    (r"histor|period|sword-and-sandal|sword and sandal|costume drama|jidaigeki|peplum", ["исторический"]),
    (r"musical|music film|dance film|\bmusic\b|concert", ["музыкальный"]),
    (r"biograph|biopic", ["биография"]),
    (r"sport|boxing|football|baseball|basketball|martial arts tournament|racing film|surf film", ["спорт"]),
    (r"drama|tragedy|tragicomedy", ["драма"]),
]
# Исключения: «family drama» — не семейный, «science fantasy» — и то, и другое и т.п.
EN_EXCLUDE = {
    "семейный": r"family drama|family saga",
    "исторический": r"alternate history",
    "мультфильм": r"live-action",
}

# Правила по русской метке — запасной путь, если у жанра нет английской.
RU_RULES = [
    (r"аниме", ["аниме"]),
    (r"мульт|анимац", ["мультфильм"]),
    (r"комеди|пароди|сатир|трагикомед|фарс", ["комедия"]),
    (r"мелодрам|романтич|любов", ["мелодрама"]),
    (r"ужас|хоррор|слэшер|зомби", ["ужасы"]),
    (r"научн\w* фантаст|фантастическ\w* фильм|киберпанк|антиутоп|постапокал|супергер", ["фантастика"]),
    (r"фэнтези|сказк", ["фэнтези"]),
    (r"боевик|бое?вые искусства", ["боевик"]),
    (r"триллер|фильм-катастроф", ["триллер"]),
    (r"криминал|гангстер|нуар|ограблен", ["криминал"]),
    (r"детектив", ["детектив"]),
    (r"приключ|вестерн|роуд-муви", ["приключения"]),
    (r"семейн\w* фильм|детск", ["семейный"]),
    (r"военн|о войне", ["военный"]),
    (r"историческ|костюмн|эпопея", ["исторический"]),
    (r"музыкальн|мюзикл", ["музыкальный"]),
    (r"биограф", ["биография"]),
    (r"спорт", ["спорт"]),
    (r"драм", ["драма"]),
]

# Те же правила для первой фразы ru-Википедии («американский фантастический боевик…»),
# если у фильма нет ни одного распознанного P136.
INTRO_RULES = [
    (r"аниме", ["аниме"]),
    (r"мультфильм|мультипликац|анимационн", ["мультфильм"]),
    (r"комеди|трагикомед|пародий", ["комедия"]),
    (r"мелодрам|романтическ", ["мелодрама"]),
    (r"фильм ужасов|хоррор|слэшер", ["ужасы"]),
    (r"фантастическ|научно-фантаст|антиутоп|супергеро", ["фантастика"]),
    (r"фэнтези|сказк", ["фэнтези"]),
    (r"боевик", ["боевик"]),
    (r"триллер|фильм-катастроф", ["триллер"]),
    (r"криминальн|гангстерск|нуар", ["криминал"]),
    (r"детектив", ["детектив"]),
    (r"приключенческ|вестерн|роуд-муви", ["приключения"]),
    (r"семейн\w* (?:фильм|комеди|мульт)|детск\w* фильм", ["семейный"]),
    (r"военн\w* (?:фильм|драм)|о войне", ["военный"]),
    (r"историческ", ["исторический"]),
    (r"музыкальн|мюзикл", ["музыкальный"]),
    (r"биографическ|байопик", ["биография"]),
    (r"спортивн", ["спорт"]),
    (r"драм", ["драма"]),
]

# ---------------------------------------------------------------- HTTP и кэш

# Лимиты Wikimedia с 2026 года (mediawiki.org/wiki/Wikimedia_APIs/Rate_limits):
# без контакта в User-Agent — 10 запросов в минуту на все API вместе (Википедии,
# Wikidata, REST), с контактом — 200. Поэтому все API идут через одну общую очередь.
# --contact «почта или URL» добавляет контакт в User-Agent и ускоряет сборку.
GAPS = {"api": 6.5, "sparql": 2.0, "upload": 1.5}
_last_call = {}


def bucket(host):
    if host == "query.wikidata.org":
        return "sparql"
    if host == "upload.wikimedia.org":
        return "upload"
    return "api"


def polite_pause(host):
    """Не чаще одного запроса в GAPS[очередь] секунд."""
    b = bucket(host)
    wait = _last_call.get(b, 0) + GAPS[b] - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_call[b] = time.monotonic()


def fetch(url, data=None, accept="application/json", binary=False, tries=8):
    host = urllib.parse.urlsplit(url).netloc
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    for attempt in range(tries):
        polite_pause(host)
        req = urllib.request.Request(url, data=body, headers={
            "User-Agent": UA, "Accept": accept, "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw if binary else raw.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                retry = e.headers.get("Retry-After")
                delay = int(retry) if retry and retry.isdigit() else 5 * (attempt + 1)
                delay = max(delay, 2)
                if delay > 3:
                    print(f"  {e.code} от {host}, жду {delay} с", file=sys.stderr)
                time.sleep(min(delay, 180))
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError,
                http.client.IncompleteRead) as e:
            if attempt < tries - 1:
                print(f"  сеть: {e}, повтор", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
                continue
            raise
    return None


def cached(key, fn):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".json")
    if path.exists():
        return json.loads(path.read_text())
    value = fn()
    path.write_text(json.dumps(value, ensure_ascii=False))
    return value


def sparql(query):
    def run():
        text = fetch(SPARQL, data={"query": query}, accept="application/sparql-results+json")
        return json.loads(text)["results"]["bindings"]
    return cached("sparql:" + query, run)


def wiki_api(lang, params):
    params = dict(params, format="json", formatversion="2")
    key = f"wiki:{lang}:" + json.dumps(params, sort_keys=True, ensure_ascii=False)

    def run():
        text = fetch(WIKI_API.format(lang=lang), data=params)
        return json.loads(text)
    return cached(key, run)


def qid(uri):
    return uri.rsplit("/", 1)[-1]


def val(b, name):
    return b[name]["value"] if name in b else None


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---------------------------------------------------------------- Wikidata
#
# SPARQL даёт только пулы кандидатов (идентификатор, sitelinks). Запросы с длинным
# VALUES на WDQS идут минутами, поэтому поля фильмов берутся из API Wikidata
# (wbgetentities, по 50 штук) и только для тех, до кого дошла очередь.

WD_API = "https://www.wikidata.org/w/api.php"


def pool_main():
    types = " ".join("wd:" + t for t in FILM_TYPES)
    rows = sparql(f"""
SELECT ?film ?sl WHERE {{
  VALUES ?type {{ {types} }}
  ?film wdt:P31 ?type ; wikibase:sitelinks ?sl .
  FILTER(?sl >= {MIN_SITELINKS_MAIN})
}}""")
    return {qid(val(b, "film")): int(val(b, "sl")) for b in rows}


def pool_ru():
    """Советские и российские фильмы с русской меткой и статьёй в ru-Википедии."""
    types = " ".join("wd:" + t for t in FILM_TYPES)
    countries = " ".join("wd:" + c for c in RU_COUNTRIES)
    rows = sparql(f"""
SELECT ?film (MAX(?sl) AS ?links) (MIN(YEAR(?d)) AS ?y) (SAMPLE(?art) AS ?article) WHERE {{
  VALUES ?c {{ {countries} }}
  VALUES ?type {{ {types} }}
  ?film wdt:P495 ?c ; wdt:P31 ?type ; wikibase:sitelinks ?sl .
  FILTER(?sl >= {MIN_SITELINKS_RU})
  ?film wdt:P577 ?d .
  ?film rdfs:label ?ru . FILTER(LANG(?ru) = "ru")
  ?art schema:about ?film ; schema:isPartOf <https://ru.wikipedia.org/> .
}} GROUP BY ?film""")
    out = {}
    for b in rows:
        if val(b, "y") and int(val(b, "y")) >= MIN_YEAR:
            title = urllib.parse.unquote(val(b, "article").rsplit("/wiki/", 1)[1]).replace("_", " ")
            out[qid(val(b, "film"))] = (int(val(b, "links")), title)
    return out


def claim_values(entity, prop):
    """Значения утверждения без устаревших; предпочтительные идут первыми."""
    out = []
    for st in entity.get("claims", {}).get(prop, []):
        if st.get("rank") == "deprecated":
            continue
        snak = st.get("mainsnak", {})
        if snak.get("snaktype") != "value":
            continue
        out.append((st.get("rank") == "preferred", snak["datavalue"]["value"]))
    out.sort(key=lambda x: not x[0])
    return out


def compact(entity):
    """Из тяжёлой сущности Wikidata оставляет только нужные поля."""
    labels = entity.get("labels", {})
    links = entity.get("sitelinks", {})
    years = []
    # У фильма год — дата выхода (P577), у сериала её часто нет, есть начало показа (P580)
    for prop in ("P577", "P580"):
        for _, v in claim_values(entity, prop):
            m = re.match(r"^[+]?(\d{4})-", v.get("time", ""))
            if m and v.get("precision", 11) >= 9:
                years.append(int(m.group(1)))
        if years:
            break
    durations = []
    for pref, v in claim_values(entity, "P2047"):
        unit = v.get("unit", "").rsplit("/", 1)[-1]
        mult = {"Q7727": 1, "Q11574": 1 / 60, "Q25235": 60}.get(unit)
        if mult:
            durations.append((pref, round(float(v["amount"]) * mult)))
    kp = [v for _, v in claim_values(entity, "P2603") if str(v).isdigit()]
    imdb = [v for _, v in claim_values(entity, "P345") if str(v).startswith("tt")]
    return {
        "id": entity["id"],
        "ru": labels.get("ru", {}).get("value"),
        "en": labels.get("en", {}).get("value"),
        "ru_article": links.get("ruwiki", {}).get("title"),
        "en_article": links.get("enwiki", {}).get("title"),
        "year": min(years) if years else None,
        "types": [v["id"] for _, v in claim_values(entity, "P31")],
        "genres_q": [v["id"] for _, v in claim_values(entity, "P136")],
        "countries": [v["id"] for _, v in claim_values(entity, "P495")],
        "durations": durations,
        "titles": [(v["text"], v["language"]) for _, v in claim_values(entity, "P1476")],
        "kp": int(kp[0]) if kp else None,
        "imdb": imdb[0] if imdb else None,
    }


def entities(ids, props="labels|claims|sitelinks"):
    """wbgetentities по 50 штук, с кэшем на каждую сущность."""
    CACHE.mkdir(parents=True, exist_ok=True)
    out, missing = {}, []
    for i in ids:
        path = CACHE / f"wd-{props.replace('|', '-')}-{i}.json"
        if path.exists():
            out[i] = json.loads(path.read_text())
        else:
            missing.append(i)
    for batch in chunks(missing, 50):
        text = fetch(WD_API, data={"action": "wbgetentities", "ids": "|".join(batch),
                                   "props": props, "languages": "ru|en",
                                   "sitefilter": "ruwiki|enwiki", "format": "json"})
        for i, entity in json.loads(text).get("entities", {}).items():
            if "missing" in entity:
                continue
            if props == "labels":
                labels = entity.get("labels", {})
                item = (labels.get("ru", {}).get("value", ""), labels.get("en", {}).get("value", ""))
            else:
                item = compact(entity)
            (CACHE / f"wd-{props.replace('|', '-')}-{i}.json").write_text(
                json.dumps(item, ensure_ascii=False))
            out[i] = item
    return out


def film_details(ids, genre_labels):
    films = {}
    for i, f in entities(ids).items():
        f = dict(f)
        f["types"], f["countries"] = set(f["types"]), set(f["countries"])
        f["durations"] = [tuple(d) for d in f["durations"]]
        f["titles"] = [tuple(t) for t in f["titles"]]
        films[i] = f
    unknown = {g for f in films.values() for g in f["genres_q"]} - set(genre_labels)
    for g, lab in entities(sorted(unknown), props="labels").items():
        genre_labels[g] = tuple(lab)
    return films


# ---------------------------------------------------------------- Разбор полей

def is_latin(text):
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(c.isascii() or "À" <= c <= "ɏ" for c in letters) / len(letters) > 0.9


def original_title(f):
    if f["countries"] & set(RU_COUNTRIES):
        return None
    title = None
    for text, lang in f["titles"]:
        if is_latin(text) and not lang.endswith("-latn") and lang != "ru":
            title = text
            break
    if title is None and f["en"] and is_latin(f["en"]):
        title = f["en"]
    if title and f["ru"] and title.casefold() == f["ru"].casefold():
        return None
    return title


def minutes(f):
    preferred = [m for pref, m in f["durations"] if pref and m >= 40]
    rest = [m for _, m in f["durations"] if m >= 40]
    if preferred:
        return min(preferred)
    return min(rest) if rest else None


def apply_rules(text, rules, exclude=None):
    found = set()
    text = text.casefold()
    for pattern, genres in rules:
        if re.search(pattern, text):
            for g in genres:
                if exclude and g in exclude and re.search(exclude[g], text):
                    continue
                found.add(g)
    return found


def map_genres(f, genre_labels, intro):
    score = {}
    for g in f["genres_q"]:
        if g in BANNED:
            continue
        ru, en = genre_labels.get(g, ("", ""))
        for genre in (apply_rules(en, EN_RULES, EN_EXCLUDE) if en else apply_rules(ru, RU_RULES)):
            score[genre] = score.get(genre, 0) + 1
    fmt = set()
    if f["types"] & ANIMATED_TYPES or "мультфильм" in score:
        fmt.add("мультфильм")
    if f["types"] & ANIME_TYPES or "аниме" in score or ("мультфильм" in fmt and JAPAN in f["countries"]):
        fmt = {"аниме"}  # аниме уже говорит, что это анимация
    for g in ("мультфильм", "аниме"):
        score.pop(g, None)
    if not score and intro:
        # Первая фраза ru-Википедии: «…— американский фантастический боевик…».
        for genre in apply_rules(intro.split(". ")[0], INTRO_RULES):
            if genre not in ("мультфильм", "аниме"):
                score[genre] = 1
            elif not fmt:
                fmt.add(genre)
    rest = sorted(score, key=lambda g: (-score[g], GENRE_PRIORITY.index(g)))
    return (sorted(fmt) + rest)[:3]


# ---------------------------------------------------------------- Описание

LANG_ABBR = (r"англ|яп|фр|франц|нем|исп|итал|кит|кор|лат|швед|дат|норв|польск|порт|"
             r"ивр|араб|тур|фин|чеш|венг|греч|перс|хинди|тайск|инд|укр|белор|каз|груз|"
             r"арм|эст|латыш|литов|рум|болг|серб|хорв|нидерл|голл|исл|ирл|вьет|монг|"
             r"букв|МФА|рус|полн|кантон|мандарин|пиньинь|палл|ромадз|трансл|оригинальное")
ABBR_BEFORE_DOT = re.compile(
    r"(?:\b(?:" + LANG_ABBR + r"|т|е|к|н|д|п|г|гг|др|им|св|см|ср|напр|ок|р|реж|совм|"
    r"прибл|млн|млрд|тыс|долл|руб|пр|ред|изд|вып|ст|Дж|Ст|Мл|Ср|мл|ст|ул|пос|обл|"
    r"вв|в|н|э|нач|кон|сер|мин|ч|чел|ориг|рис|илл|перев)|\b[A-ZА-ЯЁ])$")


def split_sentences(text):
    out, start = [], 0
    for m in re.finditer(r"[.!?…]+[»”\")]*\s+(?=[«\"A-ZА-ЯЁ0-9])", text):
        head = text[start:m.start()]
        word = re.search(r"(\S+)$", head)
        if word and ABBR_BEFORE_DOT.search(word.group(1)) and text[m.start()] == ".":
            continue
        out.append(text[start:m.end()].strip())
        start = m.end()
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return out


def drop_parens(text):
    """Убирает скобки с иноязычными названиями, транскрипциями и т.п."""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(
            r"\s*\((?:[^()]*?(?:\b(?:" + LANG_ABBR + r")\.|[^\s\u0400-\u04FF\d,.;:—–\-«»\"'()!?]{2,})[^()]*"
            r"|[^()\u0400-\u04FF]*)\)", "", text)
    return text


def first_sentences(text, limit=300):
    """Одно-два первых предложения (короткая «шапка» вроде «1947 год.» не считается)."""
    text = text.replace("\N{COMBINING ACUTE ACCENT}", "").replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    prev = None
    while prev != text:  # на карточке скобки не нужны: актёры, пояснения, переводы
        prev = text
        text = re.sub(r"\s*\([^()]*\)", "", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s{2,}", " ", text)
    sentences = split_sentences(text)
    if not sentences:
        return None
    result, used = "", 0
    for sent in sentences:
        if result and (used >= 2 or len(result) + len(sent) + 1 > limit):
            break
        result = (result + " " + sent).strip()
        if len(sent) >= 25:
            used += 1
    if len(result) > limit + 60:
        result = result[:limit].rsplit(" ", 1)[0].rstrip(",;:—– ") + "…"
    return result


def looks_clean(text):
    return bool(text) and len(text) >= 40 and not re.search(r"\{\{|\}\}|\[\[|\]\]|\||<|>|==|''", text)


def describe_from_intro(intro):
    """Запасное описание из вводной части: без «„Название“ (англ. …) —» в начале."""
    if not intro:
        return None
    first = intro.split("\n")[0]
    if re.search(r"(?:—|-) (?:название|несколько)", first[:200]):
        return None  # страница значений
    text = drop_parens(first.replace("\N{COMBINING ACUTE ACCENT}", ""))
    m = re.match(r"^[^—–]{0,200}?\s[—–]\s(.+)$", text, re.S)
    if m and len(m.group(1)) > 25:
        text = m.group(1)[0].upper() + m.group(1)[1:]
    rest = "\n".join(intro.split("\n")[1:])
    return first_sentences(text + " " + rest.replace("\n", " "))


def describe(wikitext, intro):
    plot = plot_opening(wikitext) if wikitext else None
    if plot:
        text = first_sentences(plot)
        if looks_clean(text):
            return text
    text = describe_from_intro(intro)
    return text if looks_clean(text) else None


# ---------------------------------------------------------------- Вики-разметка сюжета

PLOT_HEAD = re.compile(r"^==\s*(?:Сюжет|Синопсис|Фабула|Содержание)[^=\n]*==\s*$", re.M | re.I)
FILE_LINK = re.compile(r"\[\[(?:Файл|File|Изображение|Image|Категория|Category):", re.I)


def drop_nested(text, opener, open_tok, close_tok):
    """Вырезает конструкции вида [[Файл:…[[…]]…]] с учётом вложенности."""
    while True:
        m = opener.search(text)
        if not m:
            return text
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith(open_tok, i):
                depth += 1
                i += len(open_tok)
            elif text.startswith(close_tok, i):
                depth -= 1
                i += len(close_tok)
                if depth == 0:
                    break
            else:
                i += 1
        text = text[:m.start()] + text[i:]


def template_text(body):
    parts = [p.strip() for p in body.split("|")]
    name = parts[0].strip().lower().replace("_", " ")
    pos = [p for p in parts[1:] if not re.match(r"^[\w\s-]+=", p)]
    if name in ("—", "--", "---", "-"):
        return " — "
    if name.startswith(("lang-", "langi", "lang")):
        return pos[-1] if pos else ""
    if name.startswith(("нп", "не переведено", "iw", "comment", "abbr", "s", "nobr",
                        "nowrap", "num", "не переведено", "iw2", "l6e", "sic")):
        if name.startswith(("нп", "не переведено", "iw")) and len(pos) > 1 and pos[1]:
            return pos[1]
        return pos[0] if pos else ""
    return ""


def wikitext_to_plain(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    text = re.sub(r"<(gallery|math|timeline|score)[^>]*>.*?</\1>", "", text, flags=re.S)
    text = re.sub(r"<[^>]+>", "", text)
    text = drop_nested(text, FILE_LINK, "[[", "]]")
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"\{\{([^{}]*)\}\}", lambda m: template_text(m.group(1)), text)
    text = re.sub(r"\{\|.*?\|\}", "", text, flags=re.S)  # таблицы
    text = re.sub(r"\[\[[^\[\]|]*\|([^\[\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\[\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", text)
    text = re.sub(r"\[https?://\S+\]", "", text)
    text = re.sub(r"'{2,}", "", text)
    return html.unescape(text)


def plot_opening(wikitext):
    """Первый абзац раздела «Сюжет» простым текстом."""
    m = PLOT_HEAD.search(wikitext)
    if not m:
        return None
    body = wikitext[m.end():]
    nxt = re.search(r"^==[^=].*$", body, re.M)
    if nxt:
        body = body[:nxt.start()]
    body = re.sub(r"^=+.*=+\s*$", "", body, flags=re.M)
    plain = wikitext_to_plain(body)
    for para in re.split(r"\n\s*\n", plain):
        para = para.strip()
        if not para or para[0] in "*:;#|!{":
            continue
        para = re.sub(r"\s*\n\s*", " ", para)
        if len(para) < 60:
            continue
        head = para[:200]
        if re.search(r"част\w* сюжета|сюжет\w* (?:фильма )?(?:построен|разделён|состоит)|новелл|"
                     r"нелинейн|хронологическ\w* порядк|состоит из \w+ (?:частей|историй|эпизодов|глав)|"
                     r"разделён на \w+ (?:частей|главы|глав|эпизод)", head, re.I):
            continue  # абзац о строении фильма, а не о том, что в нём происходит
        return para
    return None


def ru_wikitexts(titles):
    """Вики-текст статей ru-Википедии пачками по 20 (одним запросом на пачку)."""
    out = {}
    for batch in chunks(sorted(set(titles)), 20):
        data = wiki_api("ru", {"action": "query", "prop": "revisions", "rvprop": "content",
                               "rvslots": "main", "redirects": 1, "titles": "|".join(batch)})
        q = data.get("query", {})
        alias = {n["to"]: n["from"] for n in q.get("normalized", []) + q.get("redirects", [])}
        for page in q.get("pages", []):
            revs = page.get("revisions") or []
            if not revs:
                continue
            t = page.get("title")
            while t in alias and t not in batch:
                t = alias[t]
            out[t] = revs[0].get("slots", {}).get("main", {}).get("content", "")
    return out


def ru_intros(titles):
    """Вводная часть статей ru-Википедии: {заголовок: текст}."""
    out = {}
    for batch in chunks(sorted(set(titles)), 20):
        data = wiki_api("ru", {"action": "query", "prop": "extracts", "exintro": 1,
                               "explaintext": 1, "exlimit": 20, "redirects": 1,
                               "titles": "|".join(batch)})
        q = data.get("query", {})
        alias = {n["to"]: n["from"] for n in q.get("normalized", []) + q.get("redirects", [])}
        for page in q.get("pages", []):
            t = page.get("title")
            text = page.get("extract")
            while t in alias and t not in batch:
                t = alias[t]
            if text:
                out[t] = text
    return out


# ---------------------------------------------------------------- Популярность в Рунете

def ru_pageviews(titles):
    """Просмотры статей ru-Википедии за последние 60 дней, пачками по 50.

    PageViewInfo отдаёт данные не по всем страницам сразу, остальное — через pvipcontinue.
    """
    out = {}
    for batch in chunks(sorted(set(titles)), 50):
        params = {"action": "query", "prop": "pageviews", "pvipdays": 60,
                  "redirects": 1, "titles": "|".join(batch)}
        for _ in range(20):
            data = wiki_api("ru", params)
            q = data.get("query", {})
            alias = {n["to"]: n["from"] for n in q.get("normalized", []) + q.get("redirects", [])}
            for page in q.get("pages", []):
                if "pageviews" not in page:
                    continue
                t = page.get("title")
                while t in alias and t not in batch:
                    t = alias[t]
                out[t] = sum(v or 0 for v in page["pageviews"].values())
            cont = data.get("continue")
            if not cont:
                break
            params = dict(params, **cont)
    return out


# ---------------------------------------------------------------- Постеры

def page_images(lang, titles):
    """{заголовок статьи: (url, ширина, высота, имя файла)}."""
    out = {}
    for batch in chunks(sorted(set(titles)), 50):
        data = wiki_api(lang, {"action": "query", "prop": "pageimages",
                               "piprop": "thumbnail|name|original", "pithumbsize": 600,
                               "pilicense": "any", "pilimit": 50, "redirects": 1,
                               "titles": "|".join(batch)})
        q = data.get("query", {})
        alias = {n["to"]: n["from"] for n in q.get("normalized", []) + q.get("redirects", [])}
        for page in q.get("pages", []):
            thumb = page.get("thumbnail") or page.get("original")
            if not thumb:
                continue
            t = page.get("title")
            while t in alias and t not in batch:
                t = alias[t]
            out[t] = (thumb["source"], thumb["width"], thumb["height"], page.get("pageimage", ""))
    return out


def poster_ok(img):
    if not img:
        return False
    url, w, h, name = img
    if not w or not h or w < 120:
        return False
    if name.lower().endswith((".svg", ".gif", ".tif", ".tiff", ".webm", ".ogv")):
        return False
    return 1.2 <= h / w <= 1.9   # вертикальный постер, а не кадр или логотип


def download_poster(film_id, url):
    dest = POSTERS / f"{film_id}.jpg"
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        raw = fetch(url, accept="image/*", binary=True)
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError) as e:
        print(f"  постер {film_id}: {e}", file=sys.stderr)
        return False
    if not raw or len(raw) < 2000:
        return False
    tmp = CACHE / f"poster-{film_id}"
    tmp.write_bytes(raw)
    try:
        w, h = image_size(tmp)
        cmd = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82"]
        if max(w, h) > 600:
            cmd += ["-Z", "600"]
        subprocess.run(cmd + [str(tmp), "--out", str(dest)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, ValueError, AttributeError):
        dest.unlink(missing_ok=True)
        return False
    finally:
        tmp.unlink(missing_ok=True)
    return dest.exists()


def image_size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
                         capture_output=True, text=True, check=True).stdout
    w = int(re.search(r"pixelWidth: (\d+)", out).group(1))
    h = int(re.search(r"pixelHeight: (\d+)", out).group(1))
    return w, h


# ---------------------------------------------------------------- Сборка

def eligible(f):
    """Фильм проходит базовые фильтры (без постера и описания)."""
    if not f["ru"] or not f["ru_article"] or not f["year"] or f["year"] < MIN_YEAR:
        return False
    if (f["types"] | set(f["genres_q"])) & BANNED:
        return False
    m = minutes(f)
    if m is not None and m < MIN_MINUTES:
        return False
    return True


def clean_title(t):
    return re.sub(r"\s*\((?:фильм|мультфильм|кинофильм)[^)]*\)\s*$", "", t).strip()


def build_record(f, genre_labels, wikitext, intro):
    genres = map_genres(f, genre_labels, intro)
    description = describe(wikitext, intro)
    if not genres or not description:
        return None
    return {
        "id": f["id"],
        "title": clean_title(f["ru"]),
        "original": original_title(f),
        "year": f["year"],
        "genres": genres,
        "minutes": minutes(f),
        "description": description,
        "kp": f["kp"],
        "imdb": f["imdb"],
        "poster": f"{f['id']}.jpg",
    }


def pick(order, want, taken, genre_labels, stats, label, download=True, min_views=0):
    """Идёт по очереди кандидатов, пока не наберёт want фильмов с постером."""
    chosen, pos = [], 0
    while len(chosen) < want and pos < len(order):
        ids = [i for i in order[pos:pos + 100] if i not in taken]
        pos += 100
        films = film_details(ids, genre_labels)
        batch = [films[i] for i in ids if i in films and eligible(films[i])]
        if min_views:
            views = ru_pageviews(f["ru_article"] for f in batch)
            for f in batch:
                if views.get(f["ru_article"], 0) < min_views:
                    stats["мало просмотров в ru-Википедии"].append(
                        f"{f['ru']} ({f['year']}, {f['id']}): {views.get(f['ru_article'], 0)}")
            batch = [f for f in batch if views.get(f["ru_article"], 0) >= min_views]
        texts = ru_wikitexts(f["ru_article"] for f in batch)
        # Вводная часть нужна, только если нет сюжета или жанров из P136.
        need_intro = [f["ru_article"] for f in batch
                      if not plot_opening(texts.get(f["ru_article"], ""))
                      or not map_genres(f, genre_labels, None)
                      or set(map_genres(f, genre_labels, None)) <= {"мультфильм", "аниме"}]
        intros = ru_intros(need_intro) if need_intro else {}
        en_imgs = page_images("en", [f["en_article"] for f in batch if f["en_article"]])
        ru_imgs = page_images("ru", [f["ru_article"] for f in batch])
        for f in batch:
            if len(chosen) >= want:
                break
            name = f"{f['ru']} ({f['year']}, {f['id']})"
            rec = build_record(f, genre_labels, texts.get(f["ru_article"]),
                               intros.get(f["ru_article"]))
            if rec is None:
                stats["нет жанра или описания"].append(name)
                continue
            imgs = [en_imgs.get(f["en_article"]), ru_imgs.get(f["ru_article"])]
            if f["countries"] & set(RU_COUNTRIES):
                imgs.reverse()  # у советских и российских фильмов афиша лучше в ru-Википедии
            imgs = [img for img in imgs if poster_ok(img)]
            if not imgs:
                stats["нет постера"].append(name)
                continue
            if download and not any(download_poster(f["id"], img[0]) for img in imgs):
                stats["постер не скачался"].append(name)
                continue
            rec["_poster_url"] = imgs[0][0]
            chosen.append(rec)
            taken.add(f["id"])
        print(f"  {label}: {len(chosen)}/{want} (просмотрено {min(pos, len(order))})",
              file=sys.stderr)
    return chosen


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--main", type=int, default=520, help="сколько фильмов из общего списка")
    ap.add_argument("--ru", type=int, default=80, help="сколько советских и российских хитов сверху")
    ap.add_argument("--fresh", action="store_true", help="очистить кэш ответов API")
    ap.add_argument("--dry", action="store_true", help="не качать постеры, только отчёт")
    ap.add_argument("--contact", help="почта или URL для User-Agent: лимит Wikimedia 200 "
                                      "запросов в минуту вместо 10, сборка в разы быстрее")
    args = ap.parse_args()

    global UA
    if args.contact:
        UA = f"VdvoyomCatalog/0.1 ({args.contact})"
        GAPS["api"] = 0.5

    if args.fresh and CACHE.exists():
        shutil.rmtree(CACHE)
    CACHE.mkdir(parents=True, exist_ok=True)
    POSTERS.mkdir(parents=True, exist_ok=True)

    print("Wikidata: пулы кандидатов…", file=sys.stderr)
    main_pool = pool_main()
    ru_pool = pool_ru()
    genre_labels = {}
    stats = {"мало просмотров в ru-Википедии": [], "нет жанра или описания": [],
             "нет постера": [], "постер не скачался": []}
    taken = set()

    main_order = sorted(main_pool, key=lambda i: (-main_pool[i], i))
    catalog = pick(main_order, args.main, taken, genre_labels, stats, "общий список",
                   download=not args.dry, min_views=MIN_RU_VIEWS)

    ru_top = sorted((i for i in ru_pool if i not in taken),
                    key=lambda i: (-ru_pool[i][0], i))[:RU_PREFILTER]
    print(f"Просмотры ru-Википедии за 60 дней для {len(ru_top)} советских и российских фильмов…",
          file=sys.stderr)
    views = ru_pageviews(ru_pool[i][1] for i in ru_top)
    ru_order = sorted(ru_top, key=lambda i: (-views.get(ru_pool[i][1], 0), i))
    catalog += pick(ru_order, args.ru, taken, genre_labels, stats, "советские и российские",
                    download=not args.dry)

    report = CACHE / "last-run.json"
    report.write_text(json.dumps({"catalog": catalog, "stats": stats,
                                  "genre_labels": genre_labels}, ensure_ascii=False, indent=1))
    for rec in catalog:
        rec.pop("_poster_url", None)

    if not args.dry:
        # Постеры, не попавшие в каталог (например, после смены порогов), удаляем.
        keep = {rec["poster"] for rec in catalog}
        for p in POSTERS.glob("*.jpg"):
            if p.name not in keep:
                p.unlink()
        OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n")

    counts = {g: 0 for g in GENRES}
    for rec in catalog:
        for g in rec["genres"]:
            counts[g] += 1
    print(f"\nГотово: {len(catalog)} фильмов → {OUT if not args.dry else report}", file=sys.stderr)
    for g, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {g:13} {n}", file=sys.stderr)
    for reason, items in stats.items():
        print(f"Выброшено ({reason}): {len(items)}", file=sys.stderr)
        for item in items[:60]:
            print(f"    {item}", file=sys.stderr)


if __name__ == "__main__":
    main()
