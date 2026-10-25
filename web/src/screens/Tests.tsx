// Тесты на совместимость, формат 2 (08.10.2026).
// Один экран — два ответа (про себя и догадка про партнёра), назад и пропуск,
// черновик на сервере, раунды вместо «Пройти заново», результат тремя группами
// с вопросами для разговора и одной кнопкой действия.
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Clock, Lock, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, queryClient, track, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { dative, dayMonth, genitive, plural } from "../fmt.ts";
import { haptic } from "../tg.ts";
import { nav, store } from "../store.ts";
import { Empty, Head, Section, Sheet, Spinner } from "../ui/kit.tsx";

// ——— данные ———

interface ListItem {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  kind: string;
  minutes: number;
  count: number;
  locked: boolean;
  state: "new" | "draft" | "waiting" | "partner" | "done";
  round: number;
  answered?: number;
}

interface Opt {
  id: string;
  text: string;
  tag?: string;
}

interface Act {
  type: "task" | "event" | "wish" | "goal" | "plan" | "capsule" | "note" | "cheat";
  title: string;
  list: string | null;
  days: number | null;
}

interface Q {
  id: string;
  self: string;
  about: string;
  options: Opt[];
  talk: string[];
  weight: number;
  axis: string | null;
  act: Act | null;
}

interface Ans {
  self?: string;
  guess?: string;
  skip?: boolean;
}
type Answers = Record<string, Ans>;

type Outcome = "same" | "known" | "surprise" | "own" | "diff" | "skip";

interface Summary {
  items: { id: string; outcome: Outcome; mine: Ans; theirs: Ans }[];
  counts: { same: number; known: number; surprise: number; own: number; diff: number };
  hits: { me: number; them: number; total: number };
}

interface Idea {
  id: string;
  title: string;
  emoji: string;
  duration: string;
  price: string;
  why: string;
}

interface Profile {
  axes: { axis: string; title: string; pole: string | null; label: string; split: boolean }[];
  ideas: Idea[];
}

interface Round {
  n: number;
  again: boolean;
  openedAt: string;
  closedAt: string | null;
  questions: Q[];
  mine: { answers: Answers; pos: number; finished: boolean };
  partnerFinished: boolean;
  partner: Answers | null;
  summary: Summary | null;
  profile: Profile | null;
  marks: { talked: string[]; acts: Record<string, string>; cheat: string[] };
  canNudge: boolean;
}

interface TestMeta {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  intro: string | null;
  kind: "guess" | "either";
  perRound: number;
  minutes: number;
  score: boolean;
  cheat: boolean;
}

interface TestData {
  test: TestMeta;
  round: Round | null;
  history?: { n: number; closedAt: string; counts: Summary["counts"] | null }[];
  unseen?: number;
  /** Новый раунд — во «Вдвоём+» (только при PLUS=1): бесплатно первый раунд теста */
  nextLocked?: boolean;
}

const MAX_SKIPS = 2;
const LANG: Record<string, string> = { words: "тёплые слова", time: "время вместе", gifts: "маленькие подарки", acts: "забота делом", touch: "прикосновения" };

const refreshTests = () => {
  void queryClient.invalidateQueries({ queryKey: ["tests"] });
  void queryClient.invalidateQueries({ queryKey: ["test"] });
  void queryClient.invalidateQueries({ queryKey: ["home"] });
};

// ——— список ———

