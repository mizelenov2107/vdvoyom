import { AnimatePresence, motion } from "motion/react";
import { Camera, Check, CheckSquare, ChevronRight, CreditCard, Heart, Home as HomeIcon, Lock, LogOut, Mail, MessageCircle, MessageCircleHeart, NotebookPen, Pin, Plus, Repeat, Send, Settings, Share2, ShieldCheck, Shirt, SlidersHorizontal, Sparkles, Target, Trash2, Vote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { api, queryClient, useAct, useApi } from "../api.ts";
import { MODULES, NOTIFY, testsSub, useMe, type Module } from "../data.ts";
import { addDays, daysBetween, dayMonth, genitive, human, nextYearly, plural, today } from "../fmt.ts";
import { addToHomeScreen, confirm, haptic, inTelegram, shareLink, tg } from "../tg.ts";
import { nav, store } from "../store.ts";
import { Avatar, COLOR_HEX, Empty, PICKABLE, Field, Head, Pills, Section, Segmented, Sheet, Spinner, Toggle } from "../ui/kit.tsx";
import type { Daily, Home, Me } from "../types.ts";
import { currentThemePref, setThemePref, type ThemePref } from "../design.ts";
import { GhostSheet } from "./Sheets.tsx";
import { SearchButton } from "./Search.tsx";
import { DataSheet } from "./Invite.tsx";
import { GapPicker } from "./Calendar.tsx";

// ——— хаб «Ещё» ———

export function MoreScreen() {
  const { partner, shown, pair, data: meData, beta } = useMe();
  const { data: h } = useApi<Home>(["home"], "/home");
  // Все плитки в одном фирменном тоне (просьба 26.09.2026, образец — @TheCuteBot)
  const tiles: { key: string; title: string; sub: string; Icon: typeof Mail; color: string }[] = [
    { key: "tasks", title: "Дела", sub: h ? `${h.tasks.mine} мои · ${h.tasks.free} свободных` : "общий список дел", Icon: CheckSquare, color: "var(--accent, var(--rose))" },
    { key: "daily", title: "Вопрос дня", sub: h?.daily?.mine ? "ответ есть" : "ждёт ответа", Icon: MessageCircle, color: "var(--accent, var(--rose))" },
    { key: "capsules", title: "Капсулы", sub: "письма в будущее", Icon: Mail, color: "var(--accent, var(--rose))" },
    { key: "votes", title: "Голосования", sub: "тайные, до ответа обоих", Icon: Vote, color: "var(--accent, var(--rose))" },
    { key: "cards", title: "Карты", sub: "скидочные на двоих", Icon: CreditCard, color: "var(--accent, var(--rose))" },
    { key: "notes", title: "Заметки", sub: "общий блокнот", Icon: NotebookPen, color: "var(--accent, var(--rose))" },
    { key: "wardrobe", title: "Что надеть", sub: "гардероб и парные луки", Icon: Shirt, color: "var(--accent, var(--rose))" },
    { key: "goals", title: "Цели", sub: "к чему идём вместе", Icon: Target, color: "var(--accent, var(--rose))" },
  ].filter((t) => shown(t.key as Module));
  return (
    <div className="screen">
      <Head caption={partner ? "всё остальное" : "пока ты один на один"} title="Ещё" actions={<><SearchButton /><button className="icon-btn" onClick={() => nav.push("settings")} aria-label="Настройки"><Settings size={19} /></button></>} />
      <div className="grid-2">
        {tiles.map((t) => (
          <motion.button key={t.key} whileTap={{ scale: 0.96 }} className="tile" style={{ ["--c" as string]: t.color }} onClick={() => nav.push(t.key)}>
            <div className="ico"><t.Icon size={20} /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16.5 }}>{t.title}</div>
              <div className="small muted">{t.sub}</div>
            </div>
          </motion.button>
        ))}
      </div>
      {shown("tests") && (
      <button className="card tap row" style={{ width: "100%", textAlign: "left", marginTop: 10 }} onClick={() => { nav.tab("swipes"); nav.push("tests"); }}>
        <span style={{ fontSize: 26 }}>🧪</span>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Тесты на совместимость</div>
          <div className="small muted">{beta ? "угадай меня, свидание, деньги и другие" : "языки любви, «Это или то» и другие"}</div>
        </div>
        <ChevronRight size={18} className="faint" />
      </button>
      )}
      {shown("schedule") && (
      <button className="card tap row" style={{ width: "100%", textAlign: "left" }} onClick={() => { nav.tab("calendar"); nav.push("schedule"); }}>
        <span style={{ fontSize: 26 }}>🗓</span>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Расписание пар</div>
          <div className="small muted">по нему считаются общие окна</div>
        </div>
        <ChevronRight size={18} className="faint" />
      </button>
      )}
      {meData?.isAdmin && (
        <button className="card tap row" style={{ width: "100%", textAlign: "left", marginTop: tiles.length ? undefined : 10 }} onClick={() => nav.push("admin")}>
          <ShieldCheck size={22} color="var(--rose)" />
          <div className="grow">
            <div style={{ fontWeight: 650 }}>Админка</div>
            <div className="small muted">новые люди, кто что делает, отзывы</div>
          </div>
          <ChevronRight size={18} className="faint" />
        </button>
      )}
      {/* Закрытый тест: отзыв — первой строкой, «Вдвоём+» только когда платная часть включена */}
      <button className="card tap row" style={{ width: "100%", textAlign: "left", marginTop: tiles.length ? undefined : 10 }} onClick={() => store.feedback("Ещё")}>
        <MessageCircleHeart size={22} color="var(--rose)" />
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Написать отзыв</div>
          <div className="small muted">что не нравится, что добавить или убрать, дизайн, ошибки</div>
        </div>
        <ChevronRight size={18} className="faint" />
      </button>
      {meData?.plusOn && (
      <button className="card tap row" style={{ width: "100%", textAlign: "left" }} onClick={() => nav.push("plus", { via: "menu" })}>
        <Heart size={22} color="var(--rose)" />
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Вдвоём+</div>
          <div className="small muted">{pair?.plus?.active && pair.plus.until ? `включён до ${dayMonth(pair.plus.until)}` : "поддержать приложение, одна оплата на двоих"}</div>
        </div>
        <ChevronRight size={18} className="faint" />
      </button>
      )}
      <button className="card tap row" style={{ width: "100%", textAlign: "left" }} onClick={() => nav.push("settings", { focus: "modules" })}>
        <SlidersHorizontal size={22} color="var(--me)" />
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Настроить разделы</div>
          <div className="small muted">убрать лишнее или вернуть убранное</div>
        </div>
        <ChevronRight size={18} className="faint" />
      </button>
    </div>
  );
}

