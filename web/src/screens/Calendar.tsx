import { motion } from "motion/react";
import { CalendarSync, Camera, ChevronLeft, ChevronRight, ClipboardPaste, Clock, Copy, ImagePlus, Plus, RefreshCw, Smartphone, Sparkles, Trash2, Wifi } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, upload, useAct, useApi } from "../api.ts";
import { shrink } from "../media.ts";
import { useMe } from "../data.ts";
import {
  accusative, addDays, dayLabel, dayMonth, dative, duration, genitive, hhmm, human, MONTHS, nextYearly, parseHhmm, plural, repeatDates, today, WD, WD_FULL, weekday,
} from "../fmt.ts";
import { confirm, haptic, openLink } from "../tg.ts";
import { nav, store } from "../store.ts";
import { Empty, Field, Head, Pills, Section, Segmented, Sheet, Spinner, Toggle } from "../ui/kit.tsx";
import type { Block, EventRow, Win } from "../types.ts";
import { InviteSheet } from "./Sheets.tsx";
import { InvitePanel } from "./Invite.tsx";

const KIND_LABEL: Record<string, string> = {
  event: "Событие",
  date: "Свидание",
  trip: "Поездка",
  birthday: "День рождения",
  anniversary: "Годовщина",
};
const KIND_EMOJI: Record<string, string> = { event: "📌", date: "💞", trip: "✈️", birthday: "🎂", anniversary: "🥂" };

/** Разворачивает события в конкретные даты видимого диапазона (многодневные, ежегодные и повторяющиеся). */
function expand(events: EventRow[], from: string, to: string): Map<string, EventRow[]> {
  const map = new Map<string, EventRow[]>();
  const add = (d: string, e: EventRow) => {
    if (d < from || d > to) return;
    map.set(d, [...(map.get(d) ?? []), e]);
  };
  for (const e of events) {
    if (e.yearly) {
      add(nextYearly(e.date, from), e);
      continue;
    }
    if (e.repeat) {
      for (const d of repeatDates(e.date, e.repeat, from, to)) add(d, e);
      continue;
    }
    const last = e.end_date ?? e.date;
    for (let d = e.date; d <= last; d = addDays(d, 1)) add(d, e);
  }
  return map;
}

export function CalendarScreen() {
  const [phoneOpen, setPhoneOpen] = useState(false);
  const { me, partner, colorFor, shown } = useMe();
  const t = today();
  const [month, setMonth] = useState(t.slice(0, 7));
  const [sel, setSel] = useState(t);
  const [adding, setAdding] = useState<string | null>(null);
  const [invite, setInvite] = useState<Win | null>(null);
  // Пока половинки нет (или она только заготовка), звать на свидание некого — зовём в приложение
  const [inviteApp, setInviteApp] = useState(false);
  const solo = !partner || partner.ghost;
  const { data: ev } = useApi<{ events: EventRow[] }>(["events"], "/events");
  // Личные дела обоих (маникюр, зал): свои у каждого, но видно паре
  const { data: sch } = useApi<{ blocks: Block[] }>(["schedule"], "/schedule");
  const [picked, setPicked] = useState<{ b: Block; ghost: boolean } | null>(null);
  // Кто убрал у себя расписание, тому окна не считаем: без пар свободно всё подряд
  const { data: win } = useApi<{ windows: Win[] }>(["windows", 35], shown("schedule") ? "/schedule/windows?days=35&min=120" : null);

  const first = `${month}-01`;
  const startPad = weekday(first) - 1;
  const gridStart = addDays(first, -startPad);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const visible = days.filter((_, i) => i < 35 || days[35].slice(0, 7) === month);

  const byDay = useMemo(() => expand(ev?.events ?? [], visible[0], visible[visible.length - 1]), [ev, month]);
  const ownByDay = useMemo(
    () => personalByDay(sch?.blocks ?? [], [me?.id, partner?.id].filter((x): x is number => x != null), visible[0], visible[visible.length - 1]),
    [sch, month, me?.id, partner?.id],
  );
  const editable = (userId: number) => userId === me?.id || (!!partner?.ghost && userId === partner.id);
  const birthdays = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [me, partner]) if (p?.birthday) m.set(nextYearly(p.birthday, visible[0]), p.name);
    return m;
  }, [me, partner, month]);
  const freeDays = new Set((win?.windows ?? []).map((w) => w.date));

  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
    haptic.select();
  };

  const selEvents = byDay.get(sel) ?? [];
  const selOwn = ownByDay.get(sel) ?? [];
  const selWindows = (win?.windows ?? []).filter((w) => w.date === sel);
  const [y, m] = month.split("-").map(Number);

  return (
    <div className="screen">
      <Head
        caption={WD_FULL[weekday(t)] + ", " + dayMonth(t)}
        title="Календарь"
        actions={
          <>
            <button className="icon-btn" onClick={() => setPhoneOpen(true)} aria-label="В календарь телефона">
              <Smartphone size={19} />
            </button>
            <button className="icon-btn" onClick={() => setAdding(sel)} aria-label="Добавить">
              <Plus size={20} />
            </button>
          </>
        }
      />
      <PhoneCalendarSheet open={phoneOpen} onClose={() => setPhoneOpen(false)} />
      {shown("schedule") && (
      <div className="grid-2" style={{ marginBottom: 12 }}>
        <button className="card tap row" style={{ margin: 0, padding: 14 }} onClick={() => nav.push("windows")}>
          <div className="dot" style={{ ["--c" as string]: "var(--green)", width: 10, height: 10 }} />
          <div style={{ fontWeight: 600 }}>Когда свободны</div>
        </button>
        <button className="card tap row" style={{ margin: 0, padding: 14 }} onClick={() => nav.push("schedule")}>
          <Clock size={17} className="muted" />
          <div style={{ fontWeight: 600 }}>Расписание</div>
        </button>
      </div>
      )}

      <div className="card" style={{ padding: "16px 10px 10px" }}>
        <div className="row between" style={{ padding: "0 8px 12px" }}>
          <div className="title-md" style={{ textTransform: "capitalize" }}>
            {MONTHS[m - 1]} <span className="faint">{y !== Number(t.slice(0, 4)) ? y : ""}</span>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="icon-btn ghost" onClick={() => shift(-1)} aria-label="Раньше"><ChevronLeft size={20} /></button>
            <button className="icon-btn ghost" onClick={() => shift(1)} aria-label="Позже"><ChevronRight size={20} /></button>
          </div>
        </div>
        <div className="month">
          {WD.slice(1).map((w) => <div key={w} className="wd">{w}</div>)}
          {visible.map((d) => {
            const evs = byDay.get(d) ?? [];
            const own = ownByDay.get(d) ?? [];
            const bday = birthdays.get(d);
            return (
              <button
                key={d}
                className={`day${d.slice(0, 7) !== month ? " out" : ""}${d === t ? " today" : ""}${d === sel ? " sel" : ""}`}
                onClick={() => { setSel(d); haptic.select(); }}
              >
                {Number(d.slice(8))}
                <div className="dots">
                  {evs.slice(0, 3).map((e) => <i key={e.id} style={{ ["--c" as string]: e.kind === "date" ? "var(--pink)" : colorFor(e.author_id) }} />)}
                  {own.slice(0, Math.max(0, 3 - evs.length)).map((b) => <i key={`s${b.id}`} style={{ ["--c" as string]: colorFor(b.user_id) }} />)}
                  {bday && <i style={{ ["--c" as string]: "var(--amber)" }} />}
                </div>
                {freeDays.has(d) && d >= t && <div className="freebar" />}
              </button>
            );
          })}
        </div>
      </div>

      <Section
        title={dayLabel(sel)}
        action={<button className="link" onClick={() => nav.push("day", { date: sel })}>По часам</button>}
      />
      <div className="stack">
        {birthdays.get(sel) && (
          <div className="card row" style={{ padding: 14 }}>
            <span style={{ fontSize: 22 }}>🎂</span>
            <div style={{ fontWeight: 600 }}>День рождения {genitive(birthdays.get(sel)!)}</div>
          </div>
        )}
        {selEvents.map((e) => (
          <EventCard key={e.id} e={e} color={colorFor(e.author_id)} />
        ))}
        {selOwn.map((b) => (
          <PersonalCard key={b.id} b={b} onOpen={editable(b.user_id) ? () => setPicked({ b, ghost: b.user_id !== me?.id }) : undefined} />
        ))}
        {selWindows.map((w) => (
          <div key={w.start} className="card row" style={{ padding: 14, background: "color-mix(in srgb, var(--green) 10%, var(--card))" }}>
            <div className="dot" style={{ ["--c" as string]: "var(--green)" }} />
            <div className="grow">
              {/* Без половинки «оба» звучит странно, а «Позвать» вело в пустую шторку свидания (тест 11.10.2026) */}
              <div style={{ fontWeight: 600 }}>{partner ? "Оба свободны" : "Свободно"} {hhmm(w.start)}–{hhmm(w.end)}</div>
              <div className="mono-sm">{duration(w.end - w.start)}</div>
            </div>
            {solo ? (
              <button className="btn sm inline tint" style={{ ["--c" as string]: "var(--green)" }} onClick={() => setInviteApp(true)}>
                {partner ? `Позвать ${accusative(partner.name)}` : "Позвать половинку"}
              </button>
            ) : (
              <button className="btn sm inline tint" style={{ ["--c" as string]: "var(--green)" }} onClick={() => setInvite(w)}>
                Позвать
              </button>
            )}
          </div>
        ))}
        {!selEvents.length && !selOwn.length && !selWindows.length && !birthdays.get(sel) && (
          <button className="card tap muted center" style={{ width: "100%" }} onClick={() => setAdding(sel)}>
            Ничего не запланировано. Добавить?
          </button>
        )}
      </div>
      <EventSheet preset={adding} onClose={() => setAdding(null)} />
      <InviteSheet win={invite} onClose={() => setInvite(null)} />
      <Sheet open={inviteApp} onClose={() => setInviteApp(false)} title={partner ? `Позови ${accusative(partner.name)} во «Вдвоём»` : "Позови половинку"}>
        <p className="small muted" style={{ marginTop: -6, lineHeight: 1.45 }}>
          Звать на свидание пока некого: {partner ? `${partner.name} ещё нет в приложении` : "половинки ещё нет в приложении"}. Когда половинка откроет ссылку, в календаре появятся ваши общие окна, и звать можно будет прямо отсюда.
        </p>
        <InvitePanel compact withGhost={!partner} />
      </Sheet>
      <BlockSheet picked={picked} date={sel} onClose={() => setPicked(null)} />
    </div>
  );
}

