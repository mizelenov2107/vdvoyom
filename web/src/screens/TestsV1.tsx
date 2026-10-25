// Старые тесты на совместимость (до 08.10.2026): семь тестов, ответы в test_answers.
// Их видят все пары, кроме беты новых тестов (server/src/beta.ts) — у той Tests.tsx.
// Код — экран Tests.tsx на 08.10.2026 до переделки (Tests.tsx.bak-2026-10-08-testy).
import { AnimatePresence, motion } from "motion/react";
import { Check, Clock, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { api, queryClient, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { accusative, genitive, plural } from "../fmt.ts";
import { haptic } from "../tg.ts";
import { nav, store } from "../store.ts";
import { Avatar, Empty, Head, Progress, Section, Spinner } from "../ui/kit.tsx";
import type { Person } from "../types.ts";

interface TestMeta {
  id: string;
  kind: string;
  title: string;
  emoji: string;
  description: string;
  minutes: number;
  count: number;
  /** Во «Вдвоём+»: без подписки открыть нельзя */
  locked?: boolean;
  mine: boolean;
  partner: boolean;
}

interface Lang {
  key: string;
  title: string;
  description: string;
  tips: string[];
}

interface Test {
  id: string;
  kind: "love_languages" | "this_or_that" | "know_me" | "scale";
  title: string;
  emoji: string;
  description: string;
  languages?: Lang[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  questions: any[];
}

type Answers = Record<string, unknown>;

export function TestsScreen() {
  const { partner } = useMe();
  const { data } = useApi<{ tests: TestMeta[] }>(["tests"], "/tests");
  return (
    <>
      <Head back caption="проходите каждый у себя" title="Тесты" />
      <p className="muted" style={{ margin: "-6px 2px 16px" }}>
        Результат открывается, когда тест прошли оба. Подсмотреть ответы половинки заранее нельзя.
      </p>
      {!data ? (
        <Spinner />
      ) : (
        <div className="stack">
          {data.tests.map((t) => (
            <motion.button
              key={t.id}
              whileTap={{ scale: 0.98 }}
              className="card row"
              style={{ width: "100%", textAlign: "left" }}
              // Закрытый тест во «Вдвоём+»: вместо теста — шторка с ценой (как наборы у «Между строк»)
              onClick={() => (t.locked ? store.paywall({ feature: "tests", text: "Бесплатно открыты «Языки любви» и «Это или то»" }) : nav.push("test", { id: t.id }))}
            >
              <div style={{ fontSize: 34, opacity: t.locked ? 0.55 : 1 }}>{t.emoji}</div>
              <div className="grow">
                <div className="title-md row" style={{ gap: 6 }}>{t.title}{t.locked && <Lock size={15} className="muted" />}</div>
                <div className="small muted" style={{ margin: "2px 0 8px" }}>{t.description}</div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {t.locked ? (
                    <span className="chip solid" style={{ ["--c" as string]: "var(--accent, var(--rose))" }}>во «Вдвоём+»</span>
                  ) : t.mine && t.partner ? (
                    <span className="chip solid" style={{ ["--c" as string]: "var(--green)" }}>результат готов</span>
                  ) : t.mine ? (
                    <span className="chip">ждём {partner ? genitive(partner.name) : "половинку"}</span>
                  ) : t.partner ? (
                    <span className="chip solid" style={{ ["--c" as string]: "var(--they)" }}>ответы {genitive(partner?.name ?? "")} готовы</span>
                  ) : (
                    <span className="chip"><Clock size={11} /> {t.minutes} мин · {t.count} {plural(t.count, "вопрос", "вопроса", "вопросов")}</span>
                  )}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </>
  );
}

export function TestScreen({ id }: { id: string }) {
  const { data, refetch } = useApi<{ test: Test; mine: Answers | null; partnerDone: boolean; partner: Answers | null }>(["test", id], `/tests/${id}`);
  const [redo, setRedo] = useState(false);
  if (!data) return <Spinner />;
  const { test } = data;
  if (!data.mine || redo)
    return (
      <Runner
        test={test}
        onDone={async (answers) => {
          await api(`/tests/${id}`, { body: { answers } });
          haptic.success();
          setRedo(false);
          void queryClient.invalidateQueries({ queryKey: ["tests"] });
          await refetch();
        }}
      />
    );
  return (
    <>
      <Head back caption="результат" title={`${test.emoji} ${test.title}`} />
      {!data.partner ? (
        <Waiting test={test} mine={data.mine} />
      ) : (
        <Result test={test} mine={data.mine} partner={data.partner} />
      )}
      <button className="btn soft" style={{ marginTop: 18 }} onClick={() => setRedo(true)}>
        Пройти заново
      </button>
    </>
  );
}

// ——— прохождение ———

function Runner({ test, onDone }: { test: Test; onDone: (a: Answers) => Promise<void> }) {
  const { partner } = useMe();
  const qs = test.questions;
  const knowMe = test.kind === "know_me";
  // У «Насколько ты меня знаешь» два круга: про себя, потом угадать половинку
  const total = knowMe ? qs.length * 2 : qs.length;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answers>(knowMe ? { self: {}, guess: {} } : {});
  const [busy, setBusy] = useState(false);

  const round = knowMe && i >= qs.length ? "guess" : "self";
  const q = qs[knowMe ? i % qs.length : i];

  async function pick(value: unknown) {
    haptic.select();
    let next: Answers;
    if (knowMe) next = { ...answers, [round]: { ...(answers[round] as Answers), [q.id]: value } };
    else next = { ...answers, [q.id]: value };
    setAnswers(next);
    if (i + 1 < total) setI(i + 1);
    else {
      setBusy(true);
      try {
        await onDone(next);
      } catch (e) {
        store.toast((e as Error).message);
        setBusy(false);
      }
    }
  }

  return (
    <>
      <Head back caption={`${i + 1} из ${total}`} title={`${test.emoji} ${test.title}`} />
      <Progress parts={[{ value: ((i + 1) / total) * 100, color: "var(--me)" }]} />
      {knowMe && i === qs.length && (
        <div className="card" style={{ marginTop: 14, background: "color-mix(in srgb, var(--they) 16%, var(--card))" }}>
          Теперь угадай, что ответит {partner?.name ?? "половинка"} 👀
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.2 }}
          style={{ marginTop: 22 }}
        >
          {(test.kind === "love_languages" || test.kind === "this_or_that") && (
            <>
              <div className="caps" style={{ marginBottom: 12 }}>{test.kind === "love_languages" ? "что тебе приятнее" : "выбирай быстро"}</div>
              <div className="stack">
                {(["a", "b"] as const).map((k) => (
                  <motion.button
                    key={k}
                    whileTap={{ scale: 0.97 }}
                    disabled={busy}
                    className="card"
                    style={{ width: "100%", textAlign: "left", fontSize: test.kind === "this_or_that" ? 22 : 17, fontWeight: 600, minHeight: test.kind === "this_or_that" ? 110 : 96, lineHeight: 1.35 }}
                    onClick={() => pick(k)}
                  >
                    {typeof q[k] === "string" ? q[k] : q[k].text}
                  </motion.button>
                ))}
              </div>
            </>
          )}
          {knowMe && (
            <>
              <div className="title-lg" style={{ marginBottom: 16 }}>
                {round === "guess" ? `${partner?.name ?? "Половинка"}: ${q.text.charAt(0).toLowerCase()}${q.text.slice(1)}` : q.text}
              </div>
              <div className="stack">
                {q.options.map((o: string, idx: number) => (
                  <motion.button key={idx} whileTap={{ scale: 0.97 }} disabled={busy} className="card" style={{ width: "100%", textAlign: "left", fontWeight: 600 }} onClick={() => pick(idx)}>
                    {o}
                  </motion.button>
                ))}
              </div>
            </>
          )}
          {test.kind === "scale" && (
            <>
              <div className="title-lg" style={{ marginBottom: 20, lineHeight: 1.3 }}>{q.text}</div>
              <div className="grid-4" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <motion.button
                    key={v}
                    whileTap={{ scale: 0.9 }}
                    disabled={busy}
                    className="card center num"
                    style={{ margin: 0, padding: "18px 0", fontSize: 22, background: `color-mix(in srgb, var(--me) ${10 + v * 12}%, var(--card))` }}
                    onClick={() => pick(v)}
                  >
                    {v}
                  </motion.button>
                ))}
              </div>
              <div className="row between small muted" style={{ marginTop: 10 }}>
                <span>совсем нет</span>
                <span>точно да</span>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
      {busy && <Spinner />}
    </>
  );
}

function Waiting({ test, mine }: { test: Test; mine: Answers }) {
  const { partner } = useMe();
  return (
    <>
      <Empty art="hourglass" title={partner ? `Ждём ${genitive(partner.name)}` : "Ждём половинку"} text="Как только тест пройдёт и вторая сторона, здесь появится общий результат. Бот пришлёт уведомление." />
      {test.kind === "love_languages" && <LoveProfile test={test} answers={mine} title="Твой профиль уже готов" />}
    </>
  );
}

// ——— результаты ———

function Result({ test, mine, partner }: { test: Test; mine: Answers; partner: Answers }) {
  if (test.kind === "love_languages") return <LoveResult test={test} mine={mine} partner={partner} />;
  if (test.kind === "this_or_that") return <ThisOrThat test={test} mine={mine} partner={partner} />;
  if (test.kind === "know_me") return <KnowMe test={test} mine={mine} partner={partner} />;
  return <ScaleResult test={test} mine={mine} partner={partner} />;
}

function loveScores(test: Test, a: Answers): Record<string, number> {
  const s: Record<string, number> = {};
  for (const l of test.languages ?? []) s[l.key] = 0;
  for (const q of test.questions) {
    const pick = a[q.id] as "a" | "b" | undefined;
    if (pick) s[q[pick].lang] = (s[q[pick].lang] ?? 0) + 1;
  }
  const total = Object.values(s).reduce((x, y) => x + y, 0) || 1;
  for (const k in s) s[k] = Math.round((s[k] / total) * 100);
  return s;
}

function LoveProfile({ test, answers, title }: { test: Test; answers: Answers; title: string }) {
  const s = loveScores(test, answers);
  const langs = [...(test.languages ?? [])].sort((a, b) => s[b.key] - s[a.key]);
  return (
    <>
      <Section title={title} />
      <div className="card">
        {langs.map((l) => (
          <div key={l.key} style={{ marginBottom: 12 }}>
            <div className="row between small" style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{l.title}</span>
              <span className="num">{s[l.key]}%</span>
            </div>
            <Progress parts={[{ value: s[l.key] * 2, color: "var(--me)" }]} />
          </div>
        ))}
      </div>
    </>
  );
}

function LoveResult({ test, mine, partner }: { test: Test; mine: Answers; partner: Answers }) {
  const { me, partner: p, meColor, theyColor } = useMe();
  const a = loveScores(test, mine);
  const b = loveScores(test, partner);
  const langs = test.languages ?? [];
  const top = (s: Record<string, number>) => langs.reduce((x, y) => (s[y.key] > s[x.key] ? y : x), langs[0]);
  const myTop = top(a);
  const theirTop = top(b);
  return (
    <>
      <div className="grid-2">
        <TopCard person={me} lang={myTop} color={meColor} />
        <TopCard person={p} lang={theirTop} color={theyColor} />
      </div>
      <Section title="Все языки" />
      <div className="card">
        {langs.map((l) => (
          <div key={l.key} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{l.title}</div>
            <div className="row" style={{ gap: 8 }}>
              <div className="grow"><Progress parts={[{ value: a[l.key] * 2, color: meColor }]} /></div>
              <span className="num small" style={{ width: 40, textAlign: "right" }}>{a[l.key]}%</span>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 5 }}>
              <div className="grow"><Progress parts={[{ value: b[l.key] * 2, color: theyColor }]} /></div>
              <span className="num small" style={{ width: 40, textAlign: "right" }}>{b[l.key]}%</span>
            </div>
          </div>
        ))}
      </div>
      <Section title={`Как радовать ${p ? genitive(p.name) : "половинку"}`} />
      <div className="card">
        <div className="title-md" style={{ marginBottom: 6 }}>{theirTop.title}</div>
        <p className="small muted" style={{ marginTop: 0 }}>{theirTop.description}</p>
        {theirTop.tips.map((t, i) => (
          <div key={i} className="row" style={{ alignItems: "flex-start", gap: 10, marginTop: 8 }}>
            <Check size={18} color={theyColor} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{t}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function TopCard({ person, lang, color }: { person: Person | null; lang: Lang; color: string }) {
  return (
    <div className="card" style={{ margin: 0, background: `color-mix(in srgb, ${color} 16%, var(--card))` }}>
      <Avatar p={person} size={34} />
      <div className="caps" style={{ marginTop: 10 }}>{person?.name}</div>
      <div className="title-md" style={{ marginTop: 4 }}>{lang.title}</div>
    </div>
  );
}

function Pct({ value, label }: { value: number; label: string }) {
  return (
    <div className="card center" style={{ padding: "26px 18px" }}>
      <motion.div className="num" style={{ fontSize: 64, lineHeight: 1 }} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 14 }}>
        {value}%
      </motion.div>
      <div className="muted" style={{ marginTop: 8 }}>{label}</div>
    </div>
  );
}

function ThisOrThat({ test, mine, partner }: { test: Test; mine: Answers; partner: Answers }) {
  const { partner: p, meColor, theyColor } = useMe();
  const same = test.questions.filter((q) => mine[q.id] === partner[q.id]).length;
  const pct = Math.round((same / test.questions.length) * 100);
  const diffs = test.questions.filter((q) => mine[q.id] !== partner[q.id]);
  return (
    <>
      <Pct value={pct} label={`совпали в ${same} из ${test.questions.length}`} />
      {diffs.length > 0 && <Section title="Где вы разные" />}
      <div className="stack">
        {diffs.map((q) => (
          <div key={q.id} className="card row between" style={{ padding: 14 }}>
            <span style={{ color: meColor, fontWeight: 650 }}>{q[mine[q.id] as string]}</span>
            <span className="faint small">vs</span>
            <span style={{ color: theyColor, fontWeight: 650, textAlign: "right" }}>{q[partner[q.id] as string]}</span>
          </div>
        ))}
      </div>
      {p && <p className="small muted center">Слева твои ответы, справа ответы {genitive(p.name)}</p>}
    </>
  );
}

function KnowMe({ test, mine, partner }: { test: Test; mine: Answers; partner: Answers }) {
  const { partner: p, meColor, theyColor } = useMe();
  const mySelf = mine.self as Record<string, number>;
  const myGuess = mine.guess as Record<string, number>;
  const theirSelf = partner.self as Record<string, number>;
  const theirGuess = partner.guess as Record<string, number>;
  const myScore = test.questions.filter((q) => myGuess?.[q.id] === theirSelf?.[q.id]).length;
  const theirScore = test.questions.filter((q) => theirGuess?.[q.id] === mySelf?.[q.id]).length;
  const n = test.questions.length;
  return (
    <>
      <div className="grid-2">
        <div className="card center" style={{ margin: 0 }}>
          <div className="num" style={{ fontSize: 44, color: meColor }}>{myScore}/{n}</div>
          <div className="small muted">ты знаешь {p ? accusative(p.name) : "половинку"}</div>
        </div>
        <div className="card center" style={{ margin: 0 }}>
          <div className="num" style={{ fontSize: 44, color: theyColor }}>{theirScore}/{n}</div>
          <div className="small muted">{p?.name} знает тебя</div>
        </div>
      </div>
      <Section title="Разбор" />
      <div className="stack">
        {test.questions.map((q) => {
          const hit = myGuess?.[q.id] === theirSelf?.[q.id];
          return (
            <div key={q.id} className="card" style={{ padding: 14 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>{q.text}</div>
              <div style={{ fontWeight: 650 }}>
                {p?.name}: {q.options[theirSelf?.[q.id]] ?? "—"}
              </div>
              <div className="small" style={{ color: hit ? "var(--green)" : "var(--red)", marginTop: 2 }}>
                {hit ? "✓ в точку" : `✗ твоя догадка: ${q.options[myGuess?.[q.id]] ?? "—"}`}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ScaleResult({ test, mine, partner }: { test: Test; mine: Answers; partner: Answers }) {
  const { meColor, theyColor, partner: p } = useMe();
  const rows = useMemo(
    () =>
      test.questions
        .map((q) => ({ q, a: Number(mine[q.id] ?? 3), b: Number(partner[q.id] ?? 3) }))
        .map((r) => ({ ...r, diff: Math.abs(r.a - r.b) })),
    [test, mine, partner],
  );
  const align = Math.round(100 - (rows.reduce((s, r) => s + r.diff, 0) / rows.length / 4) * 100);
  const gaps = [...rows].sort((x, y) => y.diff - x.diff).filter((r) => r.diff >= 2);
  return (
    <>
      <Pct value={align} label="насколько вы смотрите в одну сторону" />
      {gaps.length > 0 && (
        <>
          <Section title="Стоит обсудить" />
          <p className="small muted" style={{ margin: "-4px 2px 10px" }}>Здесь ваши ответы разошлись сильнее всего. Это не проблема, а хороший повод для разговора.</p>
        </>
      )}
      <div className="stack">
        {(gaps.length ? gaps : rows).map((r) => (
          <div key={r.q.id} className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>{r.q.text}</div>
            <ScaleBar value={r.a} color={meColor} label="ты" />
            <ScaleBar value={r.b} color={theyColor} label={p?.name ?? ""} />
          </div>
        ))}
      </div>
    </>
  );
}

function ScaleBar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="row" style={{ gap: 8, marginTop: 4 }}>
      <span className="mono-sm" style={{ width: 54 }}>{label}</span>
      <div className="grow" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <div key={v} style={{ height: 8, borderRadius: 4, background: v <= value ? color : "var(--card-3)" }} />
        ))}
      </div>
    </div>
  );
}