// ——— задачи ———

const LISTS: [string, string][] = [["", "Все"], ["дом", "🏠 Дом"], ["покупки", "🛒 Покупки"], ["подарки", "🎁 Подарки"], ["учёба", "📚 Учёба"], ["поездки", "✈️ Поездки"]];
const REPEAT_LABEL: Record<string, string> = { day: "каждый день", week: "каждую неделю", month: "каждый месяц" };

interface Task {
  id: number;
  list: string | null;
  repeat: string | null;
  author_id: number;
  title: string;
  due: string | null;
  assignee_id: number | null;
  taken_at: string | null;
  done_at: string | null;
  done_by: number | null;
}

export function TasksScreen() {
  const { me, partner, colorFor, meColor, theyColor } = useMe();
  const { data } = useApi<{ tasks: Task[] }>(["tasks"], "/tasks");
  const [f, setF] = useState("all");
  const [list, setList] = useState("");
  const [adding, setAdding] = useState(false);
  const [quick, setQuick] = useState("");
  const quickAdd = useAct(() => api("/tasks", { body: { title: quick, assignee: "free", list: list || null } }), ["tasks", "home"]);
  const act = useAct((v: { id: number; action: string }) => api(`/tasks/${v.id}`, { method: "PATCH", body: { action: v.action } }), ["tasks", "home"]);
  const del = useAct((id: number) => api(`/tasks/${id}`, { method: "DELETE" }), ["tasks", "home"]);
  const tasks = (data?.tasks ?? []).filter((t) => !list || t.list === list);
  const open = tasks.filter((t) => !t.done_at);
  const counts = {
    all: open.length,
    mine: open.filter((t) => t.assignee_id === me?.id).length,
    their: open.filter((t) => partner && t.assignee_id === partner.id).length,
    free: open.filter((t) => !t.assignee_id).length,
  };
  const pass = (t: Task) =>
    f === "all" || (f === "mine" && t.assignee_id === me?.id) || (f === "their" && t.assignee_id === partner?.id) || (f === "free" && !t.assignee_id);
  const working = open.filter((t) => t.assignee_id && pass(t));
  const free = open.filter((t) => !t.assignee_id && pass(t));
  const done = tasks.filter((t) => t.done_at && pass(t));

  const meta = (t: Task) => {
    const who = t.assignee_id === me?.id ? "у тебя" : t.assignee_id ? `у ${genitive(partner?.name ?? "")}` : t.author_id === me?.id ? "поставлено тобой" : `от ${genitive(partner?.name ?? "")}`;
    return `${who}${t.due ? ` · до ${dayMonth(t.due)}` : ""}${t.repeat ? ` · ${REPEAT_LABEL[t.repeat]}` : ""}${!list && t.list ? ` · ${t.list}` : ""}`;
  };

  const Row = ({ t }: { t: Task }) => (
    <motion.div layout className="card row accent-left" style={{ padding: 14, ["--edge" as string]: t.assignee_id ? colorFor(t.assignee_id) : "transparent", opacity: t.done_at ? 0.55 : 1 }}>
      <button
        className={`check${t.done_at ? " on" : ""}`}
        style={{ ["--c" as string]: t.assignee_id ? colorFor(t.assignee_id) : "var(--faint)" }}
        onClick={() => { haptic.light(); act.mutate({ id: t.id, action: t.done_at ? "undo" : "done" }); }}
        aria-label="Готово"
      >
        {t.done_at && <Check size={15} strokeWidth={3} />}
      </button>
      <div className="grow">
        <div style={{ fontWeight: 650, textDecoration: t.done_at ? "line-through" : "none" }}>
          {t.title} {t.repeat && <Repeat size={13} className="faint" style={{ verticalAlign: -1 }} />}
        </div>
        <div className="mono-sm">{meta(t)}{t.due && !t.done_at && t.due < today() ? " · просрочено" : ""}</div>
      </div>
      {!t.done_at && !t.assignee_id && (
        <button className="btn sm inline tint" onClick={() => { haptic.medium(); act.mutate({ id: t.id, action: "take" }); }}>Беру</button>
      )}
      {t.done_at && (
        <button className="icon-btn ghost" onClick={() => del.mutate(t.id)} aria-label="Удалить"><Trash2 size={15} className="faint" /></button>
      )}
    </motion.div>
  );

  return (
    <>
      <Head back caption="без напоминаний вслух" title="Дела" actions={<button className="icon-btn" onClick={() => setAdding(true)} aria-label="Добавить"><Plus size={20} /></button>} />
      <Pills value={list} onChange={setList} scroll items={LISTS} />
      <form
        className="row"
        style={{ gap: 8, marginBottom: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (quick.trim()) quickAdd.mutate(undefined, { onSuccess: () => { haptic.light(); setQuick(""); } });
        }}
      >
        <input className="input" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={list === "покупки" ? "Молоко, хлеб…" : "Быстро добавить дело"} />
        <button className="icon-btn" type="submit" aria-label="Добавить"><Plus size={20} /></button>
      </form>
      <Pills
        value={f}
        onChange={setF}
        scroll
        items={[
          ["all", `Все · ${counts.all}`],
          ["mine", `Мои · ${counts.mine}`, meColor],
          ...(partner ? ([["their", `${partner.name} · ${counts.their}`, theyColor]] as [string, string, string][]) : []),
          ["free", `Свободные · ${counts.free}`],
        ]}
      />
      {!data ? (
        <Spinner />
      ) : !tasks.length ? (
        <Empty art="tasks" title="Дел пока нет" text="Свободную задачу любой из вас может забрать одной кнопкой «Беру».">
          <button className="btn inline" onClick={() => setAdding(true)}>Добавить дело</button>
        </Empty>
      ) : (
        <>
          {working.length > 0 && <Section title="В работе" />}
          <div className="stack">{working.map((t) => <Row key={t.id} t={t} />)}</div>
          {free.length > 0 && <Section title="Свободные" />}
          <div className="stack">{free.map((t) => <Row key={t.id} t={t} />)}</div>
          {done.length > 0 && <Section title="Сделано" />}
          <div className="stack">{done.map((t) => <Row key={t.id} t={t} />)}</div>
        </>
      )}
      <TaskSheet open={adding} onClose={() => setAdding(false)} list={list} />
    </>
  );
}