/**
 * Какие записи расписания показывать в календаре как личные дела: внесённые
 * руками разовые (маникюр, врач, смена) и еженедельные из «своих» разделов
 * (зал, уход). Пары и работа по неделям остаются в «Расписании» — иначе ими
 * был бы забит каждый будний день.
 */
const inCalendar = (b: Block): boolean =>
  b.source === "manual" && !b.skip && (b.kind === "once" || PERSONAL.includes(b.category));

function personalByDay(blocks: Block[], ids: number[], from: string, to: string): Map<string, Block[]> {
  const map = new Map<string, Block[]>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const list = ids.flatMap((id) => blocksOn(blocks, id, d)).filter(inCalendar).sort((a, b) => a.start_min - b.start_min);
    if (list.length) map.set(d, list);
  }
  return map;
}

/** Личное дело в списке дня: цвет и подпись владельца — «у тебя» или имя. */
function PersonalCard({ b, onOpen }: { b: Block; onOpen?: () => void }) {
  const { me, partner, colorFor } = useMe();
  const color = colorFor(b.user_id);
  const body = (
    <>
      <span className="emoji" style={{ fontSize: 22 }}>{catEmoji(b.category)}</span>
      <div className="grow">
        <div style={{ fontWeight: 700 }}>{b.title || catName(b.category)}</div>
        <div className="mono-sm">
          {hhmm(b.start_min)}–{hhmm(b.end_min)}
          {" · "}
          <b style={{ color }}>{b.user_id === me?.id ? "у тебя" : partner?.name ?? ""}</b>
          {b.kind === "weekly" ? " · каждую неделю" : ""}
        </div>
      </div>
    </>
  );
  const style = { padding: 14, ["--edge" as string]: color, width: "100%", textAlign: "left" as const };
  return onOpen ? (
    <button className="card tap row accent-left" style={style} onClick={onOpen}>
      {body}
      <ChevronRight size={18} className="faint" />
    </button>
  ) : (
    <div className="card row accent-left" style={style}>{body}</div>
  );
}

const REPEAT_LABEL: Record<string, string> = { week: "каждую неделю", month: "каждый месяц" };
const REPEATS: [string, string][] = [["", "не повторять"], ["week", "каждую неделю"], ["month", "каждый месяц"], ["year", "каждый год"]];

const STATUS_LABEL: Record<string, string> = { proposed: "ждём ответа", accepted: "идёте 💞", declined: "не получится" };

function EventCard({ e, color }: { e: EventRow; color: string }) {
  const { me } = useMe();
  const del = useAct(() => api(`/events/${e.id}`, { method: "DELETE" }), ["events", "home"]);
  const rsvp = useAct((yes: boolean) => api(`/events/${e.id}/rsvp`, { body: { yes } }), ["events", "home"]);
  return (
    <div className="card row accent-left" style={{ padding: 14, ["--edge" as string]: e.kind === "date" ? "var(--rose)" : color, opacity: e.status === "declined" ? 0.55 : 1 }}>
      <span className="emoji" style={{ fontSize: 22 }}>{KIND_EMOJI[e.kind] ?? "📌"}</span>
      <div className="grow">
        <div style={{ fontWeight: 700 }}>{e.title}</div>
        <div className="mono-sm">
          {e.start_min != null ? `${hhmm(e.start_min)}${e.end_min != null ? "–" + hhmm(e.end_min) : ""}` : "весь день"}
          {e.end_date && e.end_date !== e.date ? ` · до ${dayMonth(e.end_date)}` : ""}
          {e.yearly ? " · каждый год" : ""}
          {e.repeat ? ` · ${REPEAT_LABEL[e.repeat] ?? ""}` : ""}
          {e.status ? ` · ${STATUS_LABEL[e.status]}` : ""}
        </div>
        {e.note && <div className="small muted" style={{ marginTop: 4 }}>{e.note}</div>}
        {e.status === "proposed" && e.author_id !== me?.id && (
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            <button className="btn sm inline" onClick={() => rsvp.mutate(true)}>💞 Иду</button>
            <button className="btn sm inline soft" onClick={() => rsvp.mutate(false)}>Не получится</button>
          </div>
        )}
      </div>
      <button className="icon-btn ghost" onClick={async () => (await confirm("Удалить событие?")) && del.mutate()} aria-label="Удалить">
        <Trash2 size={17} className="faint" />
      </button>
    </div>
  );
}

/** preset: "YYYY-MM-DD" или "YYYY-MM-DD|start|end" — из окна сразу подставляется время. */
export function EventSheet({ preset, onClose, title: presetTitle }: { preset: string | null; onClose: () => void; title?: string }) {
  const [d, s, e] = (preset ?? "").split("|");
  // «Вместе» — общее событие пары, «Только я» — своё дело в расписании (08.10.2026)
  const [mode, setMode] = useState<"pair" | "solo">("pair");
  useEffect(() => {
    if (preset) setMode("pair");
  }, [preset]);
  const start = s ? Number(s) : null;
  const end = e ? Number(e) : null;
  return (
    <Sheet open={!!preset} onClose={onClose} title={mode === "solo" ? "Своё дело" : "Новое событие"}>
      {preset && <Segmented value={mode} onChange={setMode} items={[["pair", "Вместе"], ["solo", "Только я"]]} />}
      {preset && mode === "pair" && <EventForm key={preset} date={d} start={start} end={end} presetTitle={presetTitle} onDone={onClose} />}
      {preset && mode === "solo" && <SoloForm key={preset} date={d} start={start} end={end} onDone={onClose} />}
    </Sheet>
  );
}

/** Быстрые заготовки личных дел: касание заполняет название и раздел. */
// Первым — нейтральное: «Маникюр» первой подсказкой для парня звучал странно (тест 11.10.2026)
const SOLO_PRESETS: [string, string][] = [["Зал", "sport"], ["Врач", "health"], ["Друзья", "friends"], ["Стрижка", "beauty"], ["Маникюр", "beauty"]];
// Пары и работа по неделям живут в «Расписании»; здесь — то, что видно в календаре
const SOLO_CATS = ["beauty", "sport", "health", "errands", "friends", "other"];

/** Своё дело: маникюр, зал, врач. Ложится в расписание, окна его обходят, партнёру видно. */
function SoloForm({ date, start, end, onDone }: { date: string; start: number | null; end: number | null; onDone: () => void }) {
  const { partner } = useMe();
  const [who, setWho] = useState("me");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [d, setD] = useState(date);
  const [from, setFrom] = useState(start != null ? hhmm(start) : "");
  const [to, setTo] = useState(end != null ? hhmm(end) : "");
  const [repeat, setRepeat] = useState("once");
  const add = useAct(
    () =>
      api(`/schedule${who === "partner" ? "?for=partner" : ""}`, {
        body: {
          kind: repeat === "week" ? "weekly" : "once", weekday: weekday(d), date: d,
          start_min: parseHhmm(from), end_min: parseHhmm(to), title: title.trim(), category,
        },
      }),
    ["schedule", "windows", "home"],
  );
  const a = parseHhmm(from);
  const b = parseHhmm(to);
  const ok = !!title.trim() && !!d && a != null && b != null && b > a;
  return (
    <>
      <div className="pills scroll" role="group" aria-label="Заготовки">
        {SOLO_PRESETS.map(([t, c]) => (
          <button key={t} className={`pill${title === t ? " on" : ""}`} onClick={() => { setTitle(t); setCategory(c); haptic.select(); }}>
            {t}
          </button>
        ))}
      </div>
      <Field label="Что">
        <input className="input" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Маникюр" />
      </Field>
      <Pills value={category} onChange={setCategory} scroll items={SOLO_CATS.map((k) => [k, CATEGORY[k]])} />
      <Field label="Когда">
        <input className="input" type="date" value={d} onChange={(ev) => setD(ev.target.value)} />
      </Field>
      <div className="grid-2">
        <Field label="Начало">
          <input className="input" aria-label="С" type="time" value={from} onChange={(ev) => setFrom(ev.target.value)} />
        </Field>
        <Field label="Конец">
          <input className="input" aria-label="До" type="time" value={to} onChange={(ev) => setTo(ev.target.value)} />
        </Field>
      </div>
      <Field label="Повтор">
        <Pills value={repeat} onChange={setRepeat} items={[["once", "один раз"], ["week", d ? `каждую неделю, ${WD[weekday(d)]}` : "каждую неделю"]]} />
      </Field>
      {partner?.ghost && (
        <Field label="Чьё">
          <Pills value={who} onChange={setWho} items={[["me", "Моё"], ["partner", partner.name]]} />
        </Field>
      )}
      <p className="small muted" style={{ marginTop: -4 }}>Видно вам обоим. В «Когда свободны» это время занято.</p>
      <button
        className="btn"
        disabled={!ok || add.isPending}
        onClick={() =>
          add.mutate(undefined, {
            onSuccess: () => {
              haptic.success();
              store.toast(repeat === "week" ? `Каждую неделю: ${WD[weekday(d)]} ${from}` : "Добавлено");
              onDone();
            },
          })
        }
      >
        Добавить
      </button>
    </>
  );
}

