import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { Check, ExternalLink, Heart, Info, Plus, RotateCcw, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, queryClient, useAct, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { accusative, genitive, plural } from "../fmt.ts";
import { haptic, openLink } from "../tg.ts";
import { nav, store, useStore } from "../store.ts";
import { Empty, Field, Head, Pills, Section, Sheet, Spinner } from "../ui/kit.tsx";
import { imdbUrl, kinopoiskUrl, posterSrc, ratingText, scoreNote } from "./MatchOverlay.tsx";

type Deck = "movie" | "idea" | "place";
type Item = Record<string, unknown> & { id: string };

const DECK_TITLE: Record<Deck, string> = { movie: "Фильм на вечер", idea: "Куда сходить", place: "Куда слетать" };
const DURATION_LABEL: Record<string, string> = { "2h": "пара часов", half: "полдня", day: "целый день", night: "с ночёвкой" };
const BUDGET = ["", "₽", "₽₽", "₽₽₽"];

/** Шкала вместо «да/нет». Свайп влево — 1, вправо — 4, вверх — 5; все пять есть кнопками. */
export const SCORES: { v: number; e: string; l: string }[] = [
  { v: 1, e: "👎", l: "не хочу" },
  { v: 2, e: "😕", l: "не очень" },
  { v: 3, e: "🙂", l: "норм" },
  { v: 4, e: "😍", l: "хочу" },
  { v: 5, e: "🔥", l: "очень хочу" },
];
export const scoreEmoji = (v: number | null | undefined) => SCORES.find((x) => x.v === v)?.e ?? "·";

/** Подложка карточки без фото: одна из мягких пар в тон розе, выбранная по id, — не случайный оттенок круга. */
const SOFT_GRADIENTS: [string, string][] = [
  ["#e0527f", "#8e1f55"],
  ["#ef8a6d", "#a83a5c"],
  ["#9b7cf0", "#5a3cc0"],
  ["#c86fd0", "#732a8c"],
  ["#e39a5c", "#a4424f"],
  ["#7088e6", "#4a3aa8"],
  ["#d25f8e", "#5e2a6e"],
];

function gradientFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = SOFT_GRADIENTS[h % SOFT_GRADIENTS.length];
  return `linear-gradient(160deg, ${a}, ${b})`;
}

// ——— хаб ———