function TaskSheet({ open, onClose, list: initialList }: { open: boolean; onClose: () => void; list: string }) {
  const { partner } = useMe();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState("free");
  const [list, setList] = useState(initialList);
  const [repeat, setRepeat] = useState("");
  const add = useAct(() => api("/tasks", { body: { title, due: due || null, assignee: who, list: list || null, repeat: repeat || null } }), ["tasks", "home"]);
  return (
    <Sheet open={open} onClose={onClose} title="Новое дело">
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Забрать посылку из ПВЗ" />
      <div style={{ height: 12 }} />
      <Field label="Кто делает">
        <Segmented value={who} onChange={setWho} items={[["me", "Я"], ...(partner ? ([["partner", partner.name]] as [string, string][]) : []), ["free", "Свободная"]]} />
      </Field>
      <Field label="Срок">
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {[["сегодня", today()], ["завтра", addDays(today(), 1)], ["через неделю", addDays(today(), 7)]].map(([l, d]) => (
            <button key={l} className={`pill${due === d ? " on" : ""}`} onClick={() => setDue(due === d ? "" : d)}>{l}</button>
          ))}
        </div>
        <input className="input" type="date" aria-label="Срок" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <Field label="Список">
        <Pills value={list} onChange={setList} scroll items={[["", "без списка"], ...LISTS.slice(1)]} />
      </Field>
      <Field label="Повторять">
        <Pills value={repeat} onChange={setRepeat} items={[["", "нет"], ["day", "каждый день"], ["week", "каждую неделю"], ["month", "каждый месяц"]]} />
      </Field>
      <button className="btn" disabled={!title.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); setTitle(""); setDue(""); setRepeat(""); onClose(); } })}>
        Добавить
      </button>
    </Sheet>
  );
}

// ——— тайные голосования ———

interface VoteRow {
  id: number;
  author_id: number;
  question: string;
  options: string[];
  mine: number | null;
  partnerVoted: boolean;
  partner: number | null;
  created_at: string;
}