export function TestsScreen() {
  const { partner } = useMe();
  const { data } = useApi<{ tests: ListItem[]; cheat: number }>(["tests"], "/tests");
  const name = partner && !partner.ghost ? partner.name : "партнёр";
  return (
    <>
      <Head back caption="узнайте друг друга" title="Тесты" />
      <p className="muted" style={{ margin: "-6px 2px 16px", lineHeight: 1.45 }}>
        Каждый отвечает у себя, а в большинстве тестов ещё и угадывает ответ партнёра. Ответы друг друга открываются, когда закончили оба.
      </p>
      {!data ? (
        <Spinner />
      ) : (
        <div className="stack">
          {partner && !partner.ghost && data.cheat > 0 && (
            <motion.button whileTap={{ scale: 0.98 }} className="card row" style={{ width: "100%", textAlign: "left" }} onClick={() => nav.push("cheatsheet")}>
              <div style={{ fontSize: 30 }}>📝</div>
              <div className="grow">
                <div className="title-md">Шпаргалка: {name}</div>
                <div className="small muted">
                  {data.cheat} {plural(data.cheat, "ответ", "ответа", "ответов")}, которые не получилось угадать
                </div>
              </div>
              <ChevronRight className="faint" />
            </motion.button>
          )}
          {data.tests.map((t) => (
            <motion.button
              key={t.id}
              whileTap={{ scale: 0.98 }}
              className="card row"
              style={{
                width: "100%",
                textAlign: "left",
                alignItems: "flex-start",
              }}
              onClick={() =>
                t.locked
                  ? store.paywall({ feature: "tests", text: "Бесплатно открыты «Угадай меня», «Идеальное свидание» и «Что мне приятно»" })
                  : nav.push("test", { id: t.id })
              }
            >
              <div style={{ fontSize: 32, lineHeight: 1.1, opacity: t.locked ? 0.55 : 1 }}>{t.emoji}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title-md row" style={{ gap: 6 }}>
                  {t.title}
                  {t.locked && <Lock size={15} className="muted" />}
                </div>
                <div className="small muted" style={{ margin: "2px 0 8px" }}>{t.blurb}</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {t.locked ? (
                    <span className="chip solid" style={{ ["--c" as string]: "var(--accent, var(--rose))" }}>во «Вдвоём+»</span>
                  ) : t.state === "done" ? (
                    <span className="chip solid" style={{ ["--c" as string]: "var(--green)" }}>результат готов</span>
                  ) : t.state === "waiting" ? (
                    <span className="chip">Ждём ответов {genitive(name)}</span>
                  ) : t.state === "partner" ? (
                    <span className="chip solid" style={{ ["--c" as string]: "var(--they)" }}>{name} ждёт тебя</span>
                  ) : t.state === "draft" ? (
                    <span className="chip solid" style={{ ["--c" as string]: "var(--me)" }}>продолжить</span>
                  ) : (
                    <span className="chip">
                      <Clock size={11} /> {t.minutes} мин · {t.count} {plural(t.count, "вопрос", "вопроса", "вопросов")}
                    </span>
                  )}
                  {t.round > 1 && !t.locked && <span className="chip">раунд {t.round}</span>}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </>
  );
}

// ——— тест ———

export function TestScreen({ id, round }: { id: string; round?: number }) {
  const { data, error, refetch } = useApi<TestData>(["test", id, round ?? "now"], round ? `/tests/${id}/rounds/${round}` : `/tests/${id}`);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);

  if (error)
    return (
      <>
        <Head back title="Тесты" />
        <Empty
          emoji="🧪"
          title={(error as ApiError).status === 404 ? "Этого теста больше нет" : "Не получилось открыть тест"}
          text="Тесты обновились: теперь они идут раундами, а результат открывается, когда ответили оба."
        >
          {/* Под тестом всегда лежит список тестов: и из меню, и из кнопки бота (openGo) */}
          <button className="btn soft" onClick={nav.back}>Все тесты</button>
        </Empty>
      </>
    );
  if (!data) return <Spinner />;
  const { test } = data;
  const r = data.round;

  const start = async () => {
    setBusy(true);
    try {
      await api(`/tests/${id}/round`, { body: {} });
      await refetch();
      setStarted(true);
      refreshTests();
    } catch (e) {
      // 402 — сервер уже открыл шторку «Вдвоём+», тост не нужен (пустой store.toast пропускает)
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // История: конкретный прошлый раунд
  if (round && r) {
    return (
      <>
        <Head back caption={`раунд ${r.n}${r.closedAt ? ` · ${dayMonth(r.closedAt.slice(0, 10))}` : ""}`} title={`${test.emoji} ${test.title}`} />
        {r.summary ? <Result test={test} round={r} /> : <p className="muted">Этот раунд ещё не закончен.</p>}
      </>
    );
  }

  const answeredAny = !!r && Object.keys(r.mine.answers).length > 0;
  if (!r || (!r.closedAt && !r.mine.finished && !answeredAny && !started)) return <Intro test={test} round={r} busy={busy} onStart={start} />;
  if (!r.closedAt && !r.mine.finished)
    return (
      <Runner
        key={r.n}
        test={test}
        round={r}
        onDone={async () => {
          await refetch();
          refreshTests();
        }}
      />
    );
  if (!r.closedAt) return <Waiting test={test} round={r} onNudged={() => void refetch()} />;
  return (
    <>
      <Head back caption={`раунд ${r.n} · результат`} title={`${test.emoji} ${test.title}`} />
      {/* Новый раунд — и рядом с итогом (11.10.2026): внизу он оказывался в 4 700 px от начала */}
      <Result
        test={test}
        round={r}
        next={
          <button className={`btn sm${data.nextLocked ? " soft" : " tint"}`} style={{ marginTop: 12, minHeight: 44 }} disabled={busy} onClick={start} data-testid="next-round-top">
            {data.nextLocked && <Lock size={15} />}
            {data.nextLocked ? `Ещё ${test.perRound} ${plural(test.perRound, "вопрос", "вопроса", "вопросов")} · Вдвоём+` : `Новый раунд: ${test.perRound} ${plural(test.perRound, "вопрос", "вопроса", "вопросов")}`}
          </button>
        }
      />
      <Section title="Дальше" />
      {data.unseen !== undefined && data.unseen < test.perRound && (
        <p className="small muted" style={{ margin: "-4px 4px 10px" }}>Вы прошли все вопросы, дальше по второму кругу.</p>
      )}
      {/* Без «Вдвоём+» замок виден заранее; нажатие всё равно идёт на сервер — он и открывает шторку */}
      <button className={`btn${data.nextLocked ? " soft" : ""}`} disabled={busy} onClick={start}>
        {data.nextLocked && <Lock size={16} />}
        {data.nextLocked ? `Ещё ${test.perRound} ${plural(test.perRound, "вопрос", "вопроса", "вопросов")} · Вдвоём+` : `Новый раунд: ${test.perRound} ${plural(test.perRound, "вопрос", "вопроса", "вопросов")}`}
      </button>
      <p className="small muted center" style={{ marginTop: 8 }}>Этот результат никуда не денется: он останется в прошлых раундах.</p>
      {!!data.history?.length && (
        <>
          <Section title="Прошлые раунды" />
          <div className="stack">
            {data.history.map((h) => (
              <button key={h.n} className="card row" style={{ width: "100%", textAlign: "left", padding: 14 }} onClick={() => nav.push("test", { id, round: h.n })}>
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>Раунд {h.n} · {dayMonth(h.closedAt.slice(0, 10))}</div>
                  {h.counts && (
                    <div className="small muted">
                      {test.kind === "either"
                        ? `одинаково ${h.counts.same}, разошлись ${h.counts.diff}`
                        : `одинаково ${h.counts.same}, знали ${h.counts.known}, сюрпризов ${h.counts.surprise}`}
                    </div>
                  )}
                </div>
                <ChevronRight className="faint" />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Intro({ test, round, busy, onStart }: { test: TestMeta; round: Round | null; busy: boolean; onStart: () => void }) {
  const { partner } = useMe();
  const name = partner && !partner.ghost ? partner.name : null;
  return (
    <>
      <Head back caption={round ? `раунд ${round.n}` : "новый тест"} title={`${test.emoji} ${test.title}`} />
      <div className="card">
        <div style={{ fontWeight: 650, lineHeight: 1.4 }}>{test.blurb}</div>
        {test.intro && <p className="small muted" style={{ margin: "8px 0 0", lineHeight: 1.45 }}>{test.intro}</p>}
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <span className="chip"><Clock size={11} /> {test.minutes} мин</span>
          <span className="chip">{test.perRound} {plural(test.perRound, "вопрос", "вопроса", "вопросов")}</span>
          <span className="chip">пропустить можно {MAX_SKIPS}</span>
        </div>
      </div>
      <div className="card flat small" style={{ marginTop: 10, lineHeight: 1.45 }}>
        {test.kind === "either"
          ? "Из двух вариантов выбирай тот, что ближе. Выйти можно в любой момент: ответы сохраняются."
          : `На каждом вопросе — ответ про себя, а потом догадка${name ? `, что выберет ${name}` : " про партнёра"}. Выйти можно в любой момент: ответы сохраняются.`}
        {round?.partnerFinished && name ? ` ${name} уже ждёт: результат откроется сразу после тебя.` : ""}
      </div>
      <button className="btn" style={{ marginTop: 16 }} disabled={busy} onClick={onStart}>
        Начать
      </button>
    </>
  );
}

// ——— прохождение ———

function Runner({ test, round, onDone }: { test: TestMeta; round: Round; onDone: () => Promise<void> }) {
  const qs = round.questions;
  const total = qs.length;
  const guess = test.kind === "guess";
  const [answers, setAnswers] = useState<Answers>(round.mine.answers);
  const [i, setI] = useState(() => Math.min(round.mine.pos, total));
  const [editSelf, setEditSelf] = useState(false);
  const [sending, setSending] = useState(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const q = qs[i] as Q | undefined;
  const a: Ans = q ? answers[q.id] ?? {} : {};
  const skips = Object.values(answers).filter((x) => x.skip).length;
  const done = (x: Ans | undefined) => !!x && (!!x.skip || (!!x.self && (!guess || !!x.guess)));

  // Каждый ответ — сразу на сервер: выход из теста ничего не стирает
  function save(next: Answers, pos: number) {
    saving.current = saving.current
      .catch(() => {})
      .then(() => api(`/tests/${test.id}/draft`, { method: "PUT", body: { round: round.n, answers: next, pos } }))
      .catch((e: Error) => store.toast(e.message || "Ответ не сохранился, проверь интернет"));
  }

  function go(to: number) {
    clearTimeout(timer.current);
    setEditSelf(false);
    setI(Math.max(0, Math.min(total, to)));
  }

  function nextOpen(next: Answers, from: number): number {
    for (let k = from + 1; k < total; k++) if (!done(next[qs[k].id])) return k;
    return total;
  }

  function answer(patch: Ans) {
    if (!q) return;
    haptic.select();
    const merged: Ans = { ...a, ...patch };
    delete merged.skip;
    const next = { ...answers, [q.id]: merged };
    setAnswers(next);
    const complete = done(merged);
    // Дальше — само, когда ответ полный (короткая пауза, чтобы увидеть выбор)
    const pos = complete ? nextOpen(next, i) : i;
    save(next, pos);
    if (patch.self && guess) setEditSelf(false);
    if (complete) {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => go(pos), 260);
    }
  }

  function skip() {
    if (!q) return;
    if (skips >= MAX_SKIPS && !a.skip) return store.toast(`Пропустить можно не больше ${MAX_SKIPS} вопросов`);
    haptic.select();
    const next = { ...answers, [q.id]: { skip: true } };
    setAnswers(next);
    const pos = nextOpen(next, i);
    save(next, pos);
    go(pos);
  }

  async function finish() {
    setSending(true);
    try {
      await saving.current;
      const r = await api<{ closed: boolean }>(`/tests/${test.id}/finish`, { body: { round: round.n, answers } });
      haptic.success();
      store.toast(r.closed ? "Готово! Результаты открылись" : "Ответы отправлены");
      await onDone();
    } catch (e) {
      store.toast((e as Error).message);
      setSending(false);
    }
  }

  const missing = qs.findIndex((x) => !done(answers[x.id]));

  return (
    <>
      <Head back caption={`раунд ${round.n}`} title={`${test.emoji} ${test.title}`} />
      {/* Точки прогресса вместо «21 из 40»: видно, что отвечено и что пропущено */}
      <div className="row" role="list" aria-label="Прогресс" style={{ gap: 6, flexWrap: "wrap", margin: "-4px 0 14px" }}>
        {qs.map((x, k) => {
          const st = answers[x.id];
          return (
            <span
              key={x.id}
              role="listitem"
              aria-label={`Вопрос ${k + 1}${st?.skip ? ", пропущен" : done(st) ? ", отвечен" : ""}`}
              className="test-dot"
              style={{
                width: k === i ? 18 : 8,
                background: st?.skip ? "var(--line)" : done(st) ? "var(--me)" : "var(--card-3)",
                outline: k === i ? "2px solid var(--me)" : "none",
              }}
            />
          );
        })}
      </div>

      {/* «Назад» и «Пропустить» — над вопросом (11.10.2026): на шаге догадки внизу они уходили
          за край низкого экрана (Android 448×646), и пропустить неловкий вопрос было нельзя */}
      {q && (
        <div className="row between" style={{ gap: 8, margin: "-6px 0 10px" }} data-testid="test-nav">
          <button className="btn soft sm inline" style={{ minHeight: 44 }} disabled={i === 0} onClick={() => go(i - 1)}>
            <ChevronLeft size={16} /> Назад
          </button>
          <button className="btn soft sm inline" style={{ minHeight: 44 }} disabled={skips >= MAX_SKIPS && !a.skip} onClick={skip}>
            {a.skip ? "Пропущен" : `Пропустить${skips ? ` (ещё ${MAX_SKIPS - skips})` : ""}`}
          </button>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.18 }}>
          {q ? (
            <>
              <div className="title-lg" style={{ marginBottom: 12, lineHeight: 1.28 }}>{q.self}</div>
              {guess && a.self && !editSelf ? (
                <button
                  className="card row"
                  style={{ width: "100%", textAlign: "left", padding: "10px 14px", background: "color-mix(in srgb, var(--me) 14%, var(--card))" }}
                  onClick={() => setEditSelf(true)}
                >
                  <Check size={16} color="var(--me)" />
                  <div className="grow">
                    <div className="small muted">Твой ответ</div>
                    <div style={{ fontWeight: 650 }}>{q.options.find((o) => o.id === a.self)?.text}</div>
                  </div>
                  <span className="small muted">изменить</span>
                </button>
              ) : (
                <Options q={q} value={a.self} onPick={(v) => answer({ self: v })} label="Твой ответ" />
              )}
              {guess && a.self && !editSelf && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 16 }}>
                  <div className="caps" style={{ marginBottom: 8, color: "var(--they)" }}>{q.about}</div>
                  <Options q={q} value={a.guess} onPick={(v) => answer({ guess: v })} label={q.about} they />
                </motion.div>
              )}
            </>
          ) : (
            <div className="card center" style={{ padding: "24px 18px" }}>
              <div style={{ fontSize: 40 }}>✨</div>
              <div className="title-md" style={{ marginTop: 6 }}>{missing < 0 ? "Всё отвечено" : "Остались вопросы без ответа"}</div>
              <p className="small muted" style={{ margin: "6px 0 16px" }}>
                {missing < 0 ? "После отправки ответы не поменять. Партнёр увидит их, когда тоже закончит." : `Вопрос ${missing + 1}: ответь или пропусти его.`}
              </p>
              {missing < 0 ? (
                <button className="btn" disabled={sending} onClick={finish}>Отправить ответы</button>
              ) : (
                <button className="btn" onClick={() => go(missing)}>К вопросу {missing + 1}</button>
              )}
              <button className="btn soft" style={{ marginTop: 8 }} onClick={() => go(total - 1)}>
                <ChevronLeft size={16} /> Назад
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function Options({ q, value, onPick, label, they }: { q: Q; value?: string; onPick: (id: string) => void; label: string; they?: boolean }) {
  const color = they ? "var(--they)" : "var(--me)";
  return (
    <div role="radiogroup" aria-label={label}>
      {q.options.map((o, k) => {
        const on = value === o.id;
        const last = k === q.options.length - 1;
        return (
          <motion.button
            key={o.id}
            role="radio"
            aria-checked={on}
            whileTap={{ scale: 0.97 }}
            className="card"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "12px 14px",
              minHeight: 48,
              marginTop: k ? 8 : 0,
              fontWeight: last ? 500 : 600,
              color: last && !on ? "var(--muted)" : undefined,
              background: on ? `color-mix(in srgb, ${color} 18%, var(--card))` : undefined,
              borderColor: on ? color : undefined,
            }}
            onClick={() => onPick(o.id)}
          >
            {o.text}
          </motion.button>
        );
      })}
    </div>
  );
}

function Waiting({ test, round, onNudged }: { test: TestMeta; round: Round; onNudged: () => void }) {
  const { partner } = useMe();
  const name = partner && !partner.ghost ? partner.name : null;
  const [busy, setBusy] = useState(false);
  const nudge = async () => {
    setBusy(true);
    try {
      const r = await api<{ sent: string }>(`/tests/${test.id}/nudge`, { body: {} });
      store.toast(
        r.sent === "sent" || r.sent === "online"
          ? "Напоминание отправлено"
          : r.sent === "capped"
            ? "Сегодня бот уже писал про тесты, завтра можно снова"
            : "Уведомления о тестах выключены, напоминание не ушло",
      );
      onNudged();
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Head back caption={`раунд ${round.n}`} title={`${test.emoji} ${test.title}`} />
      <Empty art="hourglass" title={name ? `Ждём ответов ${genitive(name)}` : "Ждём партнёра"} text="Твои ответы отправлены. Общие результаты откроются, когда закончите оба, и бот пришлёт сообщение.">
        {round.canNudge && name ? (
          <button className="btn soft" disabled={busy} onClick={nudge}>Напомнить {dative(name)}</button>
        ) : name ? (
          <p className="small muted">Напомнить можно раз в сутки. Через 48 часов бот сам напомнит один раз.</p>
        ) : null}
      </Empty>
      <Section title="Твои ответы" />
      <div className="stack">
        {round.questions.map((q) => {
          const a = round.mine.answers[q.id];
          const t = (v?: string) => q.options.find((o) => o.id === v)?.text;
          return (
            <div key={q.id} className="card" style={{ padding: 14 }}>
              <div className="small muted">{q.self}</div>
              <div style={{ fontWeight: 650, marginTop: 4 }}>{a?.skip ? "пропуск" : t(a?.self)}</div>
              {a?.guess && <div className="small" style={{ color: "var(--they)", marginTop: 2 }}>догадка: {t(a.guess)}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ——— результат ———

const ACT_LABEL: Record<Act["type"], (a: Act) => string> = {
  task: (a) => `В дела: ${a.title}${a.list ? ` · список «${a.list}»` : ""}${a.days ? ` · срок ${a.days} ${plural(a.days, "день", "дня", "дней")}` : ""}`,
  event: (a) => `В календарь: ${a.title}`,
  wish: (a) => `В хотелки: ${a.title}`,
  goal: (a) => `Общая цель: ${a.title}`,
  plan: (a) => `Копилка: ${a.title}`,
  capsule: (a) => `Письмо в будущее через год: ${a.title}`,
  note: (a) => `В заметку «${a.title}»`,
  cheat: () => "Запомнить в шпаргалке",
};

const ACT_DONE: Record<Act["type"], string> = {
  task: "В делах", event: "В календаре", wish: "В хотелках", goal: "В целях", plan: "В копилках", capsule: "Письмо запечатано", note: "В заметке", cheat: "В шпаргалке",
};

function openRef(ref: string) {
  const [kind, id] = ref.split(":");
  if (kind === "task") nav.push("tasks");
  else if (kind === "event") nav.tab("calendar");
  else if (kind === "wish" || kind === "plan") nav.tab("wishes");
  else if (kind === "goal") nav.push("goals");
  else if (kind === "capsule") nav.push("capsules");
  else if (kind === "note") nav.push("note", { id: Number(id) });
  else if (kind === "cheat") nav.push("cheatsheet");
}

function Result({ test, round, next }: { test: TestMeta; round: Round; next?: ReactNode }) {
  const { partner } = useMe();
  const name = partner && !partner.ghost ? partner.name : "Партнёр";
  const s = round.summary!;
  const qById = useMemo(() => new Map(round.questions.map((q) => [q.id, q])), [round]);
  const either = test.kind === "either";
  const byWeight = (outcome: Outcome) =>
    s.items.filter((x) => x.outcome === outcome).sort((a, b) => (qById.get(b.id)?.weight ?? 1) - (qById.get(a.id)?.weight ?? 1));
  const surprises = byWeight("surprise");
  const known = byWeight("known");
  const diffs = byWeight("diff");
  const own = byWeight("own");
  const same = s.items.filter((x) => x.outcome === "same");
  const [allDiffs, setAllDiffs] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const talkItems = either ? diffs : [...surprises, ...known, ...own];
  const text = (q: Q | undefined, v?: string) => q?.options.find((o) => o.id === v)?.text ?? "—";
  const card = (x: Summary["items"][number]) => <DiffCard key={x.id} test={test} round={round} item={x} q={qById.get(x.id)!} name={name} />;
  const plates = [
    { key: "same", n: s.counts.same, label: "одинаково", color: "var(--green)" },
    ...(either
      ? [{ key: "diff", n: s.counts.diff, label: "разошлись", color: "var(--they)" }]
      : [
          { key: "known", n: s.counts.known, label: "разные, и вы это знали", color: "var(--me)" },
          { key: "surprise", n: s.counts.surprise, label: "удивили друг друга", color: "var(--they)" },
        ]),
  ];

  return (
    <>
      {/* Три числа без общего процента. Ноль «одинаково» первым читался как провал (11.10.2026):
          плитки с нулём — в конце, а под ними — нормальная фраза */}
      <div className={either ? "grid-2" : "grid-3"} style={{ gap: 8 }}>
        {plates.filter((p) => p.n > 0).concat(plates.filter((p) => p.n === 0)).map((p) => (
          <Plate key={p.key} n={p.n} label={p.label} color={p.color} />
        ))}
      </div>
      {s.counts.same === 0 && (
        <p className="small muted center" style={{ margin: "10px 4px 0", lineHeight: 1.45 }}>
          Одинаковых ответов в этом раунде нет — зато есть о чём поговорить.
        </p>
      )}
      {test.score && s.hits.total > 0 && (
        <p className="center" style={{ margin: "12px 4px 0", lineHeight: 1.45 }}>
          Ты угадываешь, что выберет {name}, в <b>{s.hits.me} из {s.hits.total}</b>. {name} угадывает тебя в <b>{s.hits.them} из {s.hits.total}</b>.
        </p>
      )}
      {next && <div className="center">{next}</div>}

      {test.id === "priyatno" && round.partner && <Pleasant round={round} name={name} />}
      {either && round.profile && <DateProfile test={test} round={round} name={name} />}

      {talkItems.length > 0 && (
        <button className="btn tint" style={{ marginTop: 16 }} onClick={() => setTalkOpen(true)}>
          <MessageCircle size={18} /> Поговорить сейчас
        </button>
      )}

      {!either && surprises.length > 0 && (
        <>
          <Section title="Сюрпризы: новое друг о друге" />
          <div className="stack">{surprises.map(card)}</div>
        </>
      )}
      {known.length > 0 && (
        <>
          <Section title="Разные, и вы это знали" />
          <div className="stack">{known.map(card)}</div>
        </>
      )}
      {either && diffs.length > 0 && (
        <>
          <Section title="Где вы разошлись" />
          <div className="stack">
            {(allDiffs ? diffs : diffs.slice(0, 3)).map(card)}
            {diffs.length > 3 && !allDiffs && <button className="btn soft" onClick={() => setAllDiffs(true)}>Показать все: {diffs.length}</button>}
          </div>
        </>
      )}
      {own.length > 0 && (
        <>
          <Section title="Ни один вариант не подошёл" />
          <div className="stack">{own.map(card)}</div>
        </>
      )}

      {same.length > 0 && (
        <>
          <Section title="У вас одинаково" />
          {/* Вопрос мелко над ответом: без него «Чистое бельё» или «Каждый за себя» непонятно к чему */}
          <div className="card" style={{ padding: "2px 14px" }} data-testid="same-list">
            {same.map((x, k) => {
              const q = qById.get(x.id);
              const pick = x.mine.self === "any" ? x.theirs.self : x.mine.self;
              return (
                <div key={x.id} style={{ padding: "9px 0", borderTop: k ? "1px solid var(--line)" : "none" }}>
                  <div className="small muted" style={{ lineHeight: 1.3 }}>{q?.self}</div>
                  <div style={{ fontWeight: 600, lineHeight: 1.3, marginTop: 2 }}>{pick === "any" ? "Обоим всё равно" : text(q, pick)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {test.cheat && (
        <button className="link" style={{ marginTop: 14 }} onClick={() => nav.push("cheatsheet")}>
          📝 Шпаргалка: всё, что не получилось угадать
        </button>
      )}

      <TalkMode open={talkOpen} onClose={() => setTalkOpen(false)} test={test} round={round} items={talkItems} name={name} />
    </>
  );
}

function Plate({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="card center" style={{ margin: 0, padding: "14px 6px", background: `color-mix(in srgb, ${color} 12%, var(--card))` }}>
      <div className="num" style={{ fontSize: 30, lineHeight: 1, color }}>{n}</div>
      <div className="small muted" style={{ marginTop: 6, lineHeight: 1.2 }}>{label}</div>
    </div>
  );
}

function DiffCard({ test, round, item, q, name }: { test: TestMeta; round: Round; item: Summary["items"][number]; q: Q; name: string }) {
  const guess = test.kind === "guess";
  const text = (v?: string) => q.options.find((o) => o.id === v)?.text ?? "—";
  const talked = round.marks.talked.includes(q.id);
  const myHit = item.mine.guess === item.theirs.self;
  const theirHit = item.theirs.guess === item.mine.self;
  return (
    <div className="card" style={{ padding: 16 }} data-testid="diff-card">
      <div style={{ fontWeight: 650, lineHeight: 1.3 }}>{q.self}</div>
      {/* Кто кого угадал — словами (11.10.2026): «✓ угадано» напротив обеих строк путало */}
      <AnswerRow who="Ты" answer={text(item.mine.self)} color="var(--me)" note={guess ? (theirHit ? `✓ ${name} это знает` : `${name} не угадывает: новое`) : null} />
      <AnswerRow who={name} answer={text(item.theirs.self)} color="var(--they)" note={guess ? (myHit ? "✓ ты это знаешь" : "ты не угадываешь: новое") : null} />
      <div style={{ marginTop: 12 }}>
        {q.talk.map((t, k) => (
          <div key={k} className="row" style={{ alignItems: "flex-start", gap: 8, marginTop: k ? 6 : 0 }}>
            <MessageCircle size={15} className="faint" style={{ flexShrink: 0, marginTop: 3 }} />
            <span className="small" style={{ lineHeight: 1.4 }}>{t}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <TalkedButton test={test} round={round} qid={q.id} on={talked} />
      </div>
      {q.act && <ActButton test={test} round={round} qid={q.id} act={q.act} />}
    </div>
  );
}

function AnswerRow({ who, answer, color, note }: { who: string; answer: string; color: string; note: string | null }) {
  return (
    <div className="row" style={{ gap: 10, marginTop: 10, alignItems: "flex-start" }}>
      <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: color, flexShrink: 0 }} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small muted">{who}</div>
        <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{answer}</div>
      </div>
      {note && <span className="small" style={{ color: note.startsWith("✓") ? "var(--green)" : "var(--muted)", whiteSpace: "nowrap", marginTop: 2 }}>{note}</span>}
    </div>
  );
}

function TalkedButton({ test, round, qid, on }: { test: TestMeta; round: Round; qid: string; on: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`btn sm inline ${on ? "tint" : "soft"}`}
      style={{ minHeight: 44, ["--c" as string]: "var(--green)" }}
      aria-pressed={on}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        haptic.select();
        try {
          await api(`/tests/${test.id}/talked`, { body: { round: round.n, q: qid, on: !on } });
          refreshTests();
        } catch (e) {
          store.toast((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {on ? <><Check size={15} /> Обсудили</> : "Обсудили?"}
    </button>
  );
}

function ActButton({ test, round, qid, act }: { test: TestMeta; round: Round; qid: string; act: Act }) {
  const ref = round.marks.acts[qid];
  const [busy, setBusy] = useState(false);
  const style = { marginTop: 8, justifyContent: "flex-start", height: "auto", minHeight: 48, padding: "10px 14px", textAlign: "left", lineHeight: 1.3 } as const;
  if (ref)
    return (
      <button className="btn soft" style={style} onClick={() => openRef(ref)}>
        <Check size={16} color="var(--green)" /> {ACT_DONE[act.type]} · открыть
      </button>
    );
  return (
    <button
      className="btn soft"
      style={style}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/tests/${test.id}/act`, { body: { round: round.n, q: qid } });
          haptic.success();
          store.toast(`Готово: ${ACT_DONE[act.type].toLowerCase()}`);
          refreshTests();
        } catch (e) {
          store.toast((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      ＋ {ACT_LABEL[act.type](act)}
    </button>
  );
}

/** «Что мне приятно»: три выбора партнёра дословно и чаще всего выбираемый язык — одной строкой. */
function Pleasant({ round, name }: { round: Round; name: string }) {
  const theirs = round.partner!;
  const picks = round.questions
    .map((q) => ({ q, o: q.options.find((o) => o.id === theirs[q.id]?.self && o.id !== "none") }))
    .filter((x) => x.o)
    .slice(0, 3);
  const top = (a: Answers) => {
    const tally = new Map<string, number>();
    for (const q of round.questions) {
      const tag = q.options.find((o) => o.id === a[q.id]?.self)?.tag;
      if (tag) tally.set(tag, (tally.get(tag) ?? 0) + 1);
    }
    const best = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
    return best ? LANG[best[0]] : null;
  };
  const mine = top(round.mine.answers);
  const their = top(theirs);
  return (
    <>
      <Section title={`Что приятнее всего: ${name}`} />
      <div className="card" style={{ background: "color-mix(in srgb, var(--they) 10%, var(--card))" }}>
        {picks.map(({ q, o }, k) => (
          <div key={q.id} style={{ marginTop: k ? 10 : 0 }}>
            <div className="small muted">{q.self}</div>
            <div style={{ fontWeight: 650 }}>{o!.text}</div>
          </div>
        ))}
        {(mine || their) && (
          <p className="small muted" style={{ margin: "12px 0 0", lineHeight: 1.45 }}>
            {their && `${name} чаще выбирает: ${their}. `}
            {mine && `Тебе чаще приятно: ${mine}.`}
          </p>
        )}
      </div>
    </>
  );
}

/** «Идеальное свидание»: профиль из совпадений и три идеи с кнопкой «Запланировать». */
function DateProfile({ test, round, name }: { test: TestMeta; round: Round; name: string }) {
  const p = round.profile!;
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <Section title="Ваше свидание" />
      <div className="card" style={{ padding: "6px 16px" }}>
        {p.axes.map((a, k) => (
          <div key={a.axis} className="row between" style={{ padding: "9px 0", borderTop: k ? "1px solid var(--line)" : "none", gap: 10 }}>
            <span className="small muted">{a.title}</span>
            <span style={{ fontWeight: 650, textAlign: "right", color: a.split ? "var(--they)" : undefined }}>{a.label}</span>
          </div>
        ))}
      </div>
      <Section title="Куда сходить" />
      <div className="stack">
        {p.ideas.map((i) => {
          const ref = round.marks.acts[`idea:${i.id}`];
          return (
            <div key={i.id} className="card" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 28, lineHeight: 1.1 }}>{i.emoji}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title-md">{i.title}</div>
                  <div className="small muted" style={{ marginTop: 2 }}>{i.price}</div>
                  <div className="small" style={{ marginTop: 6, lineHeight: 1.4 }}>{i.why}</div>
                </div>
              </div>
              {ref ? (
                <button className="btn soft" style={{ marginTop: 12 }} onClick={() => openRef(ref)}>
                  <Check size={16} color="var(--green)" /> В календаре · открыть
                </button>
              ) : (
                <button
                  className="btn tint"
                  style={{ marginTop: 12 }}
                  disabled={busy === i.id}
                  onClick={async () => {
                    setBusy(i.id);
                    try {
                      await api(`/tests/${test.id}/act`, { body: { round: round.n, idea: i.id } });
                      haptic.success();
                      store.toast(`Свидание на субботу в календаре, ${name} получит приглашение`);
                      refreshTests();
                      void queryClient.invalidateQueries({ queryKey: ["events"] });
                    } catch (e) {
                      store.toast((e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Запланировать на субботу
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** «Поговорить сейчас»: расхождения по одному, вопросы крупно — обсуждать вживую или по видео. */
function TalkMode({ open, onClose, test, round, items, name }: { open: boolean; onClose: () => void; test: TestMeta; round: Round; items: Summary["items"]; name: string }) {
  const [k, setK] = useState(0);
  const at = Math.max(0, Math.min(k, items.length - 1));
  const item = items[at];
  const q = item ? round.questions.find((x) => x.id === item.id) : undefined;
  const text = (v?: string) => q?.options.find((o) => o.id === v)?.text ?? "—";
  return (
    <Sheet open={open} onClose={onClose} title={`Поговорить сейчас · ${at + 1} из ${items.length}`}>
      {q && item && (
        <>
          <div className="title-lg" style={{ lineHeight: 1.28 }}>{q.self}</div>
          <AnswerRow who="Ты" answer={text(item.mine.self)} color="var(--me)" note={null} />
          <AnswerRow who={name} answer={text(item.theirs.self)} color="var(--they)" note={null} />
          <div style={{ marginTop: 16 }}>
            {q.talk.map((t, n) => (
              <p key={n} style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.35, margin: "0 0 12px" }}>💬 {t}</p>
            ))}
          </div>
          <TalkedButton test={test} round={round} qid={q.id} on={round.marks.talked.includes(q.id)} />
          <div className="row between" style={{ marginTop: 16, gap: 8 }}>
            <button className="btn soft sm inline" style={{ minHeight: 44 }} disabled={at === 0} onClick={() => setK(at - 1)}>
              <ChevronLeft size={16} /> Назад
            </button>
            {at < items.length - 1 ? (
              <button className="btn sm inline" style={{ minHeight: 44 }} onClick={() => setK(at + 1)}>
                Дальше <ChevronRight size={16} />
              </button>
            ) : (
              <button className="btn sm inline" style={{ minHeight: 44 }} onClick={onClose}>Готово</button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

// ——— шпаргалка ———

interface CheatEntry {
  testId: string;
  test: string;
  emoji: string;
  questionId: string;
  question: string;
  answer: string;
  date: string;
}

export function CheatSheetScreen() {
  const { data } = useApi<{ name: string | null; entries: CheatEntry[]; hidden?: number }>(["tests", "cheatsheet"], "/cheatsheet");
  return (
    <>
      <Head back caption={data?.name ? `про партнёра: ${data.name}` : "про партнёра"} title="Шпаргалка" />
      {!data ? (
        <Spinner />
      ) : !data.entries.length ? (
        <Empty emoji="📝" title="Пока пусто" text="Сюда попадают ответы партнёра, которые не получилось угадать в «Угадай меня» и «Что мне приятно». Это не ошибки, а то, что стоит запомнить.">
          <button className="btn soft" onClick={() => nav.push("tests")}>К тестам</button>
        </Empty>
      ) : (
        <>
          <p className="muted" style={{ margin: "-6px 2px 14px", lineHeight: 1.45 }}>
            Что выбирает {data.name ?? "партнёр"} и что не получилось угадать. Полезно перед подарком, свиданием и трудным днём.
          </p>
          <div className="stack">
            {data.entries.map((e) => (
              <div key={`${e.testId}:${e.questionId}`} className="card" style={{ padding: 14 }} data-testid="cheat-entry">
                <div className="small muted">{e.emoji} {e.test} · {dayMonth(e.date)}</div>
                <div className="small" style={{ marginTop: 4 }}>{e.question}</div>
                <div style={{ fontWeight: 650, marginTop: 2 }}>{e.answer}</div>
              </div>
            ))}
            {!!data.hidden && <CheatBlur n={data.hidden} />}
          </div>
        </>
      )}
    </>
  );
}


function CheatBlur({ n }: { n: number }) {
  // Свой замок, не общая шторка: показ пишем сами (воронка «Вдвоём+», api.ts → track)
  useEffect(() => track("lock_view", { feature: "cheat" }), []);
  return (
    <div style={{ position: "relative" }} data-testid="cheat-blur">
      {/* Серые полосы, а не выдуманные строки (11.10.2026): текст под размытием принимали за ответы партнёра */}
      <div aria-hidden className="stack" style={{ filter: "blur(4px)", pointerEvents: "none", userSelect: "none", opacity: 0.75 }}>
        {[78, 56, 70, 48, 64].slice(0, Math.min(n, 5)).map((w, k) => (
          <div key={k} className="card" style={{ padding: 14 }}>
            <div style={{ height: 8, width: "30%", borderRadius: 6, background: "color-mix(in srgb, var(--text) 12%, transparent)" }} />
            <div style={{ height: 10, width: `${w}%`, borderRadius: 6, marginTop: 8, background: "color-mix(in srgb, var(--text) 18%, transparent)" }} />
            <div style={{ height: 10, width: `${Math.max(30, w - 20)}%`, borderRadius: 6, marginTop: 6, background: "color-mix(in srgb, var(--text) 24%, transparent)" }} />
          </div>
        ))}
      </div>
      <div className="center" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16 }}>
        <div style={{ fontWeight: 700 }}>
          Ещё {n} {plural(n, "строка", "строки", "строк")}
        </div>
        <button className="btn inline" onClick={() => { haptic.medium(); nav.push("plus", { via: "lock", from: "cheat" }); }}>
          <Lock size={16} /> Открыть во Вдвоём+
        </button>
      </div>
    </div>
  );
}