export function SwipesScreen() {
  const { partner, shown, beta } = useMe();
  const presence = useStore((s) => s.presence);
  const { data: preview } = useApi<{ items: Item[] }>(["deck", "movie", "preview"], "/deck/movie?limit=3");
  const { data: places } = useApi<{ items: Item[] }>(["deck", "place", "preview"], "/deck/place?limit=1");
  const { data: ideas } = useApi<{ items: Item[] }>(["deck", "idea", "preview"], "/deck/idea?limit=1");
  const idea = ideas?.items[0];
  const ideaPhoto = idea?.photoUrl ? String(idea.photoUrl) : idea?.image ? `/ideas/${idea.image}` : null;
  const m = {
    movie: useApi<{ matches: unknown[] }>(["matches", "movie"], "/matches/movie").data?.matches.length ?? 0,
    idea: useApi<{ matches: unknown[] }>(["matches", "idea"], "/matches/idea").data?.matches.length ?? 0,
    place: useApi<{ matches: unknown[] }>(["matches", "place"], "/matches/place").data?.matches.length ?? 0,
  };
  const partnerRoom = partner ? presence[String(partner.id)] : undefined;

  return (
    <div className="screen">
      <Head caption="выбираем вместе" title="Свайпы" />

      <motion.button
        whileTap={{ scale: 0.98 }}
        className="card"
        style={{ width: "100%", textAlign: "left", padding: 0, overflow: "hidden", height: 250, position: "relative", display: "block" }}
        onClick={() => nav.push("deck", { deck: "movie" })}
      >
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {(preview?.items ?? []).map((it, i) =>
            posterSrc(it) ? (
              <img key={it.id} src={posterSrc(it)!} alt="" style={{ flex: 1, minWidth: 0, objectFit: "cover", transform: `scale(1.08) rotate(${(i - 1) * 2}deg)` }} />
            ) : (
              <div key={it.id} style={{ flex: 1, minWidth: 0, background: gradientFor(it.id) }} />
            ),
          )}
        </div>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.1), rgba(0,0,0,.85))" }} />
        <div style={{ position: "absolute", left: 18, right: 18, bottom: 18, color: "#fff" }}>
          {partnerRoom === "movie" && (
            <div className="chip" style={{ color: "#7dffb0", borderColor: "rgba(125,255,176,.4)", marginBottom: 8 }}>● {partner?.name} уже свайпает</div>
          )}
          <div className="title-lg" style={{ fontSize: 28 }}>Фильм на вечер</div>
          <div style={{ opacity: 0.8, marginTop: 4 }}>
            Свайп вправо — хочу. Совпали — фильм выбран.
            {m.movie ? ` Мэтчей: ${m.movie}` : ""}
          </div>
        </div>
      </motion.button>

      <div className="grid-2" style={{ marginTop: 10 }}>
        <motion.button
          whileTap={{ scale: 0.97 }}
          className="tile"
          style={{ position: "relative", overflow: "hidden", background: "var(--grad)", color: "#fff", minHeight: 170 }}
          onClick={() => nav.push("deck", { deck: "idea" })}
        >
          {ideaPhoto && <img src={ideaPhoto} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.75))" }} />
          <div style={{ position: "relative", fontSize: 34 }}>📍</div>
          <div style={{ position: "relative" }}>
            <div className="title-md">Куда сходить</div>
            <div className="small" style={{ opacity: 0.85 }}>{m.idea ? `${m.idea} ${plural(m.idea, "мэтч", "мэтча", "мэтчей")}` : "места и идеи в Москве"}</div>
          </div>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          className="tile"
          style={{ position: "relative", overflow: "hidden", color: "#fff", minHeight: 170, background: "#234" }}
          onClick={() => nav.push("deck", { deck: "place" })}
        >
          {places?.items[0] && <img src={`/places/${places.items[0].image}`} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.75))" }} />
          <div style={{ position: "relative", fontSize: 34 }}>✈️</div>
          <div style={{ position: "relative" }}>
            <div className="title-md">Куда слетать</div>
            <div className="small" style={{ opacity: 0.85 }}>{m.place ? `${m.place} ${plural(m.place, "мэтч", "мэтча", "мэтчей")}` : "поездки мечты"}</div>
          </div>
        </motion.button>
      </div>

      {shown("tests") && (
      <motion.button whileTap={{ scale: 0.98 }} className="card row" style={{ width: "100%", textAlign: "left", marginTop: 10 }} onClick={() => nav.push("tests")}>
        <div style={{ fontSize: 34 }}>🧪</div>
        <div className="grow">
          <div className="title-md">Тесты на совместимость</div>
          <div className="small muted">{beta ? "Угадай меня, идеальное свидание, что мне приятно и другие" : "Языки любви, «Это или то», насколько ты знаешь половинку"}</div>
        </div>
      </motion.button>
      )}

      <Section title="Мэтчи" />
      <div className="grid-3">
        {(["movie", "idea", "place"] as Deck[]).map((d) => (
          <button key={d} className="tile" style={{ minHeight: 92 }} onClick={() => nav.push("matches", { deck: d })}>
            <div className="num" style={{ fontSize: 28 }}>{m[d]}</div>
            <div className="small muted">{d === "movie" ? "фильмы" : d === "idea" ? "места" : "поездки"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ——— колода ———

export function DeckScreen({ deck }: { deck: Deck }) {
  const { me, partner } = useMe();
  const presence = useStore((s) => s.presence);
  const [queue, setQueue] = useState<Item[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [history, setHistory] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<Item | null>(null);
  const [addIdea, setAddIdea] = useState(false);
  const [addFilm, setAddFilm] = useState(false);
  const [genresOpen, setGenresOpen] = useState(false);
  const topSwipe = useRef<((score: number) => void) | null>(null);
  const loadingMore = useRef(false);
  const swiped = useRef(new Set<string>());
  // Поколение колоды: сброс (смена жанров) начинает новое, ответы старых подгрузок
  // выбрасываются. Раньше сброс молча пропускался, если шла подгрузка «ещё карточек» —
  // а она идёт почти всё время, пока свайпаешь, и жанры «не работали» (03.10.2026).
  const generation = useRef(0);

  const load = async (reset = false) => {
    if (!reset && loadingMore.current) return;
    const mine = reset ? ++generation.current : generation.current;
    loadingMore.current = true;
    try {
      const r = await api<{ items: Item[]; left: number }>(`/deck/${deck}?limit=20`);
      if (mine !== generation.current) return;
      // Сервер считает ещё не оценённые. Подгрузка может обогнать запрос с оценкой,
      // и тогда число вышло бы больше показанного — берём меньшее
      setLeft((l) => (reset || l === null ? r.left : Math.min(l, r.left)));
      setQueue((q) => {
        const base = reset ? [] : q;
        const seen = new Set([...base.map((i) => i.id), ...swiped.current]);
        return [...base, ...r.items.filter((i) => !seen.has(i.id))];
      });
      return r;
    } finally {
      if (mine === generation.current) {
        loadingMore.current = false;
        setLoading(false);
      }
    }
  };
  // Выбранные жанры видны на самой кнопке: «🎬 комедия» или «🎬 Жанры · 3»
  const { data: genres } = useApi<{ mine: string[]; partner: string[] }>(["genres"], deck === "movie" ? "/movies/genres" : null);
  const myGenres = genres?.mine ?? [];

  useEffect(() => {
    void load(true);
    void api("/presence", { body: { room: deck } });
    return () => void api("/presence", { body: { room: null } });
  }, [deck]);

  useEffect(() => {
    if (!loading && queue.length < 6 && (left ?? 0) > queue.length) void load();
    // Постеры следующих карточек грузим заранее, чтобы свайп не упирался в сеть
    for (const it of queue.slice(1, 4)) {
      const src = deck === "movie" ? posterSrc(it) : deck === "place" ? `/places/${it.image}` : it.image ? `/ideas/${it.image}` : null;
      if (src) new Image().src = src;
    }
  }, [queue.length]);

  async function onSwipe(item: Item, score: number) {
    score >= 4 ? haptic.medium() : haptic.light();
    swiped.current.add(item.id);
    setQueue((q) => q.filter((i) => i.id !== item.id));
    // «осталось 750 карточек» не менялось, пока не подгружалась новая пачка (тест 11.10.2026)
    setLeft((l) => (l === null ? l : Math.max(0, l - 1)));
    setHistory((h) => [item, ...h].slice(0, 20));
    try {
      const r = await api<{ match: Item | null }>("/swipe", { body: { deck, item: item.id, score } });
      if (r.match) store.showMatch({ deck, item: r.match, by: me!.id });
    } catch (e) {
      store.toast((e as Error).message);
    }
  }

  async function undo() {
    const [last, ...rest] = history;
    if (!last) return;
    haptic.select();
    setHistory(rest);
    swiped.current.delete(last.id);
    setQueue((q) => [last, ...q]);
    setLeft((l) => (l === null ? l : l + 1));
    await api("/swipe/undo", { body: { deck, item: last.id } });
  }

  const partnerHere = partner && presence[String(partner.id)] === deck;
  const invite = useAct(() => api("/movies/invite", { body: {} }));

  // Колода тянется по высоте экрана, а оценки и «вернуть» всегда под ней на экране:
  // на Android 448×646 и iPhone 13 кнопки уходили под край (тест 11.10.2026)
  return (
    <div className="deck-screen">
      <Head
        back
        caption={partnerHere ? `● ${partner!.name} свайпает вместе с тобой` : partner ? `${partner.name} пока не здесь` : "мэтчи появятся, когда придёт половинка"}
        title={DECK_TITLE[deck]}
        actions={
          <button className="icon-btn" onClick={() => nav.push("matches", { deck })} aria-label="Мэтчи">
            <Heart size={19} />
          </button>
        }
      />
      {deck === "idea" && (
        <div className="row" style={{ gap: 8, marginTop: -6, marginBottom: 12 }}>
          <button className="pill" onClick={() => setAddIdea(true)}>
            <Plus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
            Своё место
          </button>
        </div>
      )}
      {deck === "movie" && (
        <div className="pills scroll" style={{ marginTop: -6, paddingBottom: 6, marginBottom: 6 }}>
          <button className="pill" onClick={() => setAddFilm(true)}>
            <Plus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
            Свой фильм
          </button>
          <button className={`pill${myGenres.length ? " on" : ""}`} onClick={() => setGenresOpen(true)} aria-label={myGenres.length ? `Жанры: ${myGenres.join(", ")}` : "Жанры"}>
            🎬 {myGenres.length === 1 ? myGenres[0] : myGenres.length ? `Жанры · ${myGenres.length}` : "Жанры"}
          </button>
          {partner && !partnerHere && (
            <button className="pill" onClick={() => invite.mutate(undefined, { onSuccess: () => store.toast("Приглашение отправлено 🍿") })}>
              <Send size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
              Позвать {accusative(partner.name)}
            </button>
          )}
        </div>
      )}

      <div className="deck">
        {loading ? (
          <Spinner />
        ) : queue.length === 0 ? (
          <DeckEmpty deck={deck} onReset={async () => { await api(`/swipes/${deck}`, { method: "DELETE" }); setLoading(true); await load(true); }} />
        ) : (
          <AnimatePresence>
            {queue.slice(0, 3).reverse().map((item) => {
              const idx = queue.indexOf(item);
              return (
                <SwipeCard
                  key={item.id}
                  item={item}
                  deck={deck}
                  depth={idx}
                  bindTop={idx === 0 ? (fn) => (topSwipe.current = fn) : undefined}
                  onSwipe={(score) => onSwipe(item, score)}
                  onInfo={() => setInfo(item)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>

      <div className="rate-row">
        {SCORES.map((sc) => (
          <motion.button
            key={sc.v}
            whileTap={{ scale: 0.86 }}
            className={`rate${sc.v === 5 ? " hot" : ""}`}
            onClick={() => topSwipe.current?.(sc.v)}
            aria-label={sc.l}
            disabled={!queue.length}
          >
            <span className="emoji">{sc.e}</span>
            <small>{sc.l}</small>
          </motion.button>
        ))}
      </div>
      <div className="deck-under">
        <button className="link small" onClick={undo} disabled={!history.length} style={{ opacity: history.length ? 1 : 0.35 }}>
          <RotateCcw size={14} style={{ verticalAlign: -2 }} /> вернуть
        </button>
        {left !== null && queue.length > 0 && (
          <span className="mono-sm" aria-live="polite">
            осталось {left} {plural(left, "карточка", "карточки", "карточек")}
          </span>
        )}
        <button className="link small" onClick={() => queue[0] && setInfo(queue[0])}>
          <Info size={14} style={{ verticalAlign: -2 }} /> подробнее
        </button>
      </div>

      <InfoSheet
        item={info}
        deck={deck}
        onClose={() => setInfo(null)}
        onRemoved={() => { setInfo(null); setLoading(true); void load(true); }}
      />
      {deck === "movie" && (
        <GenresSheet
          open={genresOpen}
          onClose={(changed) => {
            setGenresOpen(false);
            if (!changed) return;
            setLoading(true);
            // Обратная связь сразу: сколько фильмов теперь в колоде
            void load(true).then((r) => r && store.toast(`В колоде ${r.left} ${plural(r.left, "фильм", "фильма", "фильмов")} под ваш выбор`));
          }}
        />
      )}
      {deck === "movie" && <AddFilmSheet open={addFilm} onClose={(changed) => { setAddFilm(false); if (changed) { setLoading(true); void load(true); } }} />}
      {deck === "idea" && <AddIdeaSheet open={addIdea} onClose={() => { setAddIdea(false); void load(true); }} />}
    </div>
  );
}

function DeckEmpty({ deck, onReset }: { deck: Deck; onReset: () => void }) {
  return (
    <Empty art={deck === "movie" ? "popcorn" : "map"} title="Карточки закончились" text="Можно ещё раз пройтись по тем, что получили «не хочу» и «не очень», или загляни в мэтчи.">
      <div className="grid-2" style={{ maxWidth: 320, margin: "0 auto" }}>
        <button className="btn soft sm" style={{ width: "100%" }} onClick={onReset}>Ещё раз</button>
        <button className="btn sm" style={{ width: "100%" }} onClick={() => nav.push("matches", { deck })}>Мэтчи</button>
      </div>
    </Empty>
  );
}

function SwipeCard({
  item, deck, depth, bindTop, onSwipe, onInfo,
}: {
  item: Item;
  deck: Deck;
  depth: number;
  bindTop?: (fn: (score: number) => void) => void;
  onSwipe: (score: number) => void;
  onInfo: () => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-16, 16]);
  const yes = useTransform(x, [25, 110], [0, 1]);
  const no = useTransform(x, [-110, -25], [1, 0]);
  const hot = useTransform(y, [-120, -30], [1, 0]);
  const gone = useRef(false);

  // Куда улетает карточка: 1–2 влево, 3 вниз, 4 вправо, 5 вверх
  const fly = (score: number, velocity = 0) => {
    if (gone.current) return;
    gone.current = true;
    const w = window.innerWidth + 200;
    const h = window.innerHeight + 200;
    const done = () => onSwipe(score);
    const t = { type: "tween" as const, duration: 0.28, ease: "easeOut" as const, velocity };
    if (score >= 5) void animate(y, -h, t).then(done);
    else if (score === 3) void animate(y, h, t).then(done);
    else void animate(x, score >= 4 ? w : -w, t).then(done);
  };

  useEffect(() => {
    bindTop?.(fly);
  });

  const top = depth === 0;
  // Внешний слой отвечает за стопку (сдвиг и масштаб глубины), внутренний — за перетаскивание
  return (
    <motion.div
      style={{ position: "absolute", inset: 0, zIndex: 10 - depth }}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.045, y: depth * 14, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
    <motion.div
      className="swipe-card"
      style={{ x, y, rotate: top ? rotate : 0 }}
      drag={top}
      dragSnapToOrigin={false}
      dragElastic={0.9}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        const up = info.offset.y < -120 && Math.abs(info.offset.x) < 90;
        if (up || info.velocity.y < -800) fly(5, info.velocity.y);
        else if (info.offset.x > 110 || info.velocity.x > 650) fly(4, info.velocity.x);
        else if (info.offset.x < -110 || info.velocity.x < -650) fly(1, info.velocity.x);
        else {
          void animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
          void animate(y, 0, { type: "spring", stiffness: 500, damping: 30 });
        }
      }}
      onTap={(e) => {
        // Тап по нижней части открывает подробности
        const el = e.target as HTMLElement;
        if (top && el.closest(".info")) onInfo();
      }}
    >
      <CardFace item={item} deck={deck} />
      {top && (
        <>
          <motion.div className="stamp yes" style={{ opacity: yes }}>Хочу</motion.div>
          <motion.div className="stamp no" style={{ opacity: no }}>Нет</motion.div>
          <motion.div className="stamp hot" style={{ opacity: hot }}>Очень!</motion.div>
        </>
      )}
    </motion.div>
    </motion.div>
  );
}

/** Пометка на карточке: это место предложила половинка, и насколько ей туда хочется. */
function Proposed({ item }: { item: Item }) {
  if (!item.partnerScore) {
    if (!item.savedBy) return null;
    if (item.savedSource === "user") {
      return <div className="proposed">🎬 {item.savedBy === "ты" ? "твоё предложение" : `${String(item.savedBy)} предлагает`}</div>;
    }
    return (
      <div className="proposed">
        📌 {item.savedBy === "ты" ? "из твоих сохранёнок" : `из сохранёнок ${genitive(String(item.savedBy))}`}
      </div>
    );
  }
  const sc = SCORES.find((x) => x.v === item.partnerScore);
  return (
    <div className="proposed">
      <span className="emoji">{sc?.e}</span> {String(item.partnerName ?? "Половинка")} {Number(item.partnerScore) >= 5 ? "очень хочет сюда" : "хочет сюда"}
    </div>
  );
}

function CardFace({ item, deck }: { item: Item; deck: Deck }) {
  if (deck === "movie") {
    const genres = (item.genres as string[]) ?? [];
    const poster = posterSrc(item);
    return (
      <>
        {poster ? (
          <img className="poster" src={poster} alt="" draggable={false} />
        ) : (
          <div className="poster" style={{ background: gradientFor(item.id), display: "grid", placeItems: "center", paddingBottom: "40%" }}>
            <span className="emoji" style={{ fontSize: 110 }}>🎬</span>
          </div>
        )}
        <div className="shade" />
        <Proposed item={item} />
        <div className="info">
          <div className="title-lg" style={{ fontSize: 27, color: "#fff" }}>{String(item.title)}</div>
          <div style={{ opacity: 0.8, margin: "4px 0 10px" }}>
            {item.year ? String(item.year) : ""}
            {item.minutes ? ` · ${item.minutes} мин` : ""}
            {item.original && item.original !== item.title ? ` · ${item.original}` : ""}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {item.score ? <span className="chip score">★ {ratingText(item.score)}</span> : null}
            {genres.map((g) => <span key={g} className="chip">{g}</span>)}
          </div>
          <div className="small" style={{ opacity: 0.85, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {String(item.description ?? "")}
          </div>
        </div>
      </>
    );
  }
  if (deck === "place") {
    return (
      <>
        <img className="poster" src={`/places/${item.image}`} alt="" draggable={false} />
        <div className="shade" />
        <div className="info">
          <div className="title-lg" style={{ fontSize: 28, color: "#fff" }}>{String(item.flag ?? "")} {String(item.name)}</div>
          <div style={{ opacity: 0.8, margin: "4px 0 10px" }}>{String(item.country)} · {String(item.route)}</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <span className="chip">{BUDGET[Number(item.budget)] || "₽"}</span>
            <span className="chip">{String(item.days)}</span>
            <span className="chip">{String(item.season)}</span>
          </div>
          <div className="small" style={{ opacity: 0.88 }}>{String(item.why)}</div>
        </div>
      </>
    );
  }
  const ideaPhoto = item.photoUrl ? String(item.photoUrl) : item.image ? `/ideas/${item.image}` : null;
  if (ideaPhoto) {
    // Карточка места с фотографией: как у направлений, эмодзи — значком в углу
    return (
      <>
        <img className="poster" src={ideaPhoto} alt="" draggable={false} />
        <div className="shade" />
        <div className="emoji" style={{ position: "absolute", top: 16, right: 16, fontSize: 30, background: "rgba(0,0,0,.35)", borderRadius: 16, padding: "4px 8px" }}>{String(item.emoji ?? "💡")}</div>
        <Proposed item={item} />
        <div className="info">
          {Boolean(item.custom) && <div className="chip" style={{ marginBottom: 8 }}>ваша идея</div>}
          <div className="title-lg" style={{ fontSize: 26, color: "#fff" }}>{String(item.title)}</div>
          {item.place ? <div style={{ opacity: 0.85, margin: "4px 0 10px" }}>📍 {String(item.place)}</div> : null}
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {item.duration ? <span className="chip">{DURATION_LABEL[String(item.duration)]}</span> : null}
            {item.price ? <span className="chip">{String(item.price)}</span> : null}
          </div>
          {item.why ? <div className="small" style={{ opacity: 0.9 }}>{String(item.why)}</div> : null}
        </div>
      </>
    );
  }
  return (
    <div style={{ position: "absolute", inset: 0, background: gradientFor(item.id), color: "#fff", display: "flex", flexDirection: "column", padding: 24 }}>
      <Proposed item={item} />
      <div className="emoji" style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 120, lineHeight: 1 }}>{String(item.emoji ?? "💡")}</div>
      <div className="info" style={{ position: "static", padding: 0 }}>
        {Boolean(item.custom) && <div className="chip" style={{ marginBottom: 8 }}>ваша идея</div>}
        <div className="title-lg" style={{ fontSize: 28, color: "#fff" }}>{String(item.title)}</div>
        {item.place ? <div style={{ opacity: 0.85, margin: "4px 0 10px" }}>📍 {String(item.place)}</div> : null}
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {item.duration ? <span className="chip">{DURATION_LABEL[String(item.duration)]}</span> : null}
          {item.price ? <span className="chip">{String(item.price)}</span> : null}
        </div>
        {item.why || item.note ? <div className="small" style={{ opacity: 0.9 }}>{String(item.why ?? item.note)}</div> : null}
      </div>
    </div>
  );
}

function InfoSheet({ item, deck, onClose, onRemoved }: { item: Item | null; deck: Deck; onClose: () => void; onRemoved: () => void }) {
  const remove = useAct(
    () => (deck === "movie" ? api(`/movies/added/${encodeURIComponent(item!.id)}`, { method: "DELETE" }) : api(`/ideas/${encodeURIComponent(item!.id)}`, { method: "DELETE" })),
    ["deck", "matches", "films"],
  );
  // Убрать можно то, что пара добавила сама: свой фильм из поиска или свою идею
  const removable = item && (deck === "movie" ? item.savedSource === "user" : deck === "idea" && Boolean(item.custom));
  const poster = item ? posterSrc(item) : null;
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? String(item.title ?? item.name) : ""}>
      {item && deck === "movie" && (
        <>
          <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
            {poster && <img src={poster} alt="" style={{ width: 110, borderRadius: 14 }} />}
            <div className="small">
              <div className="muted">{item.year ? String(item.year) : ""}{item.minutes ? ` · ${item.minutes} мин` : ""}</div>
              {item.original ? <div className="muted">{String(item.original)}</div> : null}
              <div style={{ marginTop: 8 }}>{((item.genres as string[]) ?? []).join(", ")}</div>
            </div>
          </div>
          {item.score ? (
            <div style={{ background: "var(--card-2)", borderRadius: 16, padding: "12px 14px", marginTop: 14 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="chip score" style={{ fontSize: 15, padding: "4px 12px" }}>★ {ratingText(item.score)}</span>
                <span style={{ fontWeight: 650 }}>общий рейтинг</span>
              </div>
              <p className="small muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>{scoreNote(item)}</p>
            </div>
          ) : null}
          <p style={{ lineHeight: 1.5 }}>{String(item.description ?? "")}</p>
          <div className="grid-2">
            <button className="btn soft" onClick={() => openLink(kinopoiskUrl(item as never))}>
              <ExternalLink size={18} /> Кинопоиск
            </button>
            <button className="btn soft" onClick={() => openLink(imdbUrl(item.imdb))} disabled={!item.imdb}>
              <ExternalLink size={18} /> IMDb
            </button>
          </div>
          {item.savedUrl ? (
            <button className="btn soft" style={{ marginTop: 8 }} onClick={() => openLink(String(item.savedUrl))}>
              📌 Пост в инстаграме, где он был
            </button>
          ) : null}
        </>
      )}
      {item && deck !== "movie" && (
        <>
          <p style={{ lineHeight: 1.5, marginTop: 0 }}>{String(item.why ?? item.note ?? "")}</p>
          <div className="small muted">
            {deck === "place" ? `${item.country} · ${item.route} · ${item.days} · лучше всего: ${item.season}` : `${item.place ?? ""}${item.price ? " · " + item.price : ""}`}
          </div>
          {item.savedUrl ? (
            <button className="btn soft" style={{ marginTop: 14 }} onClick={() => openLink(String(item.savedUrl))}>
              📌 Открыть пост в инстаграме
            </button>
          ) : null}
          {item.credit ? (
            <button
              className="mono-sm"
              style={{ display: "block", marginTop: 14, textAlign: "left", fontSize: 11 }}
              onClick={() => openLink(String((item.credit as { source: string }).source))}
            >
              Фото: {String((item.credit as { author: string }).author)}, {String((item.credit as { license: string }).license)}, Wikimedia Commons
            </button>
          ) : null}
        </>
      )}
      {removable && (
        <button
          className="link small"
          style={{ display: "block", margin: "16px auto 0", color: "var(--muted)" }}
          onClick={() => remove.mutate(undefined, { onSuccess: () => { store.toast("Убрано из колоды"); onRemoved(); } })}
        >
          <X size={14} style={{ verticalAlign: -2 }} /> Убрать из колоды
        </button>
      )}
    </Sheet>
  );
}

function GenresSheet({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  const { partner, theyColor } = useMe();
  const { data } = useApi<{ genres: { name: string; count: number }[]; mine: string[]; partner: string[]; total: number }>(["genres"], "/movies/genres");
  const [sel, setSel] = useState<string[] | null>(null);
  const mine = sel ?? data?.mine ?? [];
  const save = useAct((g: string[]) => api("/movies/prefs", { body: { genres: g } }), ["genres"]);
  // Закрыть = применить выбор. Без изменений — просто закрыть, колоду не трогать.
  // Повторное закрытие во время сохранения (кнопка + свайп шторки) не шлёт второй запрос.
  const finish = () => {
    if (save.isPending) return;
    if (!sel) return onClose(false);
    save.mutate(sel, { onSuccess: () => { setSel(null); onClose(true); } });
  };
  const toggle = (g: string) => {
    haptic.select();
    setSel(mine.includes(g) ? mine.filter((x) => x !== g) : [...mine, g]);
  };
  return (
    <Sheet
      open={open}
      onClose={finish}
      title="Какое кино хочется"
    >
      <p className="small muted" style={{ marginTop: -8 }}>
        Колода собирается из жанров обоих. {partner && data?.partner.length ? `Точкой отмечены жанры ${genitive(partner.name)}.` : "Ничего не выбрано — значит, всё подряд."}
      </p>
      <div className="pills">
        {(data?.genres ?? []).map((g) => (
          <button key={g.name} className={`pill${mine.includes(g.name) ? " on" : ""}`} onClick={() => toggle(g.name)}>
            {g.name}
            {data?.partner.includes(g.name) && <span style={{ color: theyColor, marginLeft: 6 }}>●</span>}
          </button>
        ))}
      </div>
      <button className="btn" disabled={save.isPending} onClick={finish}>
        {save.isPending ? "Сохраняю…" : sel ? (mine.length ? `Показать: ${mine.length === 1 ? mine[0] : `${mine.length} ${plural(mine.length, "жанр", "жанра", "жанров")}`}` : "Показать всё подряд") : "Готово"}
      </button>
      {mine.length > 0 && (
        <button className="link small" style={{ display: "block", margin: "12px auto 0" }} onClick={() => { haptic.select(); setSel([]); }}>
          Сбросить выбор
        </button>
      )}
    </Sheet>
  );
}

function AddIdeaSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [emoji, setEmoji] = useState("💡");
  const [duration, setDuration] = useState("2h");
  const [price, setPrice] = useState("");
  const add = useAct(() => api("/ideas", { body: { title, place, emoji, duration, price } }), ["deck", "matches"]);
  return (
    <Sheet open={open} onClose={onClose} title="Своя идея">
      <p className="small muted" style={{ marginTop: -8 }}>Твой лайк стоит сразу. Половинка увидит её в колоде.</p>
      <div className="row" style={{ gap: 10 }}>
        <input className="input" style={{ width: 64, textAlign: "center", fontSize: 24 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Каток в Парке Горького" />
      </div>
      <div style={{ height: 12 }} />
      <Field label="Где">
        <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Необязательно" />
      </Field>
      <Field label="Сколько займёт">
        <Pills value={duration} onChange={setDuration} items={Object.entries(DURATION_LABEL).map(([k, v]) => [k, v])} />
      </Field>
      <Field label="Сколько стоит">
        <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="до 2000 ₽ на двоих" />
      </Field>
      <button className="btn" disabled={!title.trim()} onClick={() => add.mutate(undefined, { onSuccess: () => { setTitle(""); setPlace(""); haptic.success(); onClose(); } })}>
        Добавить в колоду
      </button>
    </Sheet>
  );
}

interface Found {
  imdb: string;
  id: string;
  title: string;
  original: string | null;
  year: number | null;
  years: string | null;
  kind: string;
  thumb: string | null;
  cast: string | null;
  score: number | null;
  added: boolean;
}

/** Поиск фильма или сериала по IMDb: нашёл — добавил в колоду, половинка увидит его первым. */
function AddFilmSheet({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  const { me, partner } = useMe();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const changed = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const search = useApi<{ items: Found[]; failed: boolean }>(
    ["films", "search", query],
    open && query.length >= 2 ? `/movies/search?q=${encodeURIComponent(query)}` : null,
  );
  const added = useApi<{ items: Item[] }>(["films", "added"], open ? "/movies/added" : null);

  async function add(f: Found) {
    setBusy(f.imdb);
    try {
      const r = await api<{ match: Item | null }>("/movies", { body: { imdb: f.imdb } });
      changed.current = true;
      haptic.success();
      if (r.match) store.showMatch({ deck: "movie", item: r.match, by: me!.id });
      else store.toast(partner ? `В колоде. ${partner.name} увидит его первым` : "Фильм в колоде");
      await queryClient.invalidateQueries({ queryKey: ["films"] });
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    haptic.select();
    await api(`/movies/added/${encodeURIComponent(id)}`, { method: "DELETE" });
    changed.current = true;
    void queryClient.invalidateQueries({ queryKey: ["films"] });
  }

  const close = () => {
    onClose(changed.current);
    changed.current = false;
    setQ("");
  };

  const items = search.data?.items ?? [];
  return (
    <Sheet open={open} onClose={close} title="Свой фильм">
      <div style={{ position: "relative" }}>
        <Search size={18} className="muted" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
        <input
          className="input"
          style={{ paddingLeft: 40 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Название фильма или сериала"
          autoFocus
          enterKeyHint="search"
        />
      </div>
      <div style={{ minHeight: 280, marginTop: 12 }}>
        {query.length < 2 ? (
          (added.data?.items.length ?? 0) > 0 ? (
            <>
              <Section title="Вы уже добавили" />
              <div className="stack">
                {added.data!.items.map((it) => (
                  <div key={it.id} className="row" style={{ gap: 12 }}>
                    <FilmThumb src={posterSrc(it)} id={it.id} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontWeight: 650 }}>{String(it.title)}</div>
                      <div className="mono-sm">
                        {it.year ? `${it.year} · ` : ""}
                        {it.mine ? "твоё предложение" : `предлагает ${String(it.by ?? "половинка")}`}
                      </div>
                    </div>
                    <button className="icon-btn" onClick={() => remove(it.id)} aria-label="Убрать из колоды"><X size={18} /></button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="small muted" style={{ margin: "4px 4px 0", lineHeight: 1.5 }}>
              Найди любой фильм или сериал, по-русски или в оригинале. Он встанет в колоду с твоим «хочу», а {partner ? `у ${genitive(partner.name)}` : "у половинки"} окажется первым.
            </p>
          )
        ) : search.isLoading || (search.isFetching && !items.length) ? (
          <Spinner />
        ) : search.data?.failed ? (
          <p className="small muted center">IMDb сейчас не отвечает. Попробуй через минуту.</p>
        ) : !items.length ? (
          <p className="small muted center">Ничего не нашлось. Попробуй название в оригинале.</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {items.map((f) => (
              <button
                key={f.imdb}
                className="row"
                style={{ gap: 12, width: "100%", textAlign: "left", padding: "6px 0", opacity: busy && busy !== f.imdb ? 0.5 : 1 }}
                disabled={f.added || !!busy}
                onClick={() => add(f)}
              >
                <FilmThumb src={f.thumb} id={f.imdb} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 650 }}>{f.title}</div>
                  <div className="row" style={{ gap: 6, marginTop: 3, minWidth: 0 }}>
                    {f.score ? <span className="chip score" style={{ padding: "1px 7px", fontSize: 11, flexShrink: 0 }}>★ {ratingText(f.score)}</span> : null}
                    <span className="mono-sm ellipsis">{[f.years ?? f.year, f.kind !== "фильм" ? f.kind : null, f.original].filter(Boolean).join(" · ")}</span>
                  </div>
                  {f.cast && <div className="small muted ellipsis" style={{ marginTop: 2 }}>{f.cast}</div>}
                </div>
                <span className="icon-btn" style={{ flexShrink: 0, color: f.added ? "var(--muted)" : undefined }} aria-label={f.added ? "Уже в колоде" : "Добавить"}>
                  {busy === f.imdb ? "…" : f.added ? <Check size={18} /> : <Plus size={18} />}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mono-sm center" style={{ marginTop: 14, fontSize: 11 }}>Поиск — IMDb. ★ — среднее оценок Кинопоиска и IMDb</p>
    </Sheet>
  );
}

function FilmThumb({ src, id }: { src: string | null; id: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className="thumb-img" style={{ width: 46, height: 68, borderRadius: 10, background: gradientFor(id), fontSize: 20 }}>🎬</div>;
  return <img src={src} alt="" onError={() => setBroken(true)} style={{ width: 46, height: 68, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />;
}

// ——— мэтчи ———

interface MatchRow {
  item: string;
  status: "new" | "planned" | "done";
  created_at: string;
  mine: number | null;
  partner: number | null;
  data: Item;
}

export function MatchesScreen({ deck }: { deck: Deck }) {
  const { partner, shown } = useMe();
  const [d, setD] = useState<Deck>(deck);
  const { data } = useApi<{ matches: MatchRow[]; myLikes: Item[]; hasPartner: boolean }>(["matches", d], `/matches/${d}`);
  const rate = useAct((v: { item: string; score: number }) => api("/swipe", { body: { deck: d, item: v.item, score: v.score } }), ["matches", "home", "deck"]);
  const [rating, setRating] = useState<string | null>(null);
  const setStatus = useAct((v: { item: string; status: string }) => api(`/matches/${d}/${encodeURIComponent(v.item)}`, { method: "PATCH", body: { status: v.status } }), ["matches", "home"]);
  const [showLikes, setShowLikes] = useState(false);

  const done = useMemo(() => (data?.matches ?? []).filter((m) => m.status === "done"), [data]);
  const active = useMemo(() => (data?.matches ?? []).filter((m) => m.status !== "done"), [data]);

  async function toPlan(it: Item) {
    await api("/plans", { body: { kind: "поездка", title: String(it.name), target: 0, place_id: it.id } });
    void queryClient.invalidateQueries({ queryKey: ["plans"] });
    store.toast("Копилка заведена 🐷");
    nav.tab("wishes");
  }

  const Row = ({ m, rank }: { m: MatchRow; rank: number }) => {
    const it = m.data;
    const isDone = m.status === "done";
    return (
      <div className="card" style={{ padding: 12, opacity: isDone ? 0.6 : 1 }}>
      <div className="row">
        {!isDone && <div className="num grad-text" style={{ fontSize: 20, width: 26, textAlign: "center", flexShrink: 0 }}>{rank}</div>}
        {d === "movie" && (posterSrc(it) ? <img src={posterSrc(it)!} alt="" style={{ width: 54, height: 80, objectFit: "cover", borderRadius: 10 }} /> : <div className="thumb-img" style={{ width: 54, height: 80, borderRadius: 10, background: gradientFor(it.id) }}>🎬</div>)}
        {d === "place" && <img src={`/places/${it.image}`} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 14 }} />}
        {d === "idea" && (it.photoUrl || it.image) ? <img src={it.photoUrl ? String(it.photoUrl) : `/ideas/${it.image}`} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 14 }} /> : null}
        {d === "idea" && !it.photoUrl && !it.image && <div className="thumb-img emoji" style={{ background: gradientFor(it.id) }}>{String(it.emoji ?? "💡")}</div>}
        <div className="grow">
          <div style={{ fontWeight: 650 }}>{String(it.title ?? it.name)}</div>
          <div className="mono-sm">
            {d === "movie" ? `${it.year ?? ""}${it.minutes ? ` · ${it.minutes} мин` : ""}${it.score ? ` · ★ ${ratingText(it.score)}` : ""}` : d === "place" ? String(it.country) : String(it.place ?? "")}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {d === "movie" && !isDone && <button className="chip solid" onClick={() => openLink(kinopoiskUrl(it as never))}>Кинопоиск</button>}
            {d === "idea" && !isDone && shown("schedule") && <button className="chip solid" onClick={() => { nav.tab("calendar"); nav.push("windows", { idea: it }); }}>Когда?</button>}
            {d === "place" && !isDone && <button className="chip solid" onClick={() => toPlan(it)}>Копилка</button>}
            <button className="chip" onClick={() => setStatus.mutate({ item: m.item, status: isDone ? "new" : "done" })}>
              {isDone ? "вернуть" : d === "movie" ? "посмотрели ✓" : d === "place" ? "съездили ✓" : "сходили ✓"}
            </button>
          </div>
        </div>
        <button className="center" style={{ flexShrink: 0, width: 58 }} onClick={() => setRating(rating === m.item ? null : m.item)} aria-label="Оценки">
          <div className="emoji" style={{ fontSize: 20, letterSpacing: 2 }}>{scoreEmoji(m.mine)}{scoreEmoji(m.partner)}</div>
          <div style={{ fontSize: 10.5 }} className="muted">ты · {partner?.name ?? "пара"}</div>
        </button>
      </div>
      {rating === m.item && (
        <div className="rate-row" style={{ marginTop: 10 }}>
          {SCORES.map((sc) => (
            <button
              key={sc.v}
              className={`rate${m.mine === sc.v ? " hot" : ""}`}
              onClick={() => { haptic.select(); rate.mutate({ item: m.item, score: sc.v }); setRating(null); }}
            >
              <span className="emoji">{sc.e}</span>
              <small>{sc.l}</small>
            </button>
          ))}
        </div>
      )}
      </div>
    );
  };

  return (
    <>
      <Head back caption="ваш общий рейтинг" title="Мэтчи" />
      <Pills value={d} onChange={setD} items={[["movie", "🎬 Фильмы"], ["idea", "📍 Места"], ["place", "✈️ Поездки"]]} />
      {!data ? (
        <Spinner />
      ) : !data.matches.length ? (
        <Empty
          art="match"
          title="Мэтчей пока нет"
          text={partner ? `Мэтч появится, когда вы с ${partner.name} лайкнете одно и то же.` : "Позови половинку — мэтчи появятся, когда вы лайкнете одно и то же."}
        >
          <button className="btn inline" onClick={() => nav.push("deck", { deck: d })}>Свайпать</button>
        </Empty>
      ) : (
        <div className="stack">
          <p className="small muted" style={{ margin: "0 4px 4px" }}>Сверху то, чего вы оба хотите сильнее всего. Нажми на оценки справа, чтобы поменять свою.</p>
          {active.map((m, i) => <Row key={m.item} m={m} rank={i + 1} />)}
          {done.length > 0 && <Section title={d === "movie" ? "Посмотрели" : "Уже были"} />}
          {done.map((m) => <Row key={m.item} m={m} rank={0} />)}
        </div>
      )}
      {data && data.myLikes.length > 0 && (
        <>
          <Section
            title={partner ? `Твои лайки ждут ${genitive(partner.name)}` : "Твои лайки"}
            action={<button className="link" onClick={() => setShowLikes(!showLikes)}>{showLikes ? "Скрыть" : `Показать ${data.myLikes.length}`}</button>}
          />
          {showLikes && (
            <div className="scroll-x">
              {data.myLikes.map((it) => (
                <div key={it.id} style={{ width: 96, flexShrink: 0 }}>
                  {d === "movie" ? (
                    posterSrc(it) ? <img src={posterSrc(it)!} alt="" style={{ width: 96, height: 140, objectFit: "cover", borderRadius: 12 }} /> : <div className="thumb-img" style={{ width: 96, height: 140, background: gradientFor(it.id), fontSize: 40 }}>🎬</div>
                  ) : d === "place" ? (
                    <img src={`/places/${it.image}`} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 12 }} />
                  ) : (
                    <div className="thumb-img" style={{ width: 96, height: 96, background: gradientFor(it.id), fontSize: 40 }}>{String(it.emoji ?? "💡")}</div>
                  )}
                  <div className="small ellipsis" style={{ marginTop: 6 }}>
                    <span className="emoji">{scoreEmoji(Number(it.myScore))}</span> {String(it.title ?? it.name)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div style={{ height: 10 }} />
      <button className="btn soft" onClick={() => nav.push("deck", { deck: d })}>
        <Check size={18} /> Свайпать дальше
      </button>
    </>
  );
}