function EventForm({ date, start, end, presetTitle, onDone }: { date: string; start: number | null; end: number | null; presetTitle?: string; onDone: () => void }) {
  const [kind, setKind] = useState(start != null ? "date" : "event");
  const [title, setTitle] = useState(presetTitle ?? (start != null ? "Свидание" : ""));
  const [d, setD] = useState(date);
  const [endDate, setEndDate] = useState("");
  const [from, setFrom] = useState(start != null ? hhmm(start) : "");
  const [to, setTo] = useState(end != null ? hhmm(end) : "");
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState("");
  const canRepeat = kind === "event" || kind === "date";
  const save = useAct(
    () =>
      api("/events", {
        body: {
          kind, title, date: d, end_date: kind === "trip" && endDate ? endDate : null,
          start_min: parseHhmm(from), end_min: parseHhmm(to), note, repeat: canRepeat && repeat ? repeat : null,
        },
      }),
    ["events", "home"],
  );
  return (
    <>
      <Pills value={kind} onChange={setKind} scroll items={Object.entries(KIND_LABEL).map(([k, v]) => [k, `${KIND_EMOJI[k]} ${v}`])} />
      <Field label="Что">
        <input className="input" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder={kind === "trip" ? "Питер на выходные" : "Ужин у мамы"} />
      </Field>
      <div className="grid-2">
        <Field label={kind === "trip" ? "С" : "Когда"}>
          <input className="input" type="date" value={d} onChange={(ev) => setD(ev.target.value)} />
        </Field>
        {kind === "trip" ? (
          <Field label="По">
            <input className="input" type="date" min={d} value={endDate} onChange={(ev) => setEndDate(ev.target.value)} />
          </Field>
        ) : (
          <div />
        )}
      </div>
      {kind !== "birthday" && kind !== "anniversary" && kind !== "trip" && (
        <div className="grid-2">
          <Field label="Начало">
            <input className="input" aria-label="С" type="time" value={from} onChange={(ev) => setFrom(ev.target.value)} />
          </Field>
          <Field label="Конец">
            <input className="input" aria-label="До" type="time" value={to} onChange={(ev) => setTo(ev.target.value)} />
          </Field>
        </div>
      )}
      {(kind === "birthday" || kind === "anniversary") && <p className="small muted" style={{ marginTop: -4 }}>Повторяется каждый год, бот напомнит заранее.</p>}
      {canRepeat && (
        <Field label="Повтор">
          <Pills value={repeat} onChange={setRepeat} scroll items={REPEATS} />
        </Field>
      )}
      {canRepeat && repeat === "month" && Number(d.slice(8)) > 28 && (
        <p className="small muted" style={{ marginTop: -4 }}>В месяцах, где нет {Number(d.slice(8))}-го числа, событие пропустится.</p>
      )}
      <Field label="Заметка">
        <input className="input" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Необязательно" />
      </Field>
      <button className="btn" disabled={!title.trim() || !d || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { haptic.success(); onDone(); } })}>
        Добавить
      </button>
    </>
  );
}

// ——— день по часам ———

const DAY_FROM = 8 * 60;
const DAY_TO = 23 * 60;
const PX_PER_MIN = 1.1;

function blocksOn(blocks: Block[], userId: number, date: string): Block[] {
  const wd = weekday(date);
  const freed = blocks.filter((b) => b.user_id === userId && b.kind === "free" && b.date === date);
  return blocks.filter(
    (b) =>
      b.user_id === userId &&
      ((b.kind === "weekly" && b.weekday === wd) || (b.kind === "once" && b.date === date)) &&
      !freed.some((f) => f.start_min <= b.start_min && f.end_min >= b.end_min),
  );
}