export function VotesScreen() {
  const { me, partner, meColor, theyColor } = useMe();
  const { data } = useApi<{ votes: VoteRow[] }>(["votes"], "/votes");
  const [adding, setAdding] = useState(false);
  const answer = useAct((v: { id: number; option: number }) => api(`/votes/${v.id}/answer`, { body: { option: v.option } }), ["votes"]);
  const del = useAct((id: number) => api(`/votes/${id}`, { method: "DELETE" }), ["votes"]);
  return (
    <>
      <Head back caption="голос скрыт, пока не ответишь" title="Голосования" actions={<button className="icon-btn" onClick={() => setAdding(true)} aria-label="Новое"><Plus size={20} /></button>} />
      {!data ? (
        <Spinner />
      ) : !data.votes.length ? (
        <Empty art="vote" title="Спорный вопрос?" text="Задай его здесь. Каждый голосует у себя, и ответ половинки откроется только после твоего — выбор остаётся своим.">
          <button className="btn inline" onClick={() => setAdding(true)}>Спросить</button>
        </Empty>
      ) : (
        <div className="stack">
          {data.votes.map((v) => {
            const both = v.mine !== null && v.partner !== null;
            const agree = both && v.mine === v.partner;
            return (
              <div key={v.id} className="card">
                <div className="row between" style={{ alignItems: "flex-start" }}>
                  <div className="title-md" style={{ marginBottom: 12 }}>{v.question}</div>
                  {v.author_id === me?.id && (
                    <button className="icon-btn ghost" onClick={async () => (await confirm("Удалить голосование?")) && del.mutate(v.id)} aria-label="Удалить"><Trash2 size={15} className="faint" /></button>
                  )}
                </div>
                <div className="stack">
                  {v.options.map((o, i) => {
                    const mineHere = v.mine === i;
                    const theirHere = v.partner === i;
                    return (
                      <motion.button
                        key={i}
                        whileTap={{ scale: 0.98 }}
                        className="card flat row between"
                        style={{ width: "100%", textAlign: "left", padding: "12px 14px", margin: 0, outline: mineHere ? `2px solid ${meColor}` : "none" }}
                        onClick={() => { haptic.select(); answer.mutate({ id: v.id, option: i }); }}
                      >
                        <span style={{ fontWeight: 600 }}>{o}</span>
                        <span className="row" style={{ gap: 4 }}>
                          {mineHere && <span className="dot" style={{ ["--c" as string]: meColor }} />}
                          {theirHere && <span className="dot" style={{ ["--c" as string]: theyColor }} />}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
                <div className="small muted" style={{ marginTop: 10 }}>
                  {v.mine === null
                    ? v.partnerVoted
                      ? `${partner?.name}: голос уже есть. Твой ход 👀`
                      : "Никто ещё не голосовал"
                    : v.partner === null
                      ? `Ждём голос ${genitive(partner?.name ?? "половинки")}`
                      : agree
                        ? "Совпали! 🎉"
                        : "Мнения разошлись — время договориться"}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <VoteSheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function VoteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const add = useAct(() => api("/votes", { body: { question: q, options: opts.filter((o) => o.trim()) } }), ["votes"]);
  return (
    <Sheet open={open} onClose={onClose} title="Новое голосование">
      <Field label="Вопрос">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Где встречаем Новый год?" />
      </Field>
      <div className="caps" style={{ margin: "0 4px 6px" }}>Варианты</div>
      <div className="stack" style={{ marginBottom: 12 }}>
        {opts.map((o, i) => (
          <input key={i} className="input" value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Вариант ${i + 1}`} />
        ))}
      </div>
      {opts.length < 6 && <button className="btn soft sm" style={{ marginBottom: 14 }} onClick={() => setOpts([...opts, ""])}><Plus size={16} /> вариант</button>}
      <button
        className="btn"
        disabled={!q.trim() || opts.filter((o) => o.trim()).length < 2}
        onClick={() => add.mutate(undefined, { onSuccess: () => { setQ(""); setOpts(["", ""]); onClose(); } })}
      >
        Спросить
      </button>
    </Sheet>
  );
}

// ——— капсулы времени ———

interface Capsule {
  id: number;
  author_id: number;
  title: string;
  body: string | null;
  open_at: string;
  sealed: boolean;
  read_at: string | null;
  /** Сюрприз: половинка не видит письмо, пока оно не откроется */
  secret?: boolean;
}

export function CapsulesScreen() {
  const { me, partner, pair } = useMe();
  const { data } = useApi<{ capsules: Capsule[] }>(["capsules"], "/capsules");
  const [writing, setWriting] = useState(false);
  const [reading, setReading] = useState<Capsule | null>(null);
  const read = useAct((id: number) => api(`/capsules/${id}`, { method: "PATCH", body: { action: "read" } }), ["capsules", "home"]);
  const list = data?.capsules ?? [];
  const ready = list.filter((c) => !c.sealed && c.author_id !== me?.id && !c.read_at);
  const sealed = list.filter((c) => c.sealed);
  const opened = list.filter((c) => !c.sealed && !(c.author_id !== me?.id && !c.read_at));

  return (
    <>
      <Head back caption="пишешь сегодня, читаете потом" title="Капсулы" actions={<button className="icon-btn" onClick={() => setWriting(true)} aria-label="Написать"><Plus size={20} /></button>} />
      {!data ? (
        <Spinner />
      ) : !list.length ? (
        <Empty art="letter" title="Письмо в будущее" text="Напиши половинке письмо, которое откроется в выбранный день: на годовщину, Новый год или через год. До срока его не прочитать даже случайно.">
          <button className="btn inline" onClick={() => setWriting(true)}>Написать письмо</button>
        </Empty>
      ) : (
        <div className="stack">
          {ready.map((c) => (
            <motion.button
              key={c.id}
              whileTap={{ scale: 0.98 }}
              className="card"
              style={{ width: "100%", textAlign: "left", background: "var(--they)", color: "#1a0d0b", padding: 22 }}
              onClick={() => { setReading(c); read.mutate(c.id); haptic.success(); }}
            >
              <Mail size={30} />
              <div className="title-lg" style={{ margin: "14px 0 6px", color: "#1a0d0b" }}>Тебя ждёт письмо от {genitive(partner?.name ?? "")}</div>
              <div className="mono-sm" style={{ color: "rgba(26,13,11,.65)" }}>«{c.title}» · открылось {human(c.open_at)}</div>
            </motion.button>
          ))}
          {sealed.map((c) => {
            const mine = c.author_id === me?.id;
            const left = daysBetween(today(), c.open_at);
            return (
              <button key={c.id} className="card row accent-left" style={{ width: "100%", textAlign: "left", ["--edge" as string]: mine ? "var(--me)" : "var(--they)" }} onClick={() => mine && setReading(c)}>
                <Lock size={22} className="muted" />
                <div className="grow">
                  <div style={{ fontWeight: 650 }}>{mine ? `${partner?.name ?? "Половинке"} — ${c.title}` : `От ${genitive(partner?.name ?? "")}: запечатано`}</div>
                  <div className="mono-sm">откроется {dayMonth(c.open_at)} · через {left} {plural(left, "день", "дня", "дней")}{mine && c.secret ? " · сюрприз 🤫" : ""}{mine ? " · можно править" : ""}</div>
                </div>
              </button>
            );
          })}
          {opened.map((c) => (
            <button key={c.id} className="card row" style={{ width: "100%", textAlign: "left", opacity: 0.8 }} onClick={() => setReading(c)}>
              <Mail size={22} className="muted" />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>«{c.title}»</div>
                <div className="mono-sm">открыто {dayMonth(c.open_at)} · {c.author_id === me?.id ? "от тебя" : `от ${genitive(partner?.name ?? "")}`}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      <CapsuleSheet open={writing} onClose={() => setWriting(false)} since={pair?.togetherSince ?? null} />
      <Sheet open={!!reading} onClose={() => setReading(null)} title={reading?.title}>
        {reading && (
          <>
            <div className="mono-sm" style={{ marginTop: -8, marginBottom: 16 }}>
              {reading.author_id === me?.id ? "от тебя" : `от ${genitive(partner?.name ?? "")}`} · {dayMonth(reading.open_at)}
            </div>
            <div className="letter">{reading.body}</div>
          </>
        )}
      </Sheet>
    </>
  );
}

function CapsuleSheet({ open, onClose, since }: { open: boolean; onClose: () => void; since: string | null }) {
  const t = today();
  const presets: [string, string][] = [
    ["через месяц", addDays(t, 30)],
    ["на Новый год", `${Number(t.slice(0, 4)) + (t.slice(5) >= "12-31" ? 1 : 0)}-12-31`],
    ...(since ? ([["на годовщину", nextYearly(since, addDays(t, 1))]] as [string, string][]) : []),
    ["через год", addDays(t, 365)],
  ];
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState(presets[0][1]);
  const [secret, setSecret] = useState(false);
  const add = useAct(() => api("/capsules", { body: { title, body, open_at: date, secret } }), ["capsules", "home"]);
  return (
    <Sheet open={open} onClose={onClose} title="Письмо в будущее">
      <Field label="Когда откроется">
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {presets.map(([l, d]) => (
            <button key={l} className={`pill${date === d ? " on" : ""}`} onClick={() => setDate(d)}>{l}</button>
          ))}
        </div>
        <input className="input" type="date" aria-label="Дата открытия" min={addDays(t, 1)} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Заголовок">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Прочитай, когда будет год" />
      </Field>
      <Field label="Письмо">
        <textarea className="input" style={{ minHeight: 200 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Привет из прошлого…" />
      </Field>
      {/* Отзыв #2 (28.09.2026): письмо-сюрприз — без уведомления и невидимое до даты */}
      <div className="row" style={{ gap: 12, margin: "4px 0 14px" }}>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Сюрприз 🤫</div>
          <div className="small muted">Не уведомлять: половинка узнает о письме только в день, когда оно откроется</div>
        </div>
        <Toggle on={secret} onChange={setSecret} label="Сюрприз: не уведомлять" />
      </div>
      <button className="btn" disabled={!title.trim() || !body.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); store.toast(secret ? "Запечатано тайно 🤫" : "Запечатано 🔒"); setTitle(""); setBody(""); setSecret(false); onClose(); } })}>
        <Lock size={17} /> Запечатать до {dayMonth(date)}
      </button>
    </Sheet>
  );
}

// ——— карты лояльности ———

interface CardRow {
  id: number;
  author_id: number;
  store: string;
  number: string;
  format: string;
  color: string | null;
}

const CARD_COLORS = ["#e53935", "#2e7d32", "#1e88e5", "#f9a825", "#8e24aa", "#ef6c00", "#00897b", "#37474f"];

function cardColor(c: CardRow): string {
  if (c.color) return c.color;
  let h = 0;
  for (const ch of c.store) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CARD_COLORS[h % CARD_COLORS.length];
}

export function CardsScreen() {
  const { data } = useApi<{ cards: CardRow[] }>(["cards"], "/cards");
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState<CardRow | null>(null);
  return (
    <>
      <Head back caption="на кассе хватит телефона" title="Карты" actions={<button className="icon-btn" onClick={() => setAdding(true)} aria-label="Добавить"><Plus size={20} /></button>} />
      {!data ? (
        <Spinner />
      ) : !data.cards.length ? (
        <Empty art="cards" title="Карт пока нет" text="Добавь скидочную карту один раз — у обоих она откроется штрихкодом на весь экран. Больше никаких «скинь карту, я на кассе».">
          <button className="btn inline" onClick={() => setAdding(true)}>Добавить карту</button>
        </Empty>
      ) : (
        <div className="grid-2">
          {data.cards.map((c) => (
            <motion.button
              key={c.id}
              whileTap={{ scale: 0.96 }}
              style={{ aspectRatio: "1.586", borderRadius: 18, background: cardColor(c), color: "#fff", padding: 14, textAlign: "left", display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "var(--shadow)" }}
              onClick={() => { setShow(c); haptic.light(); }}
            >
              <div style={{ fontWeight: 750, fontSize: 18 }}>{c.store}</div>
              <div className="mono-sm" style={{ color: "rgba(255,255,255,.8)" }}>•••• {c.number.slice(-4)}</div>
            </motion.button>
          ))}
        </div>
      )}
      <CardSheet open={adding} onClose={() => setAdding(false)} />
      <AnimatePresence>{show && <BarcodeFull card={show} onClose={() => setShow(null)} />}</AnimatePresence>
    </>
  );
}

function BarcodeFull({ card, onClose }: { card: CardRow; onClose: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const del = useAct(() => api(`/cards/${card.id}`, { method: "DELETE" }), ["cards"]);
  useEffect(() => {
    try {
      if (card.format === "QR") void QRCode.toCanvas(canvas.current!, card.number, { width: 280, margin: 1 });
      else JsBarcode(svg.current, card.number, { format: card.format, displayValue: false, height: 130, width: 2.6, margin: 0 });
    } catch {
      // Номер не подходит к формату — рисуем универсальным CODE128
      JsBarcode(svg.current, card.number, { format: "CODE128", displayValue: false, height: 130, width: 2.2, margin: 0 });
    }
  }, [card]);
  // В корень страницы, как и шторки: внутри прокручиваемого экрана fixed на айфоне съезжает
  return createPortal(
    <motion.div className="barcode-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <div style={{ fontWeight: 800, fontSize: 30, marginBottom: 26 }}>{card.store}</div>
      {card.format === "QR" ? <canvas ref={canvas} /> : <svg ref={svg} />}
      <div style={{ fontFamily: "var(--mono)", fontSize: 20, letterSpacing: "0.12em", marginTop: 18 }}>{card.number}</div>
      <div style={{ color: "#888", marginTop: 26, fontSize: 14 }}>Прибавь яркость экрана · нажми, чтобы закрыть</div>
      <button
        style={{ position: "absolute", bottom: 40, color: "#d33", fontSize: 14 }}
        onClick={async (e) => { e.stopPropagation(); if (await confirm("Удалить карту у обоих?")) del.mutate(undefined, { onSuccess: onClose }); }}
      >
        Удалить карту
      </button>
    </motion.div>,
    document.body,
  );
}

function guessFormat(n: string): string {
  if (/^\d{13}$/.test(n)) return "EAN13";
  if (/^\d{8}$/.test(n)) return "EAN8";
  return "CODE128";
}

function CardSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [storeName, setStore] = useState("");
  const [number, setNumber] = useState("");
  const [format, setFormat] = useState("auto");
  const [scanning, setScanning] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const add = useAct(() => api("/cards", { body: { store: storeName, number: number.replace(/\s/g, ""), format: format === "auto" ? guessFormat(number.replace(/\s/g, "")) : format } }), ["cards"]);

  // Штрихкод читаем с фотографии: камера в вебвью телеграма есть не у всех, а снимок работает везде
  async function scan(f: File) {
    setScanning(true);
    try {
      const { readBarcodes } = await import("../scan.ts");
      const found = await readBarcodes(f);
      if (!found) store.toast("Не нашёл штрихкод — попробуй ближе и без бликов");
      else {
        setNumber(found.text);
        setFormat(found.format);
        haptic.success();
      }
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Новая карта">
      <Field label="Магазин">
        <input className="input" value={storeName} onChange={(e) => setStore(e.target.value)} placeholder="Пятёрочка" />
      </Field>
      <Field label="Номер карты">
        <input className="input num" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="2 000 123 456 789" />
      </Field>
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])} />
      <button className="btn soft" style={{ marginBottom: 12 }} disabled={scanning} onClick={() => file.current?.click()}>
        <Camera size={18} /> {scanning ? "Читаю…" : "Сфотографировать штрихкод"}
      </button>
      <Field label="Формат">
        <Pills value={format} onChange={setFormat} scroll items={[["auto", "авто"], ["EAN13", "EAN-13"], ["CODE128", "Code 128"], ["QR", "QR"]]} />
      </Field>
      <button className="btn" disabled={!storeName.trim() || !number.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); setStore(""); setNumber(""); setFormat("auto"); onClose(); } })}>
        Добавить
      </button>
    </Sheet>
  );
}

// ——— заметки ———

interface Note {
  id: number;
  author_id: number;
  title: string;
  body: string;
  pinned: number;
  updated_by: number | null;
  updated_at: string;
}

export function NotesScreen() {
  const { data } = useApi<{ notes: Note[] }>(["notes"], "/notes");
  const add = useAct(() => api<{ id: number }>("/notes", { body: { title: "", body: "" } }), ["notes"]);
  const { colorFor } = useMe();
  return (
    <>
      <Head back caption="рецепты, списки, планы" title="Заметки" actions={<button className="icon-btn" onClick={() => add.mutate(undefined, { onSuccess: (r) => nav.push("note", { id: r.id }) })} aria-label="Новая"><Plus size={20} /></button>} />
      {!data ? (
        <Spinner />
      ) : !data.notes.length ? (
        <Empty art="notes" title="Общий блокнот" text="Рецепт пасты, список покупок к празднику, план поездки — всё, что хочется записать вдвоём.">
          <button className="btn inline" onClick={() => add.mutate(undefined, { onSuccess: (r) => nav.push("note", { id: r.id }) })}>Новая заметка</button>
        </Empty>
      ) : (
        <div className="grid-2">
          {data.notes.map((n) => (
            <motion.button key={n.id} whileTap={{ scale: 0.97 }} className="card" style={{ margin: 0, textAlign: "left", minHeight: 130, display: "flex", flexDirection: "column", gap: 6 }} onClick={() => nav.push("note", { id: n.id })}>
              <div className="row between">
                <div className="dot" style={{ ["--c" as string]: colorFor(n.updated_by ?? n.author_id) }} />
                {n.pinned ? <Pin size={14} className="faint" /> : null}
              </div>
              <div style={{ fontWeight: 700 }} className="ellipsis">{n.title || "Без названия"}</div>
              <div className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>{n.body}</div>
            </motion.button>
          ))}
        </div>
      )}
    </>
  );
}

export function NoteScreen({ id }: { id: number }) {
  const { data } = useApi<{ notes: Note[] }>(["notes"], "/notes");
  const note = data?.notes.find((n) => n.id === id);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const del = useAct(() => api(`/notes/${id}`, { method: "DELETE" }), ["notes"]);
  const pin = useAct(() => api(`/notes/${id}`, { method: "PATCH", body: { pinned: !note?.pinned } }), ["notes"]);

  // Автосохранение через секунду после последней правки
  useEffect(() => {
    if (title === null && body === null) return;
    setSaved(false);
    const t = setTimeout(async () => {
      await api(`/notes/${id}`, { method: "PATCH", body: { ...(title !== null ? { title } : {}), ...(body !== null ? { body } : {}) } });
      setSaved(true);
    }, 900);
    return () => clearTimeout(t);
  }, [title, body]);

  if (!note) return <Spinner />;
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <button className="row muted" style={{ gap: 2 }} onClick={nav.back}>‹ Заметки</button>
        <div className="row" style={{ gap: 8 }}>
          <span className="mono-sm">{saved ? "сохранено" : "…"}</span>
          <button className="icon-btn" onClick={() => pin.mutate()} aria-label="Закрепить"><Pin size={17} style={{ opacity: note.pinned ? 1 : 0.4 }} /></button>
          <button className="icon-btn" onClick={async () => (await confirm("Удалить заметку?")) && del.mutate(undefined, { onSuccess: () => nav.back() })} aria-label="Удалить"><Trash2 size={17} /></button>
        </div>
      </div>
      {/* Длинное название («Как поддержать друг друга» из теста) переносится, а не обрезается справа */}
      <textarea
        className="title-xl"
        rows={1}
        aria-label="Название"
        ref={(el) => {
          if (el) {
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }
        }}
        style={{ background: "none", border: 0, outline: "none", width: "100%", padding: 0, resize: "none", overflow: "hidden", display: "block" }}
        value={title ?? note.title}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        placeholder="Название"
      />
      <textarea
        style={{ background: "none", border: 0, outline: "none", width: "100%", minHeight: "60dvh", resize: "none", fontSize: 17, lineHeight: 1.55, marginTop: 14, padding: 0 }}
        value={body ?? note.body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Пиши здесь…"
      />
    </>
  );
}

// ——— вопрос дня ———

export function DailyScreen() {
  const { partner, meColor, theyColor, pair } = useMe();
  const { data } = useApi<{ today: Daily | null; archive: Daily[] }>(["daily"], "/daily");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const send = useAct((v: { text: string; date?: string }) => api("/daily", { body: v }), ["daily", "home"]);
  const d = data?.today;
  return (
    <>
      <Head back caption="один вопрос на двоих" title="Вопрос дня" />
      {!data ? (
        <Spinner />
      ) : !d ? (
        <Empty art="chat" title="Вопросы скоро появятся" />
      ) : (
        <>
          <div className="card" style={{ padding: 22, background: "linear-gradient(145deg, color-mix(in srgb, var(--violet) 22%, var(--card)), var(--card))" }}>
            <div className="caps">{d.question.category}</div>
            <div className="title-lg" style={{ marginTop: 8, lineHeight: 1.25 }}>{d.question.text}</div>
          </div>

          {!d.mine || editing ? (
            <div className="card">
              <textarea className="input" autoFocus value={text || (editing ? d.mine ?? "" : "")} onChange={(e) => setText(e.target.value)} placeholder="Твой ответ…" />
              <button
                className="btn"
                style={{ marginTop: 12 }}
                disabled={!(text || d.mine || "").trim() || send.isPending}
                onClick={() => send.mutate({ text: text || d.mine || "" }, { onSuccess: () => { haptic.success(); setEditing(false); setText(""); } })}
              >
                {d.partnerAnswered && !d.mine ? "Ответить и увидеть ответ" : "Ответить"}
              </button>
              {d.partnerAnswered && !d.mine && <p className="small muted center" style={{ marginBottom: 0 }}>Ответ {genitive(partner?.name ?? "")} уже ждёт 👀</p>}
            </div>
          ) : (
            <>
              <Section title="Ты" action={<button className="link small" onClick={() => setEditing(true)}>Изменить</button>} />
              <MyAnswer d={d} />
              <Section title={partner?.name ?? "Половинка"} />
              {d.partner ? (
                <>
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bubble they" style={{ borderLeft: `3px solid ${theyColor}` }}>
                    {d.partner}
                  </motion.div>
                  <DailyThread d={d} />
                </>
              ) : (
                partner ? (
                <div className="bubble muted">Ждём ответ {genitive(partner.name)}. Бот напомнит.</div>
              ) : (
                <div className="bubble muted">
                  Ответ половинки появится здесь, когда она будет в приложении.
                  {pair && (
                    <button className="btn sm inline plain" style={{ marginTop: 10 }} onClick={() => shareLink(pair.invite, "Давай отвечать на вопрос дня вместе 💞")}>
                      Позвать половинку
                    </button>
                  )}
                </div>
              )
              )}
            </>
          )}

          {data.archive.length > 0 && <Section title="Архив" />}
          <div className="stack">
            {data.archive.map((a) => (
              <details key={a.date} className="card" style={{ padding: 14 }}>
                <summary style={{ listStyle: "none", cursor: "pointer" }}>
                  <div className="mono-sm">{human(a.date)}</div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>{a.question.text}</div>
                </summary>
                <MyAnswer d={a} small />
                <div className="bubble they small" style={{ marginTop: 8 }}>{a.partner ?? "ответа не было"}</div>
                {a.partner && <DailyThread d={a} />}
              </details>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Мой ответ; если половинка отреагировала — её смайлик в углу, как в мессенджере. */
function MyAnswer({ d, small }: { d: Daily; small?: boolean }) {
  const { partner, meColor } = useMe();
  return (
    <div className={`bubble me react-host${small ? " small" : ""}`} style={{ borderLeft: small ? undefined : `3px solid ${meColor}`, marginTop: small ? 10 : undefined }}>
      {d.mine}
      {d.reactions?.theirs && (
        <span className="react-badge" aria-label={`Реакция ${genitive(partner?.name ?? "")}: ${d.reactions.theirs}`}>{d.reactions.theirs}</span>
      )}
    </div>
  );
}

const REACTIONS = ["❤️", "😂", "🥺", "😮", "🔥", "🤔", "👍"];

/**
 * Под ответом половинки: реакция смайликом и переписка «ответ на ответ»
 * (28.09.2026). Открывается, когда ответили оба. Реакция ставится сразу,
 * не дожидаясь сервера; тот же смайлик ещё раз — снять.
 */
function DailyThread({ d }: { d: Daily }) {
  const { partner } = useMe();
  const [text, setText] = useState("");
  const react = useAct((v: { date: string; emoji: string | null }) => api("/daily/react", { body: v }), ["daily", "home"]);
  const comment = useAct((v: { date: string; text: string }) => api("/daily/comment", { body: v }), ["daily"]);
  const remove = useAct((id: number) => api(`/daily/comment/${id}`, { method: "DELETE" }), ["daily"]);
  const patch = (next: Partial<Daily>) =>
    queryClient.setQueryData<{ today: Daily | null; archive: Daily[] }>(["daily"], (all) =>
      all && {
        today: all.today?.date === d.date ? { ...all.today, ...next } : all.today,
        archive: all.archive.map((a) => (a.date === d.date ? { ...a, ...next } : a)),
      },
    );
  const pick = (emoji: string) => {
    haptic.select();
    const value = d.reactions.mine === emoji ? null : emoji;
    patch({ reactions: { ...d.reactions, mine: value } });
    react.mutate({ date: d.date, emoji: value });
  };
  const send = () => {
    const t = text.trim();
    if (!t) return;
    comment.mutate({ date: d.date, text: t }, { onSuccess: () => { haptic.success(); setText(""); } });
  };
  return (
    <>
      <div className="react-row" role="group" aria-label={`Реакция на ответ ${genitive(partner?.name ?? "")}`}>
        {REACTIONS.map((e) => (
          <button key={e} className={`react${d.reactions.mine === e ? " on" : ""}`} aria-pressed={d.reactions.mine === e} onClick={() => pick(e)}>
            {e}
          </button>
        ))}
      </div>
      {d.comments.length > 0 && (
        <div className="thread-list">
          {d.comments.map((c) => (
            <div key={c.id} className={`bubble small thread ${c.mine ? "me" : "they"}`}>
              {c.text}
              {c.mine && (
                <button
                  className="thread-del"
                  aria-label="Удалить сообщение"
                  onClick={async () => (await confirm("Удалить сообщение?")) && remove.mutate(c.id)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <input
          className="input grow"
          placeholder={d.comments.length ? "Ответить…" : `Ответить на ответ ${genitive(partner?.name ?? "")}…`}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          aria-label="Ответ на ответ"
        />
        <button className="icon-btn" aria-label="Отправить" disabled={!text.trim() || comment.isPending} onClick={send} style={{ background: "var(--accent, var(--me))", color: "#fff" }}>
          <Send size={17} />
        </button>
      </div>
    </>
  );
}

// ——— настройки ———

export function SettingsScreen({ focus }: { focus?: string }) {
  const { me, partner, pair, prefs, data: meData, beta } = useMe();
  const save = useAct((body: Record<string, unknown>) => api("/me", { body }), ["me", "home", "tests"]);
  const modulesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === "modules") setTimeout(() => modulesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }, [focus]);
  // Переключатель откликается сразу, не дожидаясь ответа сервера
  const setPrefs = (next: { hidden?: string[]; muted?: string[] }) => {
    haptic.select();
    queryClient.setQueryData<Me>(["me"], (d) => (d ? { ...d, prefs: { ...prefs, ...next } } : d));
    save.mutate(next);
  };
  const saveSince = useAct((d: string) => api("/pair", { body: { togetherSince: d || null } }), ["me", "home"]);
  const removeGhost = useAct(() => api("/pair/partner", { method: "DELETE" }), ["me", "home", "schedule", "windows"]);
  const leave = useAct(() => api("/pair/leave", { body: {} }), ["me", "home"]);
  const [dataOpen, setDataOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [name, setName] = useState(me?.name ?? "");
  const [theme, setTheme] = useState<ThemePref>(currentThemePref());
  if (!me) return <Spinner />;
  return (
    <>
      <Head back caption="профиль и пара" title="Настройки" />
      <div className="card row">
        <Avatar p={me} size={54} />
        <div className="grow">
          <input className="input" aria-label="Имя в приложении" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== me.name && save.mutate({ name })} />
        </div>
      </div>
      <div ref={modulesRef} style={{ scrollMarginTop: 16 }} />
      <Section title="Разделы" />
      <p className="small muted" style={{ margin: "-6px 4px 10px", lineHeight: 1.45 }}>
        Убери то, чем не пользуешься. Раздел пропадёт из меню и с главной, а бот перестанет о нём напоминать. Записи не удаляются: включишь обратно — всё на месте. {partner && !partner.ghost ? `У ${genitive(partner.name)} разделы настраиваются отдельно.` : ""}
      </p>
      <div className="card" style={{ padding: "2px 16px" }}>
        {MODULES.map((m, i) => (
          <div key={m.key} className="row" style={{ gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{m.title}</div>
              <div className="small muted">{m.key === "tests" ? testsSub(beta) : m.sub}</div>
            </div>
            <Toggle
              label={m.title}
              on={!prefs.hidden.includes(m.key)}
              onChange={(on) => setPrefs({ hidden: on ? prefs.hidden.filter((k) => k !== m.key) : [...prefs.hidden, m.key] })}
            />
          </div>
        ))}
      </div>
      <Section title="Тема" />
      <Segmented<ThemePref>
        value={theme}
        onChange={(t) => { haptic.select(); setThemePref(t); setTheme(t); }}
        items={[["light", "Светлая"], ["dark", "Тёмная"], ["auto", "Авто"]]}
      />
      <p className="small muted" style={{ margin: "-6px 4px 0" }}>«Авто» — как в Телеграме. Выбор запоминается на этом телефоне.</p>
      <Section title="Твой цвет" />
      <div className="card row" style={{ gap: 12, justifyContent: "space-between" }}>
        {PICKABLE.map((k) => [k, COLOR_HEX[k]] as const).map(([k, hex]) => (
          <button
            key={k}
            onClick={() => { haptic.select(); save.mutate({ color: k }); }}
            style={{ width: 44, height: 44, borderRadius: "50%", background: hex, display: "grid", placeItems: "center", color: "#fff", boxShadow: me.color === k ? `0 0 0 3px var(--card), 0 0 0 5px ${hex}` : "none" }}
            aria-label={k}
          >
            {me.color === k && <Check size={18} strokeWidth={3} />}
          </button>
        ))}
      </div>
      <Section title="Даты" />
      <div className="card">
        <Field label="Твой день рождения">
          <input className="input" type="date" defaultValue={me.birthday ?? ""} onChange={(e) => save.mutate({ birthday: e.target.value || null })} />
        </Field>
        <Field label="Вместе с">
          <input className="input" type="date" max={today()} defaultValue={pair?.togetherSince ?? ""} onChange={(e) => saveSince.mutate(e.target.value)} />
        </Field>
      </div>
      {prefs.hidden.includes("schedule") ? null : (
        <>
          <Section title="Встречи" />
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Запас до встречи</div>
            <GapPicker />
          </div>
        </>
      )}
      <Section title="Пара" />
      <div className="card">
        {partner && !partner.ghost ? (
          <div className="row">
            <Avatar p={partner} size={40} />
            <div className="grow">
              <div style={{ fontWeight: 650 }}>{partner.name}</div>
              <div className="small muted">{partner.username ? `@${partner.username}` : "в паре с тобой"}{partner.birthday ? ` · ДР ${dayMonth(partner.birthday)}` : ""}</div>
            </div>
            <Sparkles size={18} color="var(--they)" />
          </div>
        ) : null}
        {beta && partner && !partner.ghost && !prefs.hidden.includes("tests") && (
          <button className="link" style={{ marginTop: 6 }} onClick={() => nav.push("cheatsheet")}>
            📝 Шпаргалка про партнёра: {partner.name}
          </button>
        )}
        {partner && !partner.ghost ? null : partner?.ghost ? (
          <>
            <div className="row">
              <Avatar p={partner} size={40} />
              <div className="grow">
                <div style={{ fontWeight: 650 }}>{partner.name} · заранее</div>
                <div className="small muted">её расписание уже считается; при входе по ссылке всё перейдёт к ней</div>
              </div>
            </div>
            <button className="btn tint" style={{ marginTop: 12 }} onClick={() => pair && shareLink(pair.invite, "Давай вести наши планы, хотелки и свидания вместе 💞")}>
              <Share2 size={17} /> Отправить приглашение
            </button>
            <button className="link small" style={{ marginTop: 10 }} onClick={async () => (await confirm(`Убрать заготовку «${partner.name}» вместе с её расписанием?`)) && removeGhost.mutate()}>
              Убрать заготовку
            </button>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 650 }}>Половинка ещё не присоединилась</div>
            <button className="btn tint" style={{ marginTop: 12 }} onClick={() => pair && shareLink(pair.invite, "Давай вести наши планы, хотелки и свидания вместе 💞")}>
              <Share2 size={17} /> Отправить приглашение
            </button>
            <button className="btn soft" style={{ marginTop: 8 }} onClick={() => setGhostOpen(true)}>Внести её данные заранее</button>
          </>
        )}
      </div>
      <Section title="Телеграм" />
      <div className="stack">
        {inTelegram && (
          <button className="card tap row" style={{ width: "100%", textAlign: "left" }} onClick={() => !addToHomeScreen() && store.toast("Обнови телеграм, чтобы добавить на экран")}>
            <HomeIcon size={20} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>Иконка на экран «Домой»</div>
              <div className="small muted">открывать «Вдвоём» как обычное приложение</div>
            </div>
          </button>
        )}
        <div className="card small muted">
          Уведомления приходят от бота в чат. {me.chatOk ? "Сейчас они включены." : "Чтобы их получать, открой чат с ботом и нажми «Старт»."}
        </div>
        <div className="card" style={{ padding: "2px 16px" }}>
          {NOTIFY.filter((n) => (n.key === "weekly" ? !prefs.hidden.includes("schedule") : n.key === "tests" ? beta && !prefs.hidden.includes(n.key) : n.key === "daily" ? !prefs.hidden.includes(n.key) : true)).map((n, i) => (
            <div key={n.key} className="row" style={{ gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                <div className="small muted">{n.sub}</div>
              </div>
              <Toggle
                label={n.title}
                on={!prefs.muted.includes(n.key)}
                onChange={(on) => setPrefs({ muted: on ? prefs.muted.filter((k) => k !== n.key) : [...prefs.muted, n.key] })}
              />
            </div>
          ))}
        </div>
        <p className="small muted" style={{ margin: "0 4px", lineHeight: 1.45 }}>Мэтчи, приглашения, «скучаю» и дни рождения приходят всегда: это то, что делает половинка.</p>
      </div>
      <Section title="Данные и аккаунт" />
      <div className="stack">
        <button className="card tap row" style={{ width: "100%", textAlign: "left" }} onClick={() => setDataOpen(true)}>
          <ShieldCheck size={20} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Как мы храним данные</div>
            <div className="small muted">что лежит на сервере и кто это видит</div>
          </div>
        </button>
        {partner && !partner.ghost && (
          <button
            className="btn soft"
            onClick={async () => {
              if (!(await confirm(`Выйти из общего пространства? Всё общее останется у ${genitive(partner.name)}, у тебя начнётся новое пустое.`))) return;
              leave.mutate(undefined, { onSuccess: () => { store.toast("Готово: у тебя новое пустое пространство"); nav.tab("home"); } });
            }}
          >
            <LogOut size={17} /> Выйти из пары
          </button>
        )}
        <button
          className="btn danger"
          onClick={async () => {
            if (!(await confirm("Удалить аккаунт? Личное удалится сразу, это нельзя отменить."))) return;
            if (!(await confirm(partner && !partner.ghost ? "Точно? Общее останется у партнёра." : "Точно? Всё пространство сотрётся вместе с фото."))) return;
            await api("/me", { method: "DELETE" });
            store.toast("Аккаунт удалён");
            setTimeout(() => (tg?.close ? tg.close() : location.reload()), 900);
          }}
        >
          <Trash2 size={17} /> Удалить аккаунт
        </button>
      </div>
      <p className="center mono-sm" style={{ marginTop: 26 }}>Вдвоём · сделано для двоих · {new Date().getFullYear()}</p>
      <GhostSheet open={ghostOpen} onClose={() => setGhostOpen(false)} />
      <DataSheet open={dataOpen} onClose={() => setDataOpen(false)} />
    </>
  );
}

