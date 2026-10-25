import { AnimatePresence, motion } from "motion/react";
import confetti from "canvas-confetti";
import { X } from "lucide-react";
import { useEffect, type MouseEvent } from "react";
import { api, queryClient } from "../api.ts";
import { useMe } from "../data.ts";
import { haptic, openLink, setBackButton } from "../tg.ts";
import { nav, store, useStore } from "../store.ts";
import { Duo } from "../ui/kit.tsx";
import { plural } from "../fmt.ts";

export function kinopoiskUrl(m: { kp?: number | null; title?: unknown; year?: unknown }): string {
  if (m.kp) return `https://www.kinopoisk.ru/film/${m.kp}/`;
  return `https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(`${m.title} ${m.year ?? ""}`)}`;
}

/** Постер фильма: из каталога — /posters/, добавленный поиском — свой адрес, у некоторых его нет. */
export function posterSrc(m: Record<string, unknown>): string | null {
  if (m.posterUrl) return String(m.posterUrl);
  return m.poster ? `/posters/${m.poster}` : null;
}

export const imdbUrl = (id: unknown) => `https://www.imdb.com/title/${id}/`;

/** 8.7 → «8,7» */
export const ratingText = (r: unknown) => Number(r).toFixed(1).replace(".", ",");

/** 2611246 → «2,6 млн голосов», 178295 → «178 тыс. голосов», 523 → «523 голоса» */
export function votesText(n: unknown): string {
  const v = Number(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",").replace(",0", "")} млн голосов`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} тыс. голосов`;
  return `${v} ${plural(v, "голос", "голоса", "голосов")}`;
}

/** Откуда взялся общий рейтинг — одной фразой под ним. */
export function scoreNote(m: Record<string, unknown>): string {
  const kp = m.kpRating ? `Кинопоиск ${ratingText(m.kpRating)} (${votesText(m.kpVotes)})` : null;
  const imdb = m.imdbRating ? `IMDb ${ratingText(m.imdbRating)} (${votesText(m.imdbVotes)})` : null;
  if (kp && imdb) return `Среднее двух оценок: ${kp} и ${imdb}. Кинопоиск ближе к зрителям у нас, IMDb — к зрителям во всём мире.`;
  if (kp) return `Пока только ${kp}: на IMDb у фильма мало голосов.`;
  if (imdb) return `Пока только ${imdb}: на Кинопоиске у фильма ещё нет оценки.`;
  return "";
}

export function MatchOverlay() {
  const match = useStore((s) => s.match);
  const { me, partner } = useMe();

  useEffect(() => {
    if (!match) return;
    haptic.success();
    const colors = ["#ff5f8f", "#ffb86b", "#9b7bff", "#4f8cff"];
    void confetti({ particleCount: 120, spread: 80, origin: { y: 0.35 }, colors, zIndex: 95 });
    const t = setTimeout(() => void confetti({ particleCount: 80, spread: 110, origin: { y: 0.45 }, colors, zIndex: 95 }), 350);
    return () => clearTimeout(t);
  }, [match]);

  const close = () => store.showMatch(null);
  const item = match?.item;

  // Выход из мэтча: крестик, тап по фону, Escape и «Назад» телеграма. Кнопка «Назад»
  // у телеграма одна на всё приложение (tg.ts), поэтому на время мэтча она закрывает
  // его, а потом возвращается к стеку экранов, как её ставит App.tsx.
  // Раньше на Android 448×646 из мэтча не было выхода (тест 11.10.2026).
  useEffect(() => {
    if (!match) return;
    setBackButton(close);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setBackButton(store.get().stack.length ? () => nav.back() : null);
    };
  }, [match]);

  // Тап по пустому месту закрывает; по кнопкам, постеру и тексту — нет
  const onBackdrop = (e: MouseEvent) => {
    if (!(e.target as Element).closest("button, a, img, h1, h2, p, .duo, .emoji")) close();
  };

  async function toPlan() {
    if (!item) return;
    await api("/plans", { body: { kind: "поездка", title: String(item.name), target: 0, place_id: item.id } });
    void queryClient.invalidateQueries({ queryKey: ["plans"] });
    close();
    nav.tab("wishes");
    store.toast("Копилка на поездку заведена 🐷");
  }

  return (
    <AnimatePresence>
      {match && item && (
        <motion.div className="match" role="dialog" aria-modal="true" aria-label="Мэтч" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="match-close" onClick={close} aria-label="Закрыть">
            <X size={22} />
          </button>
          <div className="match-scroll" onClick={onBackdrop}>
            <div className="match-body">
              <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
                <h1>Мэтч!</h1>
                <p className="match-lead">
                  {match.deck === "movie" ? "Вы оба хотите посмотреть" : match.deck === "place" ? "Вы оба хотите туда" : "Вы оба хотите"}
                </p>
              </motion.div>
              <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 20 }}>
                {match.deck === "movie" && posterSrc(item) && <img className="poster" src={posterSrc(item)!} alt="" />}
                {match.deck === "movie" && !posterSrc(item) && <div className="emoji" style={{ fontSize: 110, lineHeight: 1 }}>🎬</div>}
                {match.deck === "place" && <img className="poster" style={{ aspectRatio: "3/4" }} src={`/places/${item.image}`} alt="" />}
                {match.deck === "idea" && (item.photoUrl || item.image) ? <img className="poster" style={{ aspectRatio: "3/4" }} src={item.photoUrl ? String(item.photoUrl) : `/ideas/${item.image}`} alt="" /> : null}
                {match.deck === "idea" && !item.photoUrl && !item.image && <div className="emoji" style={{ fontSize: 110, lineHeight: 1 }}>{String(item.emoji ?? "💡")}</div>}
              </motion.div>
              <div className="row match-duo" style={{ justifyContent: "center" }}>
                <Duo a={me} b={partner} size={40} />
              </div>
              <h2 className="title-lg match-title">
                {String(item.title ?? item.name)}
              </h2>
              {match.deck === "movie" && (
                <p style={{ margin: 0, opacity: 0.7 }}>
                  {String(item.year)} {item.minutes ? `· ${item.minutes} мин` : ""}
                </p>
              )}
              <div className="match-actions">
                {match.deck === "movie" && (
                  <button className="btn" style={{ background: "#fff", color: "#111" }} onClick={() => openLink(kinopoiskUrl(item as never))}>
                    Смотреть на Кинопоиске
                  </button>
                )}
                {match.deck === "idea" && (
                  <button className="btn" style={{ background: "#fff", color: "#111" }} onClick={() => { close(); nav.tab("calendar"); nav.push("windows", { idea: item }); }}>
                    Выбрать, когда
                  </button>
                )}
                {match.deck === "place" && (
                  <button className="btn" style={{ background: "#fff", color: "#111" }} onClick={toPlan}>
                    Завести копилку на поездку
                  </button>
                )}
                <button className="btn soft" style={{ background: "rgba(255,255,255,.12)", color: "#fff" }} onClick={close}>
                  Свайпать дальше
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