export function DayScreen({ date }: { date: string }) {
  const { me, partner, colorFor } = useMe();
  const { data: sch } = useApi<{ blocks: Block[] }>(["schedule"], "/schedule");
  const { data: win } = useApi<{ windows: Win[] }>(["windows", 35], "/schedule/windows?days=35&min=120");
  const { data: ev } = useApi<{ events: EventRow[] }>(["events"], "/events");
  const [adding, setAdding] = useState<string | null>(null);
  const [invite, setInvite] = useState<Win | null>(null);
  const [picked, setPicked] = useState<{ b: Block; ghost: boolean } | null>(null);
  const [busyOpen, setBusyOpen] = useState(false);
  const [d, setD] = useState(date);

  const blocks = sch?.blocks ?? [];
  // Править можно своё расписание и расписание половинки-заготовки
  const editable = (userId: number) => userId === me?.id || (!!partner?.ghost && userId === partner.id);
  const cols = [me, partner].filter(Boolean) as NonNullable<typeof me>[];
  const events = expand(ev?.events ?? [], d, d).get(d) ?? [];
  const windows = (win?.windows ?? []).filter((w) => w.date === d);
  const y = (min: number) => (Math.max(DAY_FROM, Math.min(DAY_TO, min)) - DAY_FROM) * PX_PER_MIN;
  const hours = Array.from({ length: (DAY_TO - DAY_FROM) / 60 + 1 }, (_, i) => DAY_FROM + i * 60);

  return (
    <>
      <Head back caption={WD_FULL[weekday(d)]} title={dayMonth(d)} actions={
        <>
          <button className="icon-btn" onClick={() => setD(addDays(d, -1))} aria-label="Вчера"><ChevronLeft size={20} /></button>
          <button className="icon-btn" onClick={() => setD(addDays(d, 1))} aria-label="Завтра"><ChevronRight size={20} /></button>
        </>
      } />
      {events.length > 0 && (
        <div className="stack" style={{ marginBottom: 14 }}>
          {events.map((e) => <EventCard key={e.id} e={e} color={colorFor(e.author_id)} />)}
        </div>
      )}
      <div className="card" style={{ padding: "16px 12px 16px 8px" }}>
        <div className="timeline" style={{ marginBottom: 10 }}>
          <div />
          {cols.map((p) => (
            <div key={p.id} className="caps center" style={{ color: colorFor(p.id) }}>{p.id === me?.id ? "я" : p.name}</div>
          ))}
          {cols.length === 1 && <div className="caps center faint">половинка</div>}
        </div>
        <div className="timeline" style={{ height: y(DAY_TO) }}>
          <div style={{ position: "relative" }}>
            {hours.map((h) => (
              <div key={h} className="hour" style={{ position: "absolute", top: y(h) }}>{hhmm(h)}</div>
            ))}
          </div>
          {[0, 1].map((i) => {
            const p = cols[i];
            return (
              <div key={i} className="col">
                {p &&
                  blocksOn(blocks, p.id, d).map((b) => (
                    <button
                      key={b.id}
                      className={`blk${b.skip ? " skip" : ""}`}
                      style={{ top: y(b.start_min), height: Math.max(22, y(b.end_min) - y(b.start_min) - 2), ["--c" as string]: colorFor(p.id), textAlign: "left", color: "var(--text)" }}
                      onClick={() => editable(p.id) && setPicked({ b, ghost: p.id !== me?.id })}
                    >
                      <div style={{ fontWeight: 700 }}>{hhmm(b.start_min)}{b.online ? " · онлайн" : ""}{b.skip ? " · не хожу" : ""}</div>
                      <div className="ellipsis">{b.title || "Занято"}</div>
                    </button>
                  ))}
              </div>
            );
          })}
          {windows.map((w) => (
            <button
              key={w.start}
              className="free"
              style={{ top: y(w.start), height: y(w.end) - y(w.start), pointerEvents: "auto", display: "grid", placeItems: "center" }}
              onClick={() => setInvite(w)}
            >
              <span className="chip solid" style={{ ["--c" as string]: "var(--green)", background: "var(--card)" }}>
                оба свободны · {duration(w.end - w.start)} · позвать
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <button className="btn soft" onClick={() => setBusyOpen(true)}>Занятость</button>
        <button className="btn soft" onClick={() => setAdding(d)}>Событие</button>
      </div>
      <p className="small muted center">Нажми на пару, чтобы отменить её на этот день. Пунктир — пары, на которые не ходим, зелёное — общее время с учётом дороги.</p>
      <EventSheet preset={adding} onClose={() => setAdding(null)} />
      <InviteSheet win={invite} onClose={() => setInvite(null)} />
      <BlockSheet picked={picked} date={d} onClose={() => setPicked(null)} />
      <BusySheet open={busyOpen} date={d} onClose={() => setBusyOpen(false)} />
    </>
  );
}

const CATEGORY: Record<string, string> = {
  class: "📚 Пары", work: "💼 Работа", tutoring: "🧑‍🏫 Занятия", sport: "🏃 Спорт",
  beauty: "💅 Уход", health: "🩺 Здоровье", errands: "🛒 Дела", friends: "👯 Друзья", other: "📌 Другое",
};
/** Разделы личных дел: еженедельные из них видно в календаре (пары и работа — только в расписании). */
const PERSONAL = ["sport", "beauty", "health", "errands", "friends", "other"];
const catEmoji = (k: string) => (CATEGORY[k] ?? CATEGORY.other).split(" ")[0];
const catName = (k: string) => (CATEGORY[k] ?? CATEGORY.other).split(" ").slice(1).join(" ");

/** Что сделать с парой или личным делом в конкретный день: отменить, поменять, удалить. */
function BlockSheet({ picked, date, onClose }: { picked: { b: Block; ghost: boolean } | null; date: string; onClose: () => void }) {
  const b = picked?.b;
  return (
    <Sheet open={!!picked} onClose={onClose} title={b?.title || "Занятость"}>
      {picked && <BlockActions key={picked.b.id} picked={picked} date={date} onClose={onClose} />}
    </Sheet>
  );
}

function BlockActions({ picked, date, onClose }: { picked: { b: Block; ghost: boolean }; date: string; onClose: () => void }) {
  const b = picked.b;
  const q = picked.ghost ? "?for=partner" : "";
  const inv = ["schedule", "windows", "home"];
  const cancel = useAct(() => api(`/schedule${q}`, { body: { kind: "free", date, start_min: b.start_min, end_min: b.end_min, title: "отменено" } }), inv);
  const skip = useAct(() => api(`/schedule/${b.id}${q}`, { method: "PATCH", body: { skip: !b.skip } }), inv);
  const del = useAct(() => api(`/schedule/${b.id}${q}`, { method: "DELETE" }), inv);
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(b.title);
  const [category, setCategory] = useState(b.category ?? "other");
  const [d, setD] = useState(b.date ?? date);
  const [from, setFrom] = useState(hhmm(b.start_min));
  const [to, setTo] = useState(hhmm(b.end_min));
  const save = useAct(
    () =>
      api(`/schedule/${b.id}${q}`, {
        method: "PATCH",
        body: { title: title.trim(), category, start_min: parseHhmm(from), end_min: parseHhmm(to), ...(b.kind === "once" ? { date: d } : {}) },
      }),
    inv,
  );
  const a = parseHhmm(from);
  const z = parseHhmm(to);
  const ok = a != null && z != null && z > a && (b.kind !== "once" || !!d);
  if (edit)
    return (
      <>
        <Field label="Что"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Pills value={category} onChange={setCategory} scroll items={Object.entries(CATEGORY).map(([k, v]) => [k, v])} />
        {b.kind === "once" && <Field label="Когда"><input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>}
        <div className="grid-2">
          <Field label="Начало"><input className="input" aria-label="С" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Конец"><input className="input" aria-label="До" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <button className="btn" disabled={!ok || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { haptic.success(); store.toast("Сохранено"); onClose(); } })}>
          Сохранить
        </button>
      </>
    );
  return (
    <>
      <div className="small muted" style={{ marginTop: -8, marginBottom: 16 }}>
        {hhmm(b.start_min)}–{hhmm(b.end_min)}
        {b.place ? ` · ${b.place}` : ""}
        {b.kind === "weekly" ? " · каждую неделю" : ` · ${dayMonth(b.date!)}`}
        {b.category && b.category !== "class" ? ` · ${catName(b.category)}` : ""}
      </div>
      <div className="stack">
        {b.kind === "weekly" || b.source === "rea" ? (
          <button className="btn" onClick={() => cancel.mutate(undefined, { onSuccess: () => { haptic.success(); store.toast("Отменено на этот день"); onClose(); } })}>
            Отменили / не иду {dayMonth(date)}
          </button>
        ) : null}
        {b.source === "manual" && (
          <button className="btn soft" onClick={() => setEdit(true)}>Изменить</button>
        )}
        {/* Разовое своё дело проще удалить, чем «не ходить» на него */}
        {(b.kind === "weekly" || b.source !== "manual") && (
          <button className="btn soft" onClick={() => skip.mutate(undefined, { onSuccess: onClose })}>
            {b.skip ? "Снова хожу на неё" : "Не хожу на неё вообще"}
          </button>
        )}
        {b.source === "manual" && (
          <button className="btn danger" onClick={() => del.mutate(undefined, { onSuccess: () => { store.toast("Удалено"); onClose(); } })}>
            <Trash2 size={17} /> Удалить {b.kind === "weekly" ? "из расписания" : ""}
          </button>
        )}
      </div>
    </>
  );
}

/** Разовая занятость на дату: смена, занятие с учеником, врач. */
function BusySheet({ open, date, onClose }: { open: boolean; date: string; onClose: () => void }) {
  const { partner } = useMe();
  const [who, setWho] = useState("me");
  const [category, setCategory] = useState("work");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [d, setD] = useState(date);
  const add = useAct(
    () =>
      api(`/schedule${who === "partner" ? "?for=partner" : ""}`, {
        body: { kind: "once", date: d, start_min: parseHhmm(from), end_min: parseHhmm(to), title: title || CATEGORY[category].slice(3), category },
      }),
    ["schedule", "windows", "home"],
  );
  const ok = parseHhmm(from) != null && parseHhmm(to) != null && parseHhmm(to)! > parseHhmm(from)!;
  return (
    <Sheet open={open} onClose={onClose} title="Занятость на день">
      {partner?.ghost && <Segmented value={who} onChange={setWho} items={[["me", "Я"], ["partner", partner.name]]} />}
      <Pills value={category} onChange={setCategory} scroll items={Object.entries(CATEGORY).map(([k, v]) => [k, v])} />
      <Field label="Когда"><input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
      <div className="grid-2">
        <Field label="С"><input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="До"><input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Field label="Что"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Занятие с учеником" /></Field>
      <button className="btn" disabled={!ok || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); setTitle(""); onClose(); } })}>
        Добавить
      </button>
    </Sheet>
  );
}

// ——— общие окна ———

const IDEA_MIN: Record<string, number> = { "2h": 150, half: 240, day: 480, night: 900 };

export function WindowsScreen({ idea }: { idea?: { title?: string; duration?: string; emoji?: string } }) {
  const [view, setView] = useState<"picture" | "list">(idea ? "list" : "picture");
  return (
    <>
      <Head back caption="по расписанию обоих" title="Когда свободны" />
      <GapPicker compact />
      <Segmented value={view} onChange={setView} items={[["picture", "Вся картина"], ["list", "Общие окна"]]} />
      {view === "picture" ? <WeekPicture /> : <WindowsList idea={idea} />}
    </>
  );
}

interface DayPart {
  busy: { start: number; end: number; title: string; online: boolean; skip: boolean; category: string }[];
  free: { start: number; end: number }[];
}
interface DayInfo {
  date: string;
  me: DayPart;
  partner: DayPart | null;
  common: { start: number; end: number }[];
}

