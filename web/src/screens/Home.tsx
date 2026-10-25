import { motion } from "motion/react";
import { ChevronRight, Mail, Plus, Send, Sparkles, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, useAct, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { dative, dayLabel, dayMonth, duration, genitive, hhmm, MONTHS_SHORT, plural, spaced, today } from "../fmt.ts";
import { addToHomeScreen, haptic, homeScreenStatus, isIOS, onHomeScreenAdded, promoParam, shareLink, type HomeStatus } from "../tg.ts";
import { nav, store } from "../store.ts";
import { Avatar, Field, Logo, Section, Sheet, Spinner } from "../ui/kit.tsx";
import { Ring } from "../ui/Ring.tsx";
import { GhostSheet, InviteSheet } from "./Sheets.tsx";
import { OfferBanner } from "./Paywall.tsx";
import { SearchButton } from "./Search.tsx";
import type { Home, NowStatus, Person, Win } from "../types.ts";

const PINGS: [string, string, string][] = [
  ["miss", "💭", "Скучаю"],
  ["hug", "🤗", "Обнять"],
  ["kiss", "💋", "Поцелуй"],
  ["think", "✨", "Думаю"],
];

const MOODS = ["😊", "🥰", "😴", "🤯", "😔", "🤒", "🥳", "📚", "😤", "🫠"];

const UPCOMING_ICON: Record<string, string> = { birthday: "🎂", anniversary: "🥂", capsule: "💌", trip: "✈️", date: "💞", event: "📌" };

const BUSY_WORD: Record<string, string> = {
  class: "на паре", work: "на работе", tutoring: "на занятии", sport: "на тренировке", other: "занято",
  beauty: "занято", health: "у врача", errands: "по делам", friends: "с друзьями",
};

function greeting(name: string): string {
  const h = new Date(Date.now() + 180 * 60_000).getUTCHours();
  const part = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
  return `${part}, ${name}`;
}

function nowMin(): number {
  const d = new Date(Date.now() + 180 * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Что человек делает сейчас — без рода: «на паре до 13:20», «свободно до 15:40». */
function statusLine(s: NowStatus): { main: string; sub: string | null } {
  if (s.state === "busy") {
    const word = s.online ? "онлайн-занятие" : BUSY_WORD[s.category ?? "class"] ?? "занято";
    return { main: `${word} до ${hhmm(s.until!)}`, sub: s.title };
  }
  if (s.state === "road") return { main: `в дороге, начало в ${hhmm(s.until!)}`, sub: s.title };
  if (s.state === "rest") return { main: "отдыхает", sub: s.next ? `первое занятие в ${hhmm(s.next.start)}` : null };
  return { main: s.until ? `свободно до ${hhmm(s.until)}` : "дальше свободно", sub: s.next ? `потом: ${s.next.title}` : null };
}

const HS_KEY = "vdvoyom:home-screen-hidden-until";
const hiddenUntil = (): number => {
  try {
    return Number(localStorage.getItem(HS_KEY) ?? 0);
  } catch {
    return 0;
  }
};
const hideFor = (days: number) => {
  try {
    localStorage.setItem(HS_KEY, String(Date.now() + days * 86_400_000));
  } catch {
    /* приватный режим — просто спрячем до перезапуска */
  }
};

/**
 * Плашка «поставь на экран Домой» — первой на главной, пока приложение туда не
 * добавлено. Андроид сообщает, что добавили; айфон часто не знает, поэтому
 * после нажатия и по крестику плашка прячется на неделю и месяц.
 * ?hs=1 показывает её в браузере для снимков.
 */
function HomeScreenBanner() {
  const force = new URLSearchParams(location.search).has("hs");
  const [status, setStatus] = useState<HomeStatus | null>(null);
  const [hidden, setHidden] = useState(() => hiddenUntil() > Date.now());
  useEffect(() => {
    void homeScreenStatus().then(setStatus);
    return onHomeScreenAdded(() => {
      setStatus("added");
      haptic.success();
      store.toast("Готово: «Вдвоём» на экране «Домой» 💞");
    });
  }, []);
  if (!force && (hidden || status === null || status === "added" || status === "unsupported")) return null;
  return (
    <motion.div
      className="card grad"
      style={{ marginBottom: 10, position: "relative", overflow: "hidden" }}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <button
        aria-label="Скрыть"
        onClick={() => { hideFor(30); setHidden(true); }}
        style={{ position: "absolute", top: 10, right: 10, color: "inherit", opacity: 0.75, padding: 6 }}
      >
        <X size={18} />
      </button>
      <div className="row" style={{ gap: 14, alignItems: "center", paddingRight: 24 }}>
        <img src="/icon-192.png" alt="" width={60} height={60} style={{ borderRadius: 16, flexShrink: 0, boxShadow: "0 6px 18px rgba(0,0,0,.25)" }} />
        <div className="grow">
          <div className="title-md" style={{ lineHeight: 1.2 }}>Поставь «Вдвоём» на экран «Домой»</div>
          <div className="small" style={{ opacity: 0.9, marginTop: 4 }}>Открывать в одно касание, как обычное приложение</div>
        </div>
      </div>
      <button
        className="btn plain"
        style={{ marginTop: 14 }}
        onClick={() => {
          haptic.medium();
          if (!addToHomeScreen()) return store.toast("Обнови Телеграм: старые версии так не умеют");
          if (isIOS()) store.toast("Открываю Safari: там три касания");
          hideFor(7);
          // Не прячем сразу: на андроиде придёт homeScreenAdded, на айфоне человек увидит свою шторку
          setTimeout(() => setHidden(true), 4000);
        }}
      >
        📲 Добавить на экран
      </button>
    </motion.div>
  );
}

/**
 * Поля главной про «Вдвоём+» (server/src/home.ts → plusMoment, 11.10.2026). Тип здесь, а не
 * в types.ts: тот файл ведёт не этот агент — при сведении перенести в Home.
 */
type HomePlus = Home & {
  /** У пары уже была общая польза (тест, мэтч, вопрос дня) */
  benefit?: boolean;
  offerStarted?: boolean;
  /** «Вдвоём+» оплатил партнёр: id платежа и имя — показать один раз */
  plusGift?: { id: string; from: string } | null;
};

const GIFT_KEY = "vdvoyom:plus-gift-seen";
const giftSeen = (id: string): boolean => {
  try {
    return (localStorage.getItem(GIFT_KEY) ?? "").split(",").includes(id);
  } catch {
    return false;
  }
};
const markGift = (id: string) => {
  try {
    const seen = (localStorage.getItem(GIFT_KEY) ?? "").split(",").filter(Boolean).slice(-9);
    localStorage.setItem(GIFT_KEY, [...seen, id].join(","));
  } catch {
    /* приватный режим — покажем ещё раз, не страшно */
  }
};

/**
 * Партнёр оплатил «Вдвоём+» — второму это тоже видно в приложении, а не только в боте
 * (11.10.2026). Шторка один раз на платёж. Формулировка без рода: «Спасибо Лизе».
 */
function PlusGiftSheet({ gift }: { gift: { id: string; from: string } | null | undefined }) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (gift && !giftSeen(gift.id)) {
      markGift(gift.id);
      setOpen(gift.id);
      haptic.success();
    }
  }, [gift?.id]);
  const close = () => setOpen(null);
  return (
    <Sheet open={!!open && !!gift} onClose={close}>
      {gift && (
        <div className="center" style={{ padding: "4px 0 2px" }}>
          <div className="emoji" style={{ fontSize: 64, lineHeight: 1 }}>💞</div>
          <h3 className="title-lg" style={{ margin: "12px 0 6px" }}>«Вдвоём+» теперь у вас двоих</h3>
          <p className="small muted" style={{ margin: 0 }}>Спасибо {dative(gift.from)}: всё, что было с замком, теперь открыто и у тебя.</p>
          <button className="btn" style={{ marginTop: 16 }} onClick={() => { close(); nav.push("plus", { via: "home" }); }}>
            Посмотреть, что открылось
          </button>
          <button className="link small" style={{ display: "block", margin: "4px auto 0", minHeight: 44, padding: "0 16px" }} onClick={close}>Позже</button>
        </div>
      )}
    </Sheet>
  );
}

