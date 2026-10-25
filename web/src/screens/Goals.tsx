import { motion } from "motion/react";
import { Archive, Check, Minus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, useAct, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { dayMonth, human, plural } from "../fmt.ts";
import { confirm, haptic } from "../tg.ts";
import { store } from "../store.ts";
import { Empty, Field, Head, Pills, Section, Segmented, Sheet, Spinner } from "../ui/kit.tsx";
import { Ring } from "../ui/Ring.tsx";

interface Goal {
  id: number;
  author_id: number;
  kind: "count" | "checklist" | "habit";
  title: string;
  emoji: string | null;
  target: number;
  unit: string | null;
  due: string | null;
  auto: string | null;
  archived_at: string | null;
  progress: number;
  streak: number;
  done: boolean;
  byUser: Record<string, number>;
  steps: { id: number; text: string; done_by: number | null; done_at: string | null }[];
  marks: { id: number; user_id: number; amount: number; note: string | null; date: string }[];
}

const AUTO_LABEL: Record<string, string> = {
  ideas_done: "считается само: места из мэтчей, где вы были",
  movies_done: "считается само: фильмы из мэтчей, которые посмотрели",
  wishes_done: "считается само: исполненные хотелки",
  dates: "считается само: свидания в календаре",
};

/** Готовые цели: одно нажатие — и цель стоит. */
const PRESETS: { emoji: string; title: string; kind: Goal["kind"]; target?: number; unit?: string; auto?: string; steps?: string[] }[] = [
  { emoji: "📍", title: "20 новых мест в Москве", kind: "count", target: 20, unit: "мест", auto: "ideas_done" },
  { emoji: "🎬", title: "30 фильмов вместе", kind: "count", target: 30, unit: "фильмов", auto: "movies_done" },
  { emoji: "💞", title: "Свидание каждую неделю", kind: "count", target: 52, unit: "свиданий", auto: "dates" },
  { emoji: "📚", title: "12 книг за год", kind: "count", target: 12, unit: "книг" },
  { emoji: "🏃", title: "Спорт трижды в неделю", kind: "habit", target: 3 },
  { emoji: "✈️", title: "Первая поездка вдвоём", kind: "checklist", steps: ["Выбрать направление", "Накопить на билеты", "Купить билеты", "Забронировать жильё", "Собрать чемодан"] },
  { emoji: "🇬🇧", title: "Английский вместе", kind: "habit", target: 4 },
  { emoji: "🌅", title: "Встретить 5 рассветов", kind: "count", target: 5, unit: "рассветов" },
];

export function GoalsScreen() {
  const { data } = useApi<{ goals: Goal[] }>(["goals"], "/goals");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const list = (data?.goals ?? []).filter((g) => !g.archived_at);
  const archived = (data?.goals ?? []).filter((g) => g.archived_at);
  const current = data?.goals.find((g) => g.id === open) ?? null;

  return (
    <>
      <Head back caption="то, к чему идём вместе" title="Цели" actions={<button className="icon-btn" onClick={() => setAdding(true)} aria-label="Новая цель"><Plus size={20} /></button>} />
      {!data ? (
        <Spinner />
      ) : !list.length ? (
        <>
          <Empty art="goal" title="Общих целей пока нет" text="Поставьте цель на двоих: каждый отмечает свой вклад, прогресс виден обоим. Часть целей считается сама — из мэтчей и календаря." />
          <PresetGrid onPicked={() => undefined} />
        </>
      ) : (
        <div className="stack">
          {list.map((g) => <GoalCard key={g.id} g={g} onOpen={() => setOpen(g.id)} />)}
        </div>
      )}
      {archived.length > 0 && (
        <>
          <Section title="Достигнутые и в архиве" />
          <div className="stack">{archived.map((g) => <GoalCard key={g.id} g={g} onOpen={() => setOpen(g.id)} />)}</div>
        </>
      )}
      <NewGoalSheet open={adding} onClose={() => setAdding(false)} />
      <GoalSheet g={current} onClose={() => setOpen(null)} />
    </>
  );
}

function parts(g: Goal, meId: number | undefined, partnerId: number | undefined, meColor: string, theyColor: string) {
  const base = Math.max(g.target, 1);
  if (g.kind === "checklist") return [{ value: g.progress / base, color: meColor }];
  const mine = g.byUser[String(meId)] ?? 0;
  const theirs = partnerId ? g.byUser[String(partnerId)] ?? 0 : 0;
  return [
    { value: mine / base, color: meColor },
    { value: theirs / base, color: theyColor },
    { value: Math.max(0, g.progress - mine - theirs) / base, color: "var(--mint)" },
  ];
}

function GoalCard({ g, onOpen }: { g: Goal; onOpen: () => void }) {
  const { me, partner, meColor, theyColor } = useMe();
  const mark = useAct(() => api(`/goals/${g.id}/marks`, { body: { amount: 1 } }), ["goals", "home"]);
  return (
    <motion.div whileTap={{ scale: 0.985 }} className="card row" style={{ opacity: g.archived_at ? 0.6 : 1 }} onClick={onOpen}>
      <Ring parts={parts(g, me?.id, partner?.id, meColor, theyColor)} size={62}>
        <span className="emoji">{g.emoji ?? "🎯"}</span>
      </Ring>
      <div className="grow">
        <div style={{ fontWeight: 750, lineHeight: 1.25 }}>{g.title}</div>
        <div className="small muted" style={{ marginTop: 2 }}>
          {g.kind === "habit"
            ? `${g.progress} из ${g.target} на этой неделе${g.streak > 1 ? ` · 🔥 ${g.streak} ${plural(g.streak, "неделя", "недели", "недель")} подряд` : ""}`
            : g.kind === "checklist"
              ? `${g.progress} из ${g.target} ${plural(g.target, "шаг", "шага", "шагов")}`
              : `${g.progress} из ${g.target}${g.unit ? ` ${g.unit}` : ""}`}
          {g.done && g.kind !== "habit" ? " · достигнута 🎉" : ""}
        </div>
      </div>
      {g.kind !== "checklist" && !g.auto && !g.archived_at && (
        <motion.button
          whileTap={{ scale: 0.8 }}
          className="icon-btn"
          style={{ background: "var(--grad)", color: "#fff" }}
          onClick={(e) => {
            e.stopPropagation();
            haptic.medium();
            mark.mutate();
          }}
          aria-label="Плюс один"
        >
          <Plus size={20} />
        </motion.button>
      )}
    </motion.div>
  );
}

function GoalSheet({ g, onClose }: { g: Goal | null; onClose: () => void }) {
  const { me, partner, meColor, theyColor, personFor } = useMe();
  const [step, setStep] = useState("");
  const [amount, setAmount] = useState("1");
  const mark = useAct((n: number) => api(`/goals/${g!.id}/marks`, { body: { amount: n } }), ["goals", "home"]);
  const unmark = useAct((id: number) => api(`/goals/${g!.id}/marks/${id}`, { method: "DELETE" }), ["goals", "home"]);
  const toggle = useAct((v: { id: number; done: boolean }) => api(`/goals/${g!.id}/steps/${v.id}`, { method: "PATCH", body: { done: v.done } }), ["goals", "home"]);
  const addStep = useAct(() => api(`/goals/${g!.id}/steps`, { body: { text: step } }), ["goals"]);
  const delStep = useAct((id: number) => api(`/goals/${g!.id}/steps/${id}`, { method: "DELETE" }), ["goals"]);
  const archive = useAct(() => api(`/goals/${g!.id}`, { method: "PATCH", body: { action: g!.archived_at ? "unarchive" : "archive" } }), ["goals", "home"]);
  const del = useAct(() => api(`/goals/${g!.id}`, { method: "DELETE" }), ["goals", "home"]);

  return (
    <Sheet open={!!g} onClose={onClose} title={g ? `${g.emoji ?? "🎯"} ${g.title}` : ""}>
      {g && (
        <>
          <div className="row" style={{ gap: 16, marginBottom: 16 }}>
            <Ring parts={parts(g, me?.id, partner?.id, meColor, theyColor)} size={88} stroke={9}>
              <span className="num" style={{ fontSize: 18 }}>{Math.round((g.progress / Math.max(g.target, 1)) * 100)}%</span>
            </Ring>
            <div>
              <div className="num" style={{ fontSize: 26 }}>{g.progress} / {g.target}</div>
              <div className="small muted">{g.kind === "habit" ? "раз на этой неделе" : g.unit ?? (g.kind === "checklist" ? "шагов" : "")}</div>
              {g.auto && <div className="small muted" style={{ marginTop: 4 }}>{AUTO_LABEL[g.auto]}</div>}
              {g.due && <div className="small muted">срок: {dayMonth(g.due)}</div>}
            </div>
          </div>

          {g.kind !== "checklist" && (
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              {[me, partner].filter(Boolean).map((p) => (
                <div key={p!.id} className="card flat grow" style={{ margin: 0, padding: 12 }}>
                  <div className="small muted">{p!.id === me?.id ? "твой вклад" : p!.name}</div>
                  <div className="num" style={{ fontSize: 20, color: p!.id === me?.id ? meColor : theyColor }}>{g.byUser[String(p!.id)] ?? 0}</div>
                </div>
              ))}
            </div>
          )}

          {g.kind !== "checklist" && !g.archived_at && (
            <div className="row" style={{ gap: 8, margin: "12px 0" }}>
              {/* Счётчик вместо голого поля: цифра в поле шрифтом Lora на айфоне не рисовалась,
                  и в пустое на вид поле легко было вписать лишнее (жалоба 26.09.2026) */}
              <div className="stepper">
                <button type="button" aria-label="Меньше" onClick={() => { haptic.select(); setAmount(String(Math.max(1, (Number(amount) || 1) - 1))); }}><Minus size={16} /></button>
                <input inputMode="numeric" aria-label="Сколько отметить" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                <button type="button" aria-label="Больше" onClick={() => { haptic.select(); setAmount(String((Number(amount) || 0) + 1)); }}><Plus size={16} /></button>
              </div>
              <button className="btn" onClick={() => { haptic.success(); mark.mutate(Number(amount) || 1, { onSuccess: () => setAmount("1") }); }}>
                <Plus size={18} /> Отметить{Number(amount) > 1 ? ` +${amount}` : ""}
              </button>
            </div>
          )}

          {g.kind === "checklist" && (
            <div className="stack" style={{ marginBottom: 12 }}>
              {g.steps.map((s) => (
                <div key={s.id} className="row card flat" style={{ margin: 0, padding: 12 }}>
                  <button
                    className={`check${s.done_at ? " on" : ""}`}
                    style={{ ["--c" as string]: s.done_by ? (s.done_by === me?.id ? meColor : theyColor) : "var(--faint)" }}
                    onClick={() => { haptic.light(); toggle.mutate({ id: s.id, done: !s.done_at }); }}
                  >
                    {s.done_at && <Check size={15} strokeWidth={3} />}
                  </button>
                  <div className="grow" style={{ textDecoration: s.done_at ? "line-through" : "none", opacity: s.done_at ? 0.6 : 1 }}>{s.text}</div>
                  <button className="icon-btn ghost" onClick={() => delStep.mutate(s.id)} aria-label="Убрать шаг"><Minus size={15} className="faint" /></button>
                </div>
              ))}
              <div className="row" style={{ gap: 8 }}>
                <input className="input" value={step} onChange={(e) => setStep(e.target.value)} placeholder="Новый шаг" />
                <button className="icon-btn" disabled={!step.trim()} onClick={() => addStep.mutate(undefined, { onSuccess: () => setStep("") })} aria-label="Добавить шаг"><Plus size={18} /></button>
              </div>
            </div>
          )}

          {g.marks.length > 0 && (
            <>
              <div className="caps" style={{ margin: "16px 4px 8px" }}>История</div>
              <div className="stack">
                {g.marks.slice(0, 12).map((m) => {
                  const label = `${m.user_id === me?.id ? "ты" : personFor(m.user_id)?.name} ${m.amount > 0 ? `+${m.amount}` : m.amount}`;
                  return (
                    <div key={m.id} className="row small" style={{ padding: "0 0 0 4px" }}>
                      <div className="dot" style={{ ["--c" as string]: m.user_id === me?.id ? meColor : theyColor }} />
                      <div className="grow">{label}</div>
                      <span className="muted">{human(m.date)}</span>
                      <button
                        className="icon-btn ghost"
                        aria-label={`Удалить отметку ${label}`}
                        onClick={async () => {
                          if (!(await confirm(`Удалить отметку «${label}»?`))) return;
                          unmark.mutate(m.id, { onSuccess: () => store.toast("Отметка удалена") });
                        }}
                      >
                        <Trash2 size={16} className="faint" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="grid-2" style={{ marginTop: 18 }}>
            <button className="btn soft" onClick={() => archive.mutate(undefined, { onSuccess: onClose })}><Archive size={17} /> {g.archived_at ? "Вернуть" : "В архив"}</button>
            <button className="btn danger" onClick={async () => (await confirm("Удалить цель?")) && del.mutate(undefined, { onSuccess: onClose })}><Trash2 size={17} /> Удалить</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function PresetGrid({ onPicked }: { onPicked: () => void }) {
  const add = useAct((p: (typeof PRESETS)[number]) => api("/goals", { body: p }), ["goals", "home"]);
  return (
    <>
      <div className="caps" style={{ margin: "4px 4px 10px" }}>Можно начать с готовой</div>
      <div className="grid-2">
        {PRESETS.map((p) => (
          <motion.button
            key={p.title}
            whileTap={{ scale: 0.96 }}
            className="tile"
            style={{ minHeight: 96 }}
            onClick={() => add.mutate(p, { onSuccess: () => { haptic.success(); store.toast("Цель поставлена 🎯"); onPicked(); } })}
          >
            <span className="emoji" style={{ fontSize: 26 }}>{p.emoji}</span>
            <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.25 }}>{p.title}</div>
          </motion.button>
        ))}
      </div>
    </>
  );
}

function NewGoalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<Goal["kind"]>("count");
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("🎯");
  const [target, setTarget] = useState("10");
  const [unit, setUnit] = useState("");
  const [due, setDue] = useState("");
  const [steps, setSteps] = useState("");
  const [auto, setAuto] = useState("");
  const add = useAct(
    () =>
      api("/goals", {
        body: {
          kind, title, emoji, target: Number(target) || 1, unit: unit || null, due: due || null, auto: auto || null,
          steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
        },
      }),
    ["goals", "home"],
  );
  return (
    <Sheet open={open} onClose={onClose} title="Новая цель">
      <Segmented value={kind} onChange={setKind} items={[["count", "Число"], ["habit", "Привычка"], ["checklist", "Шаги"]]} />
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <input className="input emoji" style={{ width: 64, textAlign: "center", fontSize: 24 }} value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "habit" ? "Спорт вместе" : kind === "checklist" ? "Съехаться" : "12 книг за год"} />
      </div>
      {kind === "count" && (
        <>
          <div className="grid-2">
            <Field label="Сколько"><input className="input num" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
            <Field label="Чего"><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="книг" /></Field>
          </div>
          <Field label="Считать само">
            <Pills value={auto} onChange={setAuto} scroll items={[["", "нет, вручную"], ["ideas_done", "места"], ["movies_done", "фильмы"], ["dates", "свидания"], ["wishes_done", "подарки"]]} />
          </Field>
        </>
      )}
      {kind === "habit" && (
        <Field label="Сколько раз в неделю">
          <Pills value={target} onChange={setTarget} items={["1", "2", "3", "4", "5", "7"].map((n) => [n, n])} />
        </Field>
      )}
      {kind === "checklist" && (
        <Field label="Шаги — по одному в строке">
          <textarea className="input" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={"Посмотреть квартиры\nПосчитать бюджет\nПоговорить с родителями"} />
        </Field>
      )}
      <Field label="Срок — если нужен">
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <button
        className="btn"
        disabled={!title.trim() || (kind === "checklist" && !steps.trim()) || add.isPending}
        onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); setTitle(""); setSteps(""); onClose(); } })}
      >
        Поставить цель
      </button>
      <div style={{ marginTop: 20 }}>
        <PresetGrid onPicked={onClose} />
      </div>
    </Sheet>
  );
}