const PIC_FROM = 8 * 60;
const PIC_TO = 23 * 60;
const pct = (m: number) => `${((Math.max(PIC_FROM, Math.min(PIC_TO, m)) - PIC_FROM) / (PIC_TO - PIC_FROM)) * 100}%`;
const span = (a: number, b: number) => ({ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` });

/**
 * Две недели одним взглядом: у каждого дня две дорожки 8:00–23:00 — сверху
 * мои пары, снизу её; пустое — свободно, зелёное — общее время с дорогой.
 * Касание раскрывает день: промежутки между парами у каждого и общие окна.
 */
function WeekPicture() {
  const { me, partner, meColor, theyColor } = useMe();
  const { data } = useApi<{ days: DayInfo[] }>(["windows", "days"], "/schedule/days?days=14");
  // Все дни свёрнуты: сначала вся картина, подробности — касанием по дню
  const [open, setOpen] = useState<string | null>(null);
  const [invite, setInvite] = useState<Win | null>(null);
  if (!data) return <Spinner />;
  const ticks = [8, 11, 14, 17, 20, 23];
  return (
    <>
      <div className="row" style={{ gap: 14, margin: "0 4px 12px", flexWrap: "wrap" }}>
        <span className="small row" style={{ gap: 6 }}><i className="dot" style={{ ["--c" as string]: meColor }} /> ты</span>
        {partner && <span className="small row" style={{ gap: 6 }}><i className="dot" style={{ ["--c" as string]: theyColor }} /> {partner.name}</span>}
        <span className="small row" style={{ gap: 6 }}><i className="dot" style={{ ["--c" as string]: "var(--mint)" }} /> оба свободны</span>
      </div>
      <div className="week">
        <div className="week-axis">
          <div />
          <div className="axis">
            {ticks.map((h) => (
              <span key={h} style={{ left: pct(h * 60) }}>{h}</span>
            ))}
          </div>
        </div>
        {data.days.map((d) => {
          const isOpen = open === d.date;
          const wd = weekday(d.date);
          return (
            <div key={d.date} className={`week-day${wd >= 6 ? " weekend" : ""}${isOpen ? " open" : ""}`}>
              <button className="week-row" onClick={() => { haptic.select(); setOpen(isOpen ? null : d.date); }}>
                <div className="week-label">
                  <div style={{ fontWeight: 800 }}>{WD[wd]}</div>
                  <div className="muted">{Number(d.date.slice(8))}</div>
                </div>
                <div className="lanes">
                  {d.common.map((c) => <div key={c.start} className="common" style={span(c.start, c.end)} />)}
                  {[d.me, d.partner].map((p, i) =>
                    p ? (
                      <div key={i} className="lane">
                        {p.busy.map((b, j) => (
                          <div key={j} className={`seg${b.skip ? " skip" : ""}${b.online ? " online" : ""}`} style={{ ...span(b.start, b.end), ["--c" as string]: i ? theyColor : meColor }} />
                        ))}
                      </div>
                    ) : (
                      <div key={i} className="lane empty" />
                    ),
                  )}
                </div>
              </button>
              {isOpen && (
                <div className="week-detail">
                  {[
                    [me, d.me, meColor],
                    [partner, d.partner, theyColor],
                  ].map(([p, part, color], i) =>
                    p && part ? (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <div className="small" style={{ fontWeight: 750, color: color as string, marginBottom: 4 }}>
                          {i ? (p as { name: string }).name : "Ты"}
                          <span className="muted" style={{ fontWeight: 600 }}>
                            {" · "}
                            {(part as DayPart).busy.filter((b) => !b.skip).length
                              ? `пары ${hhmm((part as DayPart).busy.filter((b) => !b.skip)[0].start)}–${hhmm(Math.max(...(part as DayPart).busy.filter((b) => !b.skip).map((b) => b.end)))}`
                              : "без пар"}
                          </span>
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          {(part as DayPart).free.map((f) => (
                            <span key={f.start} className="chip">
                              {f.end >= PIC_TO && f.start > PIC_FROM ? `после ${hhmm(f.start)}` : f.start <= PIC_FROM && f.end < PIC_TO ? `до ${hhmm(f.end)}` : `${hhmm(f.start)}–${hhmm(f.end)}`}
                              {" · "}
                              {duration(f.end - f.start)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null,
                  )}
                  {d.common.length ? (
                    <div className="stack" style={{ marginTop: 4 }}>
                      {d.common.map((c) => (
                        <button key={c.start} className="card flat row" style={{ width: "100%", textAlign: "left", padding: 10, margin: 0 }} onClick={() => setInvite({ date: d.date, start: c.start, end: c.end, score: 0 })}>
                          <i className="dot" style={{ ["--c" as string]: "var(--mint)" }} />
                          <div className="grow" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>Вместе {hhmm(c.start)}–{hhmm(c.end)}</div>
                          <span className="small muted">{duration(c.end - c.start)}</span>
                          <span className="link small">позвать</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    partner && <div className="small muted">Общего времени с учётом дороги в этот день нет</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="small muted center">Пустое — свободно. Пунктир — пара, на которую не ходим, бледное — онлайн. Зелёное — общее время с учётом дороги.</p>
      <InviteSheet win={invite} onClose={() => setInvite(null)} />
    </>
  );
}

function WindowsList({ idea }: { idea?: { title?: string; duration?: string; emoji?: string } }) {
  const { partner } = useMe();
  const [minH, setMinH] = useState(idea?.duration ? String(Math.ceil(IDEA_MIN[idea.duration] / 60)) : "2");
  const { data } = useApi<{ windows: Win[] }>(["windows", "list", minH], `/schedule/windows?days=21&min=${Number(minH) * 60}`);
  const [invite, setInvite] = useState<Win | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Win[]>();
    for (const w of data?.windows ?? []) m.set(w.date, [...(m.get(w.date) ?? []), w]);
    return [...m.entries()];
  }, [data]);

  return (
    <>
      {!partner && <p className="small muted" style={{ margin: "-4px 4px 12px" }}>Пока только твоё расписание — позови половинку или внеси её расписание заранее.</p>}
      {idea && (
        <div className="card row" style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 30 }}>{idea.emoji ?? "💡"}</span>
          <div>
            <div className="title-md">{idea.title}</div>
            <div className="small muted">Выбери окно — позовём на свидание</div>
          </div>
        </div>
      )}
      <Pills value={minH} onChange={setMinH} items={[["1", "от 1 часа"], ["2", "от 2 часов"], ["4", "полдня"], ["8", "целый день"]]} />
      {!data ? (
        <Spinner />
      ) : !groups.length ? (
        <Empty art="calendar" title="Нет подходящих окон" text="Попробуй окно покороче или проверь расписание — может, стоит отметить пары, на которые не ходишь." />
      ) : (
        groups.map(([date, ws]) => (
          <div key={date}>
            <Section title={dayLabel(date)} />
            <div className="stack">
              {ws.map((w) => (
                <motion.button
                  key={w.start}
                  whileTap={{ scale: 0.98 }}
                  className="card row"
                  style={{ width: "100%", textAlign: "left", padding: 14 }}
                  onClick={() => setInvite(w)}
                >
                  <div className="dot" style={{ ["--c" as string]: "var(--green)" }} />
                  <div className="grow">
                    <div className="num" style={{ fontSize: 18 }}>{hhmm(w.start)} – {hhmm(w.end)}</div>
                  </div>
                  <span className="mono-sm">{duration(w.end - w.start)}</span>
                  <Plus size={18} className="faint" />
                </motion.button>
              ))}
            </div>
          </div>
        ))
      )}
      <InviteSheet win={invite} idea={idea ? ({ ...idea, id: String((idea as { id?: string }).id ?? "") } as Record<string, unknown> & { id: string }) : null} onClose={() => setInvite(null)} />
    </>
  );
}

// ——— расписание ———

const GRIDS: Record<string, [number, number][]> = {
  "ВШЭ": [[570, 650], [670, 750], [780, 860], [880, 960], [980, 1060], [1090, 1170], [1180, 1260]],
  "РЭУ": [[510, 600], [610, 700], [710, 800], [840, 930], [940, 1030], [1040, 1130], [1140, 1230]],
};

export function ScheduleScreen() {
  const { me, partner, colorFor } = useMe();
  const [whose, setWhose] = useState<"me" | "partner">("me");
  const { data } = useApi<{ blocks: Block[] }>(["schedule"], "/schedule");
  const [adding, setAdding] = useState(false);
  const { data: meData } = useMe();
  const [importing, setImporting] = useState(false);
  const person = whose === "me" ? me : partner;
  // «mine» здесь — «можно править»: своё или половинки, которая ещё не зашла
  const mine = whose === "me" || !!partner?.ghost;
  const q = whose === "partner" ? "?for=partner" : "";
  const all = (data?.blocks ?? []).filter((b) => b.user_id === person?.id);
  const weekly = all.filter((b) => b.kind === "weekly");
  const rea = all.filter((b) => b.kind === "once" && b.date && b.date >= today()).slice(0, 80);

  const patch = useAct((v: { id: number; body: Record<string, unknown> }) => api(`/schedule/${v.id}${q}`, { method: "PATCH", body: v.body }), ["schedule", "windows", "home"]);
  const del = useAct((id: number) => api(`/schedule/${id}${q}`, { method: "DELETE" }), ["schedule", "windows", "home"]);

  const reaDays = useMemo(() => {
    const m = new Map<string, Block[]>();
    for (const b of rea) m.set(b.date!, [...(m.get(b.date!) ?? []), b]);
    return [...m.entries()].slice(0, 14);
  }, [rea]);

  const Row = ({ b }: { b: Block }) => (
    <div className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line)", opacity: b.skip ? 0.5 : 1 }}>
      <div className="num" style={{ fontSize: 14, width: 96, flexShrink: 0 }}>{hhmm(b.start_min)}–{hhmm(b.end_min)}</div>
      <div className="grow">
        <div className="small ellipsis" style={{ fontWeight: 600, textDecoration: b.skip ? "line-through" : "none" }}>{b.title || "Пара"}</div>
        <div className="mono-sm ellipsis">
          {b.online ? "вебинар · " : ""}
          {b.place ?? ""}
          {b.skip ? " · не хожу" : ""}
        </div>
      </div>
      {mine && (
        <button className="chip" style={{ minHeight: 40, padding: "0 14px" }} onClick={() => patch.mutate({ id: b.id, body: { skip: !b.skip } })}>
          {b.skip ? "хожу" : "не хожу"}
        </button>
      )}
      {mine && b.source !== "rea" && (
        <button className="icon-btn ghost" onClick={async () => (await confirm("Удалить пару?")) && del.mutate(b.id)} aria-label="Удалить">
          <Trash2 size={16} className="faint" />
        </button>
      )}
    </div>
  );

  return (
    <>
      <Head back caption="пары и занятость" title="Расписание" actions={mine ? <button className="icon-btn" onClick={() => setAdding(true)} aria-label="Добавить"><Plus size={20} /></button> : undefined} />
      {partner && (
        <Segmented value={whose} onChange={setWhose} items={[["me", "Моё"], ["partner", partner.name]]} />
      )}
      {!data ? (
        <Spinner />
      ) : (
        <>
          {mine && (
            <button className="card tap row" style={{ width: "100%", textAlign: "left", marginBottom: 10 }} onClick={() => setImporting(true)}>
              <Sparkles size={20} color="var(--me)" />
              <div className="grow">
                <div style={{ fontWeight: 650 }}>{meData?.aiSchedule ? "Расписание по фото или скриншоту" : "Расписание из чата с ИИ"}</div>
                <div className="small muted">{meData?.aiSchedule ? "Сфотографируй листок или загрузи скриншот — пары разложатся по дням сами" : "Скинь скриншот в ChatGPT, DeepSeek или GigaChat с нашей подсказкой и вставь ответ"}</div>
              </div>
              <ChevronRight size={18} className="faint" />
            </button>
          )}
          {mine && <ReaBlock whose={whose} />}
          {mine && <IcsBlock whose={whose} />}
          {!mine && person?.reaGroup && (
            <div className="card small muted" style={{ marginBottom: 10 }}>Подтягивается с сайта РЭУ, группа {person.reaGroup}</div>
          )}

          {weekly.length > 0 && <Section title="Каждую неделю" />}
          {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
            const list = weekly.filter((b) => b.weekday === wd).sort((a, b) => a.start_min - b.start_min);
            if (!list.length) return null;
            return (
              <div key={wd} className="card" style={{ paddingTop: 14, paddingBottom: 6, ["--edge" as string]: colorFor(person?.id) }}>
                <div className="caps" style={{ marginBottom: 4 }}>{WD_FULL[wd]}</div>
                {list.map((b) => <Row key={b.id} b={b} />)}
              </div>
            );
          })}

          {reaDays.length > 0 && <Section title="По датам" />}
          {reaDays.map(([date, list]) => (
            <div key={date} className="card" style={{ paddingTop: 14, paddingBottom: 6 }}>
              <div className="caps" style={{ marginBottom: 4 }}>{dayLabel(date)}</div>
              {list.map((b) => <Row key={b.id} b={b} />)}
            </div>
          ))}

          {!weekly.length && !rea.length && (
            <Empty art="calendar" title={mine ? "Расписания пока нет" : `У ${genitive(person?.name ?? "")} пар пока нет`} text={mine ? "Вставь расписание из чата с ИИ, добавь занятия вручную или подтяни с сайта РЭУ." : undefined}>
              {mine && <button className="btn inline" onClick={() => setAdding(true)}>Добавить пару</button>}
            </Empty>
          )}

          {whose === "me" && me && <DaySettings />}
          {whose === "partner" && partner?.ghost && (
            <p className="small muted center" style={{ marginTop: 16 }}>{partner.name} пока нет в приложении, поэтому это расписание можно править тебе. После входа оно перейдёт к {dative(partner.name)}.</p>
          )}
        </>
      )}
      <AddClassSheet open={adding} onClose={() => setAdding(false)} q={q} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} q={q} hasOwn={all.some((b) => b.source !== "rea" && b.kind !== "free")} who={whose === "me" ? null : person?.name ?? null} />
    </>
  );
}

/**
 * Подсказка для чата с ИИ: переписать расписание в наш формат (разбирает его
 * server/src/schedText.ts). Дата сегодня нужна, чтобы чат правильно выписал
 * занятия, которые идут не каждую неделю.
 */
export function schedulePrompt(t: string): string {
  const until = addDays(t, 56);
  const sample = addDays(t, 10);
  return `Помоги перенести моё расписание в приложение «Вдвоём». Расписание — во вложении или ниже: скриншот, фото, таблица или текст. Сегодня ${t}, ${WD_FULL[weekday(t)]}.

Ответь только строками расписания, без пояснений, по одной строке на занятие:
ДЕНЬ | ВРЕМЯ | ЧТО | ТИП | ГДЕ

Правила:
• ДЕНЬ — пн, вт, ср, чт, пт, сб или вс. Можно диапазон «пн-пт» или список «вт,чт».
• Если занятие идёт не каждую неделю (по чётным или нечётным неделям, по отдельным датам), вместо дня пиши дату в виде ГГГГ-ММ-ДД — отдельной строкой на каждую дату с ${t} по ${until}.
• ВРЕМЯ — начало и конец в 24-часовом формате: 09:30-10:50.
• ЧТО — короткое название.
• ТИП — одно слово: пара, работа, занятия, спорт или другое. Если это онлайн, допиши «онлайн»: «пара онлайн».
• ГДЕ — аудитория или адрес, можно оставить пустым.

Пример:
пн | 09:30-10:50 | Матанализ, лекция | пара | R405
вт,чт | 10:00-19:00 | Работа | работа | офис
ср | 18:10-19:30 | Английский | пара онлайн |
${sample} | 13:00-14:20 | Семинар по линалу | пара | D501

Если на картинке что-то не разобрать, не выдумывай, а спроси меня.`;
}

interface Parsed {
  entries: { kind: "weekly" | "once"; weekday: number | null; date: string | null; start: number; end: number; title: string; category: string; online: boolean }[];
  errors: { line: number; text: string; reason: string }[];
}

function ImportSheet({ open, onClose, q, hasOwn, who }: { open: boolean; onClose: () => void; q: string; hasOwn: boolean; who: string | null }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [replace, setReplace] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const prompt = useMemo(() => schedulePrompt(today()), []);
  const save = useAct(() => api<{ imported: number }>(`/schedule/import${q}`, { body: { text, replace: hasOwn && replace } }), ["schedule", "windows", "home"]);
  // Распознавание прямо в приложении (28.09.2026): фото, скриншот или сырой текст → строки
  const { data: meData } = useMe();
  const ai = !!meData?.aiSchedule;
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  async function recognize(files: File[], raw = "") {
    setBusy(true);
    try {
      const form = new FormData();
      // Caddy пускает тело до 2 МБ: два снимка по ~800 КБ влезают, 2000 px хватает для OCR
      for (const f of files.slice(0, 2)) form.append("file", (await shrink(f, 2000, 800_000)).blob, "schedule.jpg");
      if (raw) form.append("text", raw);
      const r = await upload<{ text: string; entries: number }>(`/schedule/ai${q}`, form);
      setText(r.text);
      haptic.success();
      store.toast(`Нашлось ${r.entries} ${plural(r.entries, "занятие", "занятия", "занятий")} — проверь и сохрани`);
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Разбор на сервере тем же кодом, что и при загрузке: что видно здесь, то и сохранится
  useEffect(() => {
    if (!text.trim()) return setParsed(null);
    const t = setTimeout(() => void api<Parsed>(`/schedule/import${q}`, { body: { text, dry: true } }).then(setParsed).catch(() => setParsed(null)), 350);
    return () => clearTimeout(t);
  }, [text, q]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      haptic.success();
      store.toast("Подсказка скопирована");
    } catch {
      setShowPrompt(true);
    }
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) setText(t);
    } catch {
      store.toast("Вставь ответ в поле долгим нажатием");
    }
  }

  const weekly = parsed?.entries.filter((e) => e.kind === "weekly") ?? [];
  const dated = parsed?.entries.filter((e) => e.kind === "once") ?? [];
  const n = parsed?.entries.length ?? 0;
  return (
    <Sheet open={open} onClose={onClose} title={who ? `Расписание ${genitive(who)}` : ai ? "Расписание" : "Расписание из чата"}>
      {ai && (
        <>
          <p className="small muted" style={{ margin: "-6px 0 10px", lineHeight: 1.45 }}>
            Сфотографируй листок с парами или загрузи скриншот из личного кабинета — приложение само разложит занятия по дням. Можно и вставить текст с сайта в поле ниже.
          </p>
          {/* Друг под другом: в две колонки «Сфотографировать» выталкивало вторую кнопку за край */}
          <button className="btn" disabled={busy} onClick={() => cam.current?.click()}><Camera size={17} /> Сфотографировать</button>
          <button className="btn soft" style={{ marginTop: 8 }} disabled={busy} onClick={() => gal.current?.click()}><ImagePlus size={17} /> Загрузить скриншот</button>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void recognize(f); }} />
          <input ref={gal} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void recognize(f); }} />
          {busy && <div className="card flat small muted center" style={{ marginTop: 10 }}>Распознаю… обычно 10–20 секунд</div>}
        </>
      )}
      {!ai && <PromptSteps prompt={prompt} showPrompt={showPrompt} setShowPrompt={setShowPrompt} copy={copy} />}
      <div className="row between" style={{ margin: "20px 0 6px" }}>
        <div className="caps">{ai ? "Строки расписания" : "2. Ответ чата"}</div>
        <button className="link small" onClick={paste}><ClipboardPaste size={14} style={{ verticalAlign: -2 }} /> Вставить</button>
      </div>
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"пн | 09:30-10:50 | Матанализ | пара | R405\n…"}
        style={{ minHeight: 130, fontSize: 14 }}
      />

      {parsed && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 650 }}>
            {n
              ? `Нашлось ${n} ${plural(n, "занятие", "занятия", "занятий")}: ${[weekly.length && `${weekly.length} каждую неделю`, dated.length && `${dated.length} по датам`].filter(Boolean).join(", ")}`
              : "Пока не нашлось ни одной строки расписания"}
          </div>
          {ai && !n && text.trim().length > 20 && (
            <button className="btn soft" style={{ marginTop: 8 }} disabled={busy} onClick={() => void recognize([], text)}>
              <Sparkles size={16} /> {busy ? "Разбираю…" : "Разобрать этот текст"}
            </button>
          )}
          {weekly.length > 0 && (
            <div className="card flat" style={{ marginTop: 8, padding: "6px 12px", maxHeight: 220, overflowY: "auto" }}>
              {[1, 2, 3, 4, 5, 6, 7].flatMap((wd) =>
                weekly
                  .filter((e) => e.weekday === wd)
                  .sort((a, b) => a.start - b.start)
                  .map((e, i) => (
                    <div key={`${wd}-${i}`} className="row small" style={{ gap: 8, padding: "5px 0" }}>
                      <span className="mono-sm" style={{ width: 22 }}>{i === 0 ? WD[wd] : ""}</span>
                      <span className="mono-sm" style={{ width: 92, flexShrink: 0, whiteSpace: "nowrap" }}>{hhmm(e.start)}–{hhmm(e.end)}</span>
                      <span className="ellipsis grow">{e.title || "без названия"}{e.online ? " · онлайн" : ""}</span>
                      <span className="muted" style={{ flexShrink: 0 }}>{CATEGORY[e.category]?.split(" ")[0]}</span>
                    </div>
                  )),
              )}
            </div>
          )}
          {dated.length > 0 && (
            <p className="small muted" style={{ margin: "8px 4px 0" }}>
              По датам: {dated.slice(0, 4).map((e) => `${dayMonth(e.date!)} ${e.title}`).join(", ")}
              {dated.length > 4 ? ` и ещё ${dated.length - 4}` : ""}
            </p>
          )}
          {parsed.errors.length > 0 && (
            <div className="small" style={{ marginTop: 10, color: "var(--coral, #e5484d)" }}>
              {parsed.errors.slice(0, 5).map((e) => (
                <div key={e.line} style={{ marginTop: 4 }}>Строка {e.line}: {e.reason}. <span className="muted">{e.text}</span></div>
              ))}
              <div className="muted" style={{ marginTop: 6 }}>Эти строки не загрузятся. Можно поправить их прямо в поле.</div>
            </div>
          )}
        </div>
      )}

      {hasOwn && n > 0 && (
        <div className="row" style={{ gap: 12, marginTop: 16 }}>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Заменить прежнее</div>
            <div className="small muted">уберёт добавленное руками и прошлой вставкой; расписание РЭУ останется</div>
          </div>
          <Toggle label="Заменить прежнее" on={replace} onChange={setReplace} />
        </div>
      )}
      <button
        className="btn"
        style={{ marginTop: 16 }}
        disabled={!n || save.isPending}
        onClick={() =>
          save.mutate(undefined, {
            onSuccess: (r) => {
              haptic.success();
              store.toast(`Загружено ${r.imported} ${plural(r.imported, "занятие", "занятия", "занятий")}`);
              setText("");
              setParsed(null);
              onClose();
            },
          })
        }
      >
        {n ? `Загрузить ${n} ${plural(n, "занятие", "занятия", "занятий")}` : "Загрузить"}
      </button>
      {ai && (
        <details style={{ marginTop: 18 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>Или через свой чат с ИИ (ChatGPT, DeepSeek, Алиса)</summary>
          <div style={{ marginTop: 10 }}><PromptSteps prompt={prompt} showPrompt={showPrompt} setShowPrompt={setShowPrompt} copy={copy} /></div>
        </details>
      )}
    </Sheet>
  );
}

function ReaBlock({ whose }: { whose: "me" | "partner" }) {
  const { me: self, partner } = useMe();
  const me = whose === "me" ? self : partner;
  const forQ = whose === "partner" ? "?for=partner" : "";
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ groups: { key: string; name: string; meta: string }[] }>(["rea-search", q], q.length >= 2 ? `/schedule/rea/search?q=${encodeURIComponent(q)}` : null);
  const sync = useAct((group: string) => api<{ imported: number }>(`/schedule/rea${forQ}`, { body: { group } }), ["schedule", "windows", "home", "me"]);
  const off = useAct(() => api(`/schedule${forQ ? forQ + "&" : "?"}source=rea`, { method: "DELETE" }), ["schedule", "windows", "home", "me"]);

  if (me?.reaGroup)
    return (
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row between">
          <div>
            <div className="caps">РЭУ им. Плеханова</div>
            <div className="title-md" style={{ marginTop: 4 }}>{me.reaGroup.toUpperCase()}</div>
            <div className="mono-sm" style={{ marginTop: 2 }}>обновляется само раз в сутки</div>
          </div>
          <button className="icon-btn" onClick={() => sync.mutate(me.reaGroup!, { onSuccess: (r) => store.toast(`Обновлено: ${r.imported} пар`) })} aria-label="Обновить">
            <RefreshCw size={18} className={sync.isPending ? "spin" : ""} />
          </button>
        </div>
        <button className="link small" style={{ marginTop: 10 }} onClick={async () => (await confirm("Отключить подтяжку и убрать пары РЭУ?")) && off.mutate()}>
          Отключить
        </button>
      </div>
    );

  return (
    <>
      <button className="card tap row" style={{ width: "100%", textAlign: "left", marginBottom: 10 }} onClick={() => setOpen(true)}>
        <Wifi size={20} color="var(--me)" />
        <div className="grow">
          <div style={{ fontWeight: 650 }}>{whose === "me" ? "Учишься в РЭУ?" : "Учится в РЭУ?"}</div>
          <div className="small muted">Пары подтянутся с rasp.rea.ru сами и будут обновляться</div>
        </div>
        <ChevronRight size={18} className="faint" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Группа в РЭУ">
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Например, гдэ02а/26" />
        <div className="stack" style={{ marginTop: 12 }}>
          {(data?.groups ?? []).map((g) => (
            <button
              key={g.key}
              className="card flat tap"
              style={{ width: "100%", textAlign: "left", padding: 14 }}
              disabled={sync.isPending}
              onClick={() =>
                sync.mutate(g.key, {
                  onSuccess: (r) => {
                    store.toast(`Подтянуто ${r.imported} ${plural(r.imported, "пара", "пары", "пар")}`);
                    setOpen(false);
                  },
                })
              }
            >
              <div style={{ fontWeight: 650 }}>{g.name}</div>
              <div className="small muted">{g.meta}</div>
            </button>
          ))}
          {sync.isPending && <Spinner />}
        </div>
      </Sheet>
    </>
  );
}

const GAPS = [0, 15, 30, 45, 60, 90];

/**
 * Запас до встречи: сколько минут нужно после дел (и до них), чтобы добраться и
 * собраться. 0 — окно начинается ровно тогда, когда у обоих кончились дела.
 * Показывается там, где его ищут: над общими окнами, в расписании и в настройках.
 */
export function GapPicker({ compact }: { compact?: boolean }) {
  const { me, partner } = useMe();
  const save = useAct((body: Record<string, unknown>) => api("/me", { body }), ["me", "windows", "home"]);
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const label = (m: number) => (m ? `${m} мин` : "без запаса");
  if (compact)
    return (
      <>
        <button className="card flat tap row" style={{ width: "100%", textAlign: "left", padding: "10px 14px", margin: "0 0 12px" }} onClick={() => setOpen(true)}>
          <Clock size={17} className="muted" />
          <div className="grow small">
            <b>Запас до встречи:</b> {label(me.gapMin)}{partner && !partner.ghost ? `, у ${genitive(partner.name)} ${label(partner.gapMin)}` : ""}
          </div>
          <span className="link small">Изменить</span>
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Запас до встречи">
          <GapChoice value={me.gapMin} onPick={(m) => { save.mutate({ gapMin: m }); setOpen(false); }} />
        </Sheet>
      </>
    );
  return <GapChoice value={me.gapMin} onPick={(m) => save.mutate({ gapMin: m })} />;
}

function GapChoice({ value, onPick }: { value: number; onPick: (m: number) => void }) {
  return (
    <>
      <p className="small muted" style={{ margin: "-6px 0 12px", lineHeight: 1.45 }}>
        Сколько времени тебе нужно после пар или работы, чтобы добраться до встречи. Столько же вычитается перед делами. Без запаса окно начинается ровно тогда, когда у вас обоих всё закончилось.
      </p>
      <div className="pills">
        {GAPS.map((m) => (
          <button key={m} className={`pill${value === m ? " on" : ""}`} onClick={() => { haptic.select(); onPick(m); }}>
            {m ? `${m} мин` : "Без запаса"}
          </button>
        ))}
      </div>
    </>
  );
}

function DaySettings() {
  const { me } = useMe();
  const save = useAct((body: Record<string, unknown>) => api("/me", { body }), ["me", "windows", "home"]);
  if (!me) return null;
  return (
    <>
      <Section title="Как считать окна" />
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Запас до встречи</div>
        <GapPicker />
        <div className="hr" />
        <div className="row between">
          <div style={{ fontWeight: 600 }}>Не раньше</div>
          <input className="input" aria-label="Звать не раньше" type="time" style={{ width: 110 }} value={hhmm(me.dayStartMin)} onChange={(e) => { const v = parseHhmm(e.target.value); if (v != null) save.mutate({ dayStartMin: v }); }} />
        </div>
        <div className="hr" />
        <div className="row between">
          <div style={{ fontWeight: 600 }}>Не позже</div>
          <input className="input" aria-label="Звать не позже" type="time" style={{ width: 110 }} value={hhmm(Math.min(me.dayEndMin, 1439))} onChange={(e) => { const v = parseHhmm(e.target.value); if (v != null) save.mutate({ dayEndMin: v }); }} />
        </div>
      </div>
    </>
  );
}

function AddClassSheet({ open, onClose, q }: { open: boolean; onClose: () => void; q: string }) {
  const [category, setCategory] = useState("class");
  const [grid, setGrid] = useState("ВШЭ");
  const [wd, setWd] = useState(1);
  const [slot, setSlot] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [online, setOnline] = useState(false);
  const add = useAct(
    () =>
      api(`/schedule${q}`, {
        body: { kind: "weekly", weekday: wd, start_min: parseHhmm(from), end_min: parseHhmm(to), title, place, online, category },
      }),
    ["schedule", "windows", "home"],
  );
  const pick = (i: number) => {
    const [a, b] = GRIDS[grid][i];
    setSlot(i);
    setFrom(hhmm(a));
    setTo(hhmm(b));
    haptic.select();
  };
  const ok = parseHhmm(from) != null && parseHhmm(to) != null && parseHhmm(to)! > parseHhmm(from)!;
  return (
    <Sheet open={open} onClose={onClose} title="Каждую неделю">
      <Pills value={category} onChange={setCategory} scroll items={Object.entries(CATEGORY).map(([k, v]) => [k, v])} />
      <Pills value={String(wd)} onChange={(v) => setWd(Number(v))} scroll items={[1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), WD[d]])} />
      {category === "class" && (<>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="caps">номер пары</div>
        <div className="row" style={{ gap: 6 }}>
          {Object.keys(GRIDS).map((g) => (
            <button key={g} className={`chip${grid === g ? " solid" : ""}`} onClick={() => { setGrid(g); setSlot(null); }}>{g}</button>
          ))}
        </div>
      </div>
      <div className="grid-4" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 14 }}>
        {GRIDS[grid].map((_, i) => (
          <button key={i} className={`pill${slot === i ? " on" : ""}`} style={{ padding: "10px 0" }} onClick={() => pick(i)}>{i + 1}</button>
        ))}
      </div>
      </>)}
      <div className="grid-2">
        <Field label="Начало"><input className="input" type="time" value={from} onChange={(e) => { setFrom(e.target.value); setSlot(null); }} /></Field>
        <Field label="Конец"><input className="input" type="time" value={to} onChange={(e) => { setTo(e.target.value); setSlot(null); }} /></Field>
      </div>
      <Field label="Предмет"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Матанализ, семинар" /></Field>
      <Field label="Где"><input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="R304" /></Field>
      <label className="row" style={{ margin: "4px 4px 16px", gap: 10 }}>
        <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
        <span>Онлайн — дорога не нужна</span>
      </label>
      <button
        className="btn"
        disabled={!ok || add.isPending}
        onClick={() =>
          add.mutate(undefined, {
            onSuccess: () => {
              haptic.success();
              store.toast(`Добавлено: ${WD[wd]} ${from}`);
              setTitle("");
              setPlace("");
              setSlot(null);
            },
          })
        }
      >
        Добавить
      </button>
      <p className="small muted center" style={{ marginBottom: 0 }}>Можно добавлять подряд — шторка не закрывается</p>
    </Sheet>
  );
}


/**
 * «В календарь телефона» (отзыв #4, 28.09.2026): подписка iCal на события пары.
 * Инструкция открывается в браузере — из телеграма webcal:// не открыть, а Safari
 * по нему сам предлагает подписаться; для Google Календаря — ссылка на копирование.
 */
function PhoneCalendarSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, refetch } = useApi<{ page: string; https: string; webcal: string }>(["calendar-link"], open ? "/calendar/link" : null);
  const reset = useAct(() => api("/calendar/link/reset", { body: {} }));
  return (
    <Sheet open={open} onClose={onClose} title="В календарь телефона">
      <p className="small muted" style={{ marginTop: -8, lineHeight: 1.5 }}>
        Свидания, поездки, события, дни рождения и годовщина появятся в обычном календаре телефона и будут обновляться сами. Ссылка личная.
      </p>
      <button className="btn" disabled={!data} onClick={() => data && openLink(data.page)}>
        <Smartphone size={18} /> Подключить календарь
      </button>
      <button
        className="btn soft"
        style={{ marginTop: 8 }}
        disabled={!data}
        onClick={() => data && navigator.clipboard?.writeText(data.https).then(() => store.toast("Ссылка скопирована: вставь её в Google Календарь → «Добавить по URL»"), () => store.toast(data.https))}
      >
        <Copy size={17} /> Скопировать ссылку для Google
      </button>
      <button
        className="link small"
        style={{ display: "block", margin: "14px auto 0" }}
        onClick={async () => {
          if (!(await confirm("Сделать новую ссылку? Старая перестанет работать — календарь придётся подключить заново."))) return;
          reset.mutate(undefined, { onSuccess: () => { void refetch(); store.toast("Новая ссылка готова"); } });
        }}
      >
        Сбросить ссылку
      </button>
    </Sheet>
  );
}

/** Подсказка для своего чата с ИИ: основной путь без ключа Яндекса, запасной — с ним. */
function PromptSteps({ prompt, showPrompt, setShowPrompt, copy }: { prompt: string; showPrompt: boolean; setShowPrompt: (v: boolean) => void; copy: () => void }) {
  return (
    <>
      <div className="caps" style={{ marginBottom: 6 }}>1. Подсказка для чата</div>
      <p className="small muted" style={{ margin: "0 0 10px", lineHeight: 1.45 }}>
        Скопируй её и отправь в любой чат с ИИ — ChatGPT, DeepSeek, GigaChat или Алису. Приложи расписание: скриншот из личного кабинета, фото листка, график работы. Чат ответит строками, которые приложение поймёт.
      </p>
      <div className="grid-2">
        <button className="btn" onClick={copy}><Copy size={17} /> Скопировать</button>
        <button className="btn soft" onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? "Скрыть" : "Показать"}</button>
      </div>
      {showPrompt && <textarea className="input mono-sm" readOnly value={prompt} style={{ marginTop: 10, minHeight: 220, fontSize: 12.5 }} onFocus={(e) => e.currentTarget.select()} />}
    </>
  );
}

/**
 * Расписание из календаря по ссылке (04.10.2026): HSE App X и SmartLMS выгружают
 * пары календарём, так же Google, Яндекс и РУЗ других вузов. Ссылку вставляют
 * один раз, дальше сервер обновляет пары сам раз в сутки.
 */
function IcsBlock({ whose }: { whose: "me" | "partner" }) {
  const { me: self, partner } = useMe();
  const me = whose === "me" ? self : partner;
  const forQ = whose === "partner" ? "?for=partner" : "";
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const keys = ["schedule", "windows", "home", "me"];
  const connect = useAct((u: string) => api<{ imported: number }>(`/schedule/ics${forQ}`, { body: { url: u } }), keys);
  const off = useAct(() => api(`/schedule/ics${forQ}`, { method: "DELETE" }), keys);

  if (me?.icsHost)
    return (
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="caps">Календарь по ссылке</div>
        <div className="title-md" style={{ marginTop: 4 }}>{me.icsHost}</div>
        <div className="mono-sm" style={{ marginTop: 2 }}>пары обновляются сами раз в сутки</div>
        <button className="link small" onClick={async () => (await confirm("Отключить календарь и убрать его пары?")) && off.mutate()}>
          Отключить
        </button>
      </div>
    );

  return (
    <>
      <button className="card tap row" style={{ width: "100%", textAlign: "left", marginBottom: 10 }} onClick={() => setOpen(true)}>
        <CalendarSync size={20} color="var(--me)" />
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Вышка, SmartLMS или свой календарь</div>
          <div className="small muted">Вставь ссылку на календарь — пары подтянутся и будут обновляться сами</div>
        </div>
        <ChevronRight size={18} className="faint" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Календарь по ссылке">
        <div className="small muted" style={{ marginTop: -8, lineHeight: 1.5 }}>
          <p style={{ margin: "0 0 6px" }}>
            <b>HSE App X на айфоне:</b> нажми «Экспортировать календарь» и согласись на подписку. Потом открой Настройки → Приложения → Календарь → Учётные записи → Подписные календари → календарь ВШЭ, нажми и подержи строку «Сервер» — «Скопировать» — и вставь сюда.
          </p>
          <p style={{ margin: "0 0 6px" }}><b>На маке:</b> в «Календаре» правый щелчок по календарю ВШЭ → «Свойства» → строка URL.</p>
          <p style={{ margin: "0 0 6px" }}><b>Google Календарь:</b> настройки календаря → «Секретный адрес в формате iCal».</p>
          <p style={{ margin: 0 }}><b>Яндекс Календарь:</b> настройки календаря → «Экспорт» → ссылка ICS.</p>
        </div>
        <input
          className="input"
          style={{ marginTop: 12 }}
          aria-label="Ссылка на календарь"
          inputMode="url"
          placeholder="https://… или webcal://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="btn"
          style={{ marginTop: 12 }}
          disabled={url.trim().length < 12 || connect.isPending}
          onClick={() =>
            connect.mutate(url.trim(), {
              onSuccess: (r) => {
                haptic.success();
                store.toast(r.imported ? `Подтянуто ${r.imported} ${plural(r.imported, "занятие", "занятия", "занятий")} на месяц вперёд` : "Календарь подключён, но занятий на месяц вперёд в нём нет");
                setUrl("");
                setOpen(false);
              },
              // Ошибку показывает общий обработчик (api.ts): второй такой же тост мигал дублем
            })
          }
        >
          {connect.isPending ? "Забираю календарь…" : "Подключить"}
        </button>
        <p className="small muted center" style={{ margin: "12px 0 0" }}>Ссылка личная: мы храним её только для обновления пар и никому не показываем.</p>
      </Sheet>
    </>
  );
}