export function HomeScreen() {
  const { me, partner, pair, colorFor, meColor, theyColor, shown, data: meData } = useMe();
  const { data: h } = useApi<HomePlus>(["home"], "/home");
  const [sinceOpen, setSinceOpen] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [inviteWin, setInviteWin] = useState<Win | null>(null);

  const ping = useAct((kind: string) => api("/ping", { body: { kind } }));
  const mood = useAct((m: string | null) => api("/mood", { body: { mood: m } }), ["me"]);
  const rsvp = useAct((v: { id: number; yes: boolean }) => api(`/events/${v.id}/rsvp`, { body: { yes: v.yes } }), ["home", "events"]);

  const real = !!partner && !partner.ghost;
  const t = today();

  return (
    <div className="screen">
      <div className="head" style={{ alignItems: "center" }}>
        <div className="row grow" style={{ gap: 10 }}>
          <Logo size={36} a={meColor} b={theyColor} />
          <div>
            <div className="title-lg" style={{ fontSize: 22 }}>Вдвоём</div>
            <div className="small muted">{greeting(me?.name ?? "")}</div>
          </div>
        </div>
        {meData?.plusOn && pair && !pair.plus?.active && (
          <button className="plus-spark" aria-label="Вдвоём+" onClick={() => { haptic.medium(); nav.push("plus", { via: "home" }); }} style={{ marginRight: 10 }}>
            <Sparkles size={20} />
          </button>
        )}
        <div style={{ marginRight: 8 }}><SearchButton /></div>
        <button onClick={() => nav.push("settings")} aria-label="Настройки" className="row" style={{ gap: 0 }}>
          <Avatar p={me} size={40} />
          <div style={{ marginLeft: -12 }}>
            <Avatar p={partner} size={40} />
          </div>
        </button>
      </div>

      <HomeScreenBanner />

      {(!partner || partner.ghost) && pair && (
        <div className="card grad" style={{ marginBottom: 10 }}>
          <div className="title-md">{partner ? `${partner.name} ещё не в приложении` : "Позови половинку"}</div>
          <p className="small" style={{ margin: "6px 0 14px", opacity: 0.88 }}>
            {partner
              ? `Расписание и места уже здесь. Отправь ${dative(partner.name)} ссылку — и всё это станет общим.`
              : "Отправь ссылку — и всё станет общим. А расписание половинки можно внести заранее."}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm inline plain" onClick={() => shareLink(pair.invite, "Давай вести наши планы, хотелки и свидания вместе 💞")}>
              <Send size={16} /> Пригласить
            </button>
            {!partner && (
              <button className="btn sm inline soft" onClick={() => setGhostOpen(true)}>
                <UserPlus size={16} /> Внести заранее
              </button>
            )}
          </div>
        </div>
      )}

      {!h ? (
        <Spinner />
      ) : (
        <>
          {/* Сейчас: кто где, и ближайшее общее окно. Кто убрал расписание, тому не нужно */}
          {shown("schedule") && (
          <div className="card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <div className="caps">Сейчас</div>
              <div className="small muted">{hhmm(nowMin())}</div>
            </div>
            {(
              [
                [me, h.now.me],
                [partner, h.now.partner],
              ] as [Person | null, NowStatus | null][]
            ).map(([p, st], i) => {
              if (!p || !st) return null;
              const line = statusLine(st);
              const dot = st.state === "busy" ? "var(--sun)" : st.state === "road" ? "var(--sky)" : st.state === "free" ? "var(--mint)" : "var(--faint)";
              return (
                <div key={i} className="row" style={{ marginTop: i ? 12 : 0 }}>
                  <div style={{ position: "relative" }}>
                    <Avatar p={p} size={38} />
                    <span style={{ position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--card)", background: dot }} />
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 750 }}>
                      {i === 0 ? "Ты" : p.name} <span className="muted" style={{ fontWeight: 600 }}>· {line.main}</span>
                    </div>
                    {line.sub && <div className="small muted ellipsis">{line.sub}</div>}
                  </div>
                </div>
              );
            })}
            {partner && h.windows[0] && (
              <button className="card flat row" style={{ width: "100%", textAlign: "left", marginTop: 14, padding: 12 }} onClick={() => setInviteWin(h.windows[0])}>
                <div className="dot" style={{ ["--c" as string]: "var(--mint)" }} />
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>
                    {h.windows[0].date === t ? "Сегодня" : dayLabel(h.windows[0].date).replace(/^./, (c) => c.toUpperCase())} с {hhmm(h.windows[0].start)} вы оба свободны
                  </div>
                  <div className="small muted">{duration(h.windows[0].end - h.windows[0].start)} · позвать на свидание</div>
                </div>
                <ChevronRight size={18} className="faint" />
              </button>
            )}
            {!h.hasSchedule.me && (
              <button className="link small" style={{ marginTop: 12 }} onClick={() => { nav.tab("calendar"); nav.push("schedule"); }}>
                Добавь своё расписание, чтобы считать окна →
              </button>
            )}
          </div>
          )}

          {/* Сегодня в календаре и приглашения */}
          {h.todayEvents.length > 0 && (
            <div className="stack" style={{ marginTop: 10 }}>
              {h.todayEvents.map((e) => (
                <div key={e.id} className="card row accent-left" style={{ padding: 14, ["--edge" as string]: e.kind === "date" ? "var(--rose)" : colorFor(e.author_id) }}>
                  <span className="emoji" style={{ fontSize: 22 }}>{UPCOMING_ICON[e.kind] ?? "📌"}</span>
                  <div className="grow">
                    <div style={{ fontWeight: 700 }}>{e.title}</div>
                    <div className="small muted">
                      {e.start_min != null ? `сегодня в ${hhmm(e.start_min)}` : "сегодня"}
                      {e.status === "proposed" ? " · ждём ответа" : e.status === "declined" ? " · не получится" : e.status === "accepted" ? " · идёте 💞" : ""}
                    </div>
                  </div>
                  {e.status === "proposed" && e.author_id !== me?.id && (
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm inline" onClick={() => rsvp.mutate({ id: e.id, yes: true })}>Иду</button>
                      <button className="btn sm inline soft" onClick={() => rsvp.mutate({ id: e.id, yes: false })}>Нет</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {h.capsulesReady.map((c) => (
            <motion.div key={c.id} whileTap={{ scale: 0.98 }} className="card row" style={{ background: "var(--they)", color: "#1a0d0b", marginTop: 10, border: 0 }} onClick={() => nav.push("capsules")}>
              <Mail size={26} />
              <div className="grow">
                <div className="title-md">Тебя ждёт письмо</div>
                <div className="small" style={{ opacity: 0.75 }}>
                  {c.title} · от {genitive(partner?.name ?? "")}
                </div>
              </div>
              <ChevronRight />
            </motion.div>
          ))}

          {/* Сколько вместе */}
          <motion.div className="card" whileTap={{ scale: 0.985 }} onClick={() => setSinceOpen(true)} style={{ marginTop: 10 }}>
            {h.together ? (
              <div className="split">
                <div>
                  <div className="num grad-text" style={{ fontSize: 38, lineHeight: 1 }}>{spaced(h.together.days)}</div>
                  <div className="small muted" style={{ marginTop: 8 }}>{plural(h.together.days, "день", "дня", "дней")} вместе</div>
                </div>
                <div className="divider" />
                <div>
                  <div className="num" style={{ fontSize: 38, lineHeight: 1 }}>{h.together.next.daysLeft}</div>
                  <div className="small muted" style={{ marginTop: 8 }}>до {h.together.next.years}-й годовщины</div>
                </div>
              </div>
            ) : (
              <div className="row between">
                <div>
                  <div className="title-md">С какого дня вы вместе?</div>
                  <div className="small muted">Начнём считать дни и напомним о годовщине</div>
                </div>
                <ChevronRight className="faint" />
              </div>
            )}
          </motion.div>

          {/* Прикосновения — когда половинка уже в приложении */}
          {real && (
            <div className="card" style={{ padding: 14, marginTop: 10 }}>
              <div className="row between" style={{ marginBottom: 12, padding: "0 4px" }}>
                <div className="small">
                  {partner!.mood ? (
                    <>
                      <span className="muted">{partner!.name} сейчас</span> <span className="emoji" style={{ fontSize: 18 }}>{partner!.mood}</span>
                    </>
                  ) : (
                    <span className="muted">Отправь {dative(partner!.name)} тепла</span>
                  )}
                </div>
                <button className="pill" style={{ padding: "6px 12px" }} onClick={() => setMoodOpen(true)}>
                  {me?.mood ? <span className="emoji" style={{ fontSize: 17 }}>{me.mood}</span> : "Моё настроение"}
                </button>
              </div>
              <div className="grid-4">
                {PINGS.map(([k, e, label]) => (
                  <motion.button
                    key={k}
                    whileTap={{ scale: 0.85 }}
                    className="card flat center"
                    style={{ padding: "12px 4px", borderRadius: 16, margin: 0 }}
                    onClick={() => {
                      haptic.medium();
                      ping.mutate(k, { onSuccess: () => store.toast(`${e} Отправлено`) });
                    }}
                  >
                    <div className="emoji" style={{ fontSize: 26 }}>{e}</div>
                    <div className="small muted" style={{ marginTop: 2, fontSize: 12.5 }}>{label}</div>
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Цели */}
          {shown("goals") && (<>
          <Section title="Наши цели" action={<button className="link" onClick={() => nav.push("goals")}>{h.goals.length ? "Все" : "Поставить"}</button>} />
          {h.goals.length ? (
            <div className="scroll-x">
              {h.goals.map((g) => {
                const mine = g.byUser[String(me?.id)] ?? 0;
                const theirs = partner ? g.byUser[String(partner.id)] ?? 0 : 0;
                const base = Math.max(g.target, 1);
                const parts =
                  g.kind === "checklist"
                    ? [{ value: g.progress / base, color: meColor }]
                    : [
                        { value: mine / base, color: meColor },
                        { value: theirs / base, color: theyColor },
                        { value: Math.max(0, g.progress - mine - theirs) / base, color: "var(--mint)" },
                      ];
                return (
                  <button key={g.id} className="card" style={{ width: 150, flexShrink: 0, margin: 0, textAlign: "left" }} onClick={() => nav.push("goals")}>
                    <Ring parts={parts} size={58}>
                      <span className="emoji">{g.emoji ?? "🎯"}</span>
                    </Ring>
                    <div style={{ fontWeight: 750, marginTop: 10, lineHeight: 1.25 }}>{g.title}</div>
                    <div className="small muted">
                      {g.progress} из {g.target}
                      {g.kind === "habit" ? " за неделю" : g.unit ? ` ${g.unit}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <button className="card row" style={{ width: "100%", textAlign: "left" }} onClick={() => nav.push("goals")}>
              <span className="emoji" style={{ fontSize: 28 }}>🎯</span>
              <div className="grow">
                <div style={{ fontWeight: 750 }}>Поставьте общую цель</div>
                <div className="small muted">20 новых мест, 12 книг, спорт трижды в неделю</div>
              </div>
              <Plus size={18} className="faint" />
            </button>
          )}
          </>)}

          {/* Вопрос дня */}
          {h.daily && shown("daily") && (
            <>
              <Section title="Вопрос дня" />
              <motion.div whileTap={{ scale: 0.985 }} className="card" onClick={() => nav.push("daily")}>
                <div className="title-md" style={{ fontSize: 18.5, lineHeight: 1.32 }}>{h.daily.question.text}</div>
                <div className="row between" style={{ marginTop: 14 }}>
                  <div className="small muted">
                    {h.daily.mine && h.daily.partner
                      ? "Оба ответили — смотри ответы"
                      : h.daily.mine
                        ? real
                          ? `Ждём ответ ${genitive(partner!.name)}`
                          : "Ответ сохранён"
                        : h.daily.partnerAnswered
                          ? `Ответ ${genitive(partner?.name ?? "")} уже здесь 👀`
                          : "Ответов пока нет — начни"}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <div className="dot" style={{ ["--c" as string]: h.daily.mine ? meColor : "var(--card-3)" }} />
                    <div className="dot" style={{ ["--c" as string]: h.daily.partnerAnswered ? theyColor : "var(--card-3)" }} />
                  </div>
                </div>
              </motion.div>
            </>
          )}

          {/* Акция — не первой карточкой, а после вопроса дня (11.10.2026): сервер заводит её только после
              первой общей пользы пары, и время в ней — датой, без бегущих секунд */}
          <OfferBanner />

          {h.newMatches > 0 && (
            <motion.div whileTap={{ scale: 0.985 }} className="card row" style={{ marginTop: 10 }} onClick={() => nav.tab("swipes")}>
              <Sparkles color="var(--rose)" />
              <div className="grow">
                <div className="title-md">
                  {h.newMatches} {plural(h.newMatches, "новый мэтч", "новых мэтча", "новых мэтчей")}
                </div>
                <div className="small muted">Вы совпали в желаниях — загляни</div>
              </div>
              <ChevronRight className="faint" />
            </motion.div>
          )}

          {/* Тесты на главной — только когда партнёр уже ответил и ждёт (спецификация 08.10.2026) */}
          {h.testWaiting && shown("tests") && (
            <motion.div whileTap={{ scale: 0.985 }} className="card row" style={{ marginTop: 10 }} onClick={() => { nav.tab("swipes"); nav.push("tests"); nav.push("test", { id: h.testWaiting!.id }); }}>
              <span style={{ fontSize: 28 }}>{h.testWaiting.emoji}</span>
              <div className="grow">
                <div className="title-md">{partner?.name ?? "Партнёр"} ждёт тебя в тесте</div>
                <div className="small muted">{h.testWaiting.title} · свои ответы уже есть</div>
              </div>
              <ChevronRight className="faint" />
            </motion.div>
          )}

          {/* Скоро */}
          {h.upcoming.length > 0 && (
            <>
              <Section title="Скоро" action={<button className="link" onClick={() => nav.tab("calendar")}>Календарь</button>} />
              <div className="stack">
                {h.upcoming.map((u, i) => (
                  <div key={i} className="card row" style={{ padding: 14 }}>
                    <div className="center" style={{ width: 44 }}>
                      <div className="num" style={{ fontSize: 20 }}>{Number(u.date.slice(8))}</div>
                      <div className="small muted" style={{ fontSize: 11.5 }}>{MONTHS_SHORT[Number(u.date.slice(5, 7)) - 1]}</div>
                    </div>
                    <div style={{ width: 3, alignSelf: "stretch", borderRadius: 3, background: u.who ? colorFor(u.who) : "var(--mint)" }} />
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{`${UPCOMING_ICON[u.kind] ?? "📌"} ${u.title}`}</div>
                      <div className="small muted">
                        {u.daysLeft === 0 ? "сегодня" : u.daysLeft === 1 ? "завтра" : `через ${u.daysLeft} ${plural(u.daysLeft, "день", "дня", "дней")}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Наш год */}
          <Section title={`Наш ${h.stats.year}-й`} />
          <div className="card">
            <div className="grid-4" style={{ gap: 4 }}>
              {(
                [
                  [h.stats.movies, plural(h.stats.movies, "фильм", "фильма", "фильмов")],
                  [h.stats.ideasDone, plural(h.stats.ideasDone, "место", "места", "мест")],
                  [h.stats.wishesDone, plural(h.stats.wishesDone, "подарок", "подарка", "подарков")],
                  [h.stats.questions, plural(h.stats.questions, "вопрос", "вопроса", "вопросов")],
                ] as [number, string][]
              ).map(([n, a], i) => (
                <div key={i}>
                  <div className="num" style={{ fontSize: 24 }}>{n}</div>
                  <div className="small muted" style={{ fontSize: 12.5, marginTop: 2 }}>{a}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="center small faint" style={{ marginTop: 18 }}>
            {dayLabel(t).replace(/^./, (c) => c.toUpperCase())}
          </p>
        </>
      )}

      {/* ?promo=0 (тесты и снимки) — без всплывающего про «Вдвоём+», как и экран при входе */}
      {meData?.plusOn && promoParam() !== "0" && <PlusGiftSheet gift={h?.plusGift} />}
      <SinceSheet open={sinceOpen} onClose={() => setSinceOpen(false)} value={pair?.togetherSince ?? ""} />
      <GhostSheet open={ghostOpen} onClose={() => setGhostOpen(false)} />
      <InviteSheet win={inviteWin} onClose={() => setInviteWin(null)} />
      <Sheet open={moodOpen} onClose={() => setMoodOpen(false)} title="Как ты?">
        <p className="muted small" style={{ marginTop: -8 }}>{partner ? `${partner.name} увидит это на главной` : "Половинка увидит это на главной"}</p>
        <div className="grid-4" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          {MOODS.map((m) => (
            <button
              key={m}
              className="card flat center emoji"
              style={{ margin: 0, padding: 12, fontSize: 30, outline: me?.mood === m ? "2px solid var(--me)" : "none" }}
              onClick={() => {
                haptic.select();
                mood.mutate(m);
                setMoodOpen(false);
              }}
            >
              {m}
            </button>
          ))}
        </div>
        {me?.mood && (
          <button className="btn soft" style={{ marginTop: 14 }} onClick={() => { mood.mutate(null); setMoodOpen(false); }}>
            Убрать
          </button>
        )}
      </Sheet>
    </div>
  );
}

function SinceSheet({ open, onClose, value }: { open: boolean; onClose: () => void; value: string }) {
  const [v, setV] = useState(value);
  const save = useAct((d: string) => api("/pair", { body: { togetherSince: d || null } }), ["me", "home"]);
  return (
    <Sheet open={open} onClose={onClose} title="С какого дня вы вместе">
      <Field label="Дата">
        <input className="input" type="date" max={today()} value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
      {v && <p className="small muted" style={{ marginTop: -4 }}>Годовщина каждый год {dayMonth(v)}. Бот поздравит обоих.</p>}
      <button className="btn" disabled={!v} onClick={() => save.mutate(v, { onSuccess: onClose })}>
        Сохранить
      </button>
    </Sheet>
  );
}
