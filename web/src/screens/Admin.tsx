// Админка владельца (28.09.2026): кто пришёл, кто что делает, подозрительная
// активность, блокировка и отзывы. Видна только тем, кого сервер считает
// админом (ADMIN_IDS). Содержимого пар здесь нет — только имена, даты и виды действий.
import { AlertTriangle, ChevronRight, Copy, Gift, ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, queryClient, useAct, useApi } from "../api.ts";
import { authHeader, confirm, haptic } from "../tg.ts";
import { store } from "../store.ts";
import { Empty, Field, Head, Pills, Section, Segmented, Sheet, Spinner, Toggle } from "../ui/kit.tsx";
import "./admin.css";

interface Person {
  id: number;
  name: string;
  username: string | null;
  createdAt: string;
  seenAt: string | null;
  onboarded: boolean;
  partner: { id: number; name: string; ghost: boolean } | null;
  actions24h: number;
  blocked: boolean;
  source: string | null;
  pairId: number | null;
}
interface PairInfo {
  id: number;
  source: string | null;
  sourceLabel: string | null;
  createdAt: string;
  pairedAt: string | null;
  members: { id: number; name: string }[];
  plusUntil: string | null;
  plusActive: boolean;
  forever: boolean;
  payments: { plan: string; amount: number; method: string; at: string }[];
}
interface FunnelRow {
  key: string;
  label: string;
  starts: number;
  pairs: number;
  d7: number;
  d7of: number;
  d14: number;
  d14of: number;
  lock: number;
  plusView: number;
  checkout: number;
  paid: number;
  rub: number;
  stars: number;
}
interface Funnel {
  from: string;
  to: string;
  definition: string;
  total: FunnelRow;
  bySource: FunnelRow[];
  cohorts: FunnelRow[];
  sources: { key: string; label: string }[];
}
interface Partner {
  code: string;
  name: string;
  platform: string | null;
  url: string | null;
  note: string | null;
  createdAt: string;
  starts: number;
  links: { app: string; bot: string };
}
interface Alert {
  userId: number;
  name: string;
  username: string | null;
  why: string;
  blocked: boolean;
}
interface Overview {
  users: number;
  new24h: number;
  new7d: number;
  pairs: number;
  active24h: number;
  actions24h: number;
  feedbackNew: number;
  blocked: number;
  aiRub: number;
  aiLimitRub: number;
  aiCalls: number;
  alerts: Alert[];
}
interface Card extends Person {
  byKind: { label: string; n: number }[];
  recent: { label: string; at: string }[];
  feedback: { id: number; kind: string; text: string; at: string }[];
  pair: PairInfo | null;
}
interface Feedback {
  id: number;
  kind: string;
  author: string;
  userId: number;
  screen: string | null;
  platform: string | null;
  text: string;
  photos: number;
  doneNote: string | null;
  at: string;
}

/** SQLite хранит время в UTC без пояса: «2026-09-28 10:39:23». */
const toDate = (s: string) => new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
/** «в сети 5 мин назад» — без рода, имя может быть любым. */
function seen(s: string | null): string {
  if (!s) return "ещё не открывали приложение";
  const min = Math.round((Date.now() - toDate(s).getTime()) / 60_000);
  if (min < 2) return "в сети только что";
  if (min < 60) return `в сети ${min} мин назад`;
  if (min < 24 * 60) return `в сети ${Math.round(min / 60)} ч назад`;
  return `в сети ${toDate(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`;
}
const when = (s: string) => toDate(s).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Tab = "summary" | "funnel" | "people" | "feed" | "feedback";

export function AdminScreen() {
  const [tab, setTab] = useState<Tab>("summary");
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <Head back caption="видно только тебе" title="Админка" />
      <div className="admin-tabs">
        <Segmented value={tab} onChange={setTab} items={[["summary", "Сводка"], ["funnel", "Воронка"], ["people", "Люди"], ["feed", "Лента"], ["feedback", "Отзывы"]]} />
      </div>
      <div style={{ height: 12 }} />
      {tab === "summary" && <Summary onOpen={setOpen} />}
      {tab === "funnel" && <FunnelScreen />}
      {tab === "people" && <People onOpen={setOpen} />}
      {tab === "feed" && <Feed onOpen={setOpen} />}
      {tab === "feedback" && <FeedbackList onOpen={setOpen} />}
      <PersonSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Summary({ onOpen }: { onOpen: (id: number) => void }) {
  const { data } = useApi<Overview>(["admin", "overview"], "/admin/overview");
  if (!data) return <Spinner />;
  const stats: [string, number][] = [
    ["Людей всего", data.users],
    ["Новых за сутки", data.new24h],
    ["Новых за неделю", data.new7d],
    ["Пар вдвоём", data.pairs],
    ["Заходили за сутки", data.active24h],
    ["Действий за сутки", data.actions24h],
    ["Отзывов не учтено", data.feedbackNew],
    ["Заблокировано", data.blocked],
    [`ИИ за месяц, ₽ из ${data.aiLimitRub}`, data.aiRub],
    ["Распознаваний за месяц", data.aiCalls],
  ];
  return (
    <>
      {data.alerts.length > 0 && (
        <div className="card" style={{ borderColor: "var(--rose)", borderWidth: 1.5, borderStyle: "solid" }}>
          <div className="row" style={{ gap: 8, fontWeight: 800 }}><AlertTriangle size={18} color="var(--rose)" /> Подозрительно за последний час</div>
          {data.alerts.map((a) => (
            <button key={`${a.userId}${a.why}`} className="row between" style={{ width: "100%", padding: "10px 0 0", textAlign: "left" }} onClick={() => onOpen(a.userId)}>
              <span><b>{a.name}</b>{a.username ? ` @${a.username}` : ""} — {a.why}{a.blocked ? " · доступ закрыт" : ""}</span>
              <ChevronRight size={16} className="faint" />
            </button>
          ))}
        </div>
      )}
      <div className="grid-2">
        {stats.map(([t, n]) => (
          <div key={t} className="card" style={{ margin: 0 }}>
            <div className="title-lg" style={{ fontSize: 28 }}>{n.toLocaleString("ru-RU")}</div>
            <div className="small muted">{t}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function PersonRow({ p, onOpen }: { p: Person; onOpen: (id: number) => void }) {
  return (
    <button className="card tap row" style={{ width: "100%", textAlign: "left", gap: 12 }} onClick={() => onOpen(p.id)}>
      <div className="grow">
        <div style={{ fontWeight: 750 }}>
          {p.name}
          {p.username && <span className="muted" style={{ fontWeight: 500 }}> @{p.username}</span>}
          {p.blocked && <span className="chip" style={{ marginLeft: 6 }}>доступ закрыт</span>}
        </div>
        <div className="small muted">
          с {when(p.createdAt)} · {p.partner ? `пара: ${p.partner.name}${p.partner.ghost ? " (ещё не в приложении)" : ""}` : "без пары"}
          {!p.onboarded && " · знакомство не пройдено"}
          {p.source && <span className="chip" style={{ marginLeft: 6 }}>{p.source}</span>}
        </div>
        <div className="small muted">{seen(p.seenAt)} · действий за сутки: {p.actions24h}</div>
      </div>
      <ChevronRight size={18} className="faint" />
    </button>
  );
}

function People({ onOpen }: { onOpen: (id: number) => void }) {
  const { data } = useApi<{ users: Person[] }>(["admin", "users"], "/admin/users");
  if (!data) return <Spinner />;
  if (!data.users.length) return <Empty emoji="🫥" title="Пока никого" />;
  return <div className="stack">{data.users.map((p) => <PersonRow key={p.id} p={p} onOpen={onOpen} />)}</div>;
}

function Feed({ onOpen }: { onOpen: (id: number) => void }) {
  const { data } = useApi<{ items: { userId: number; name: string; label: string; at: string }[] }>(["admin", "activity"], "/admin/activity");
  if (!data) return <Spinner />;
  if (!data.items.length) return <Empty emoji="🌙" title="Тишина" text="Здесь появятся действия всех людей: кто пришёл, кто что добавил." />;
  return (
    <div className="card" style={{ padding: "4px 14px" }}>
      {data.items.map((a, i) => (
        <button key={i} className="row admin-feed" style={{ width: "100%", textAlign: "left" }} onClick={() => onOpen(a.userId)}>
          <span className="small muted" style={{ width: 92, flexShrink: 0 }}>{when(a.at)}</span>
          <span className="grow"><b>{a.name}</b> · {a.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Скриншот отзыва: картинка идёт через API с заголовком входа, поэтому fetch → blob. */
function Shot({ id, n }: { id: number; n: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const load = async () => {
    const r = await fetch(`/api/admin/feedback/${id}/photo/${n}`, { headers: { Authorization: authHeader() } });
    if (r.ok) setUrl(URL.createObjectURL(await r.blob()));
  };
  return url ? (
    <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Скриншот ${n + 1}`} style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 12 }} /></a>
  ) : (
    <button className="pill" onClick={load}><ImageIcon size={15} /> скриншот {n + 1}</button>
  );
}

function FeedbackList({ onOpen }: { onOpen: (id: number) => void }) {
  const { data } = useApi<{ items: Feedback[] }>(["admin", "feedback"], "/admin/feedback");
  if (!data) return <Spinner />;
  if (!data.items.length) return <Empty emoji="📭" title="Отзывов пока нет" />;
  return (
    <div className="stack">
      {data.items.map((f) => (
        <div key={f.id} className="card" style={{ margin: 0 }}>
          <div className="row between">
            <b>#{f.id} · {f.kind}</b>
            <span className="small muted">{when(f.at)}</span>
          </div>
          <button className="small muted" style={{ textAlign: "left", marginTop: 2 }} onClick={() => onOpen(f.userId)}>
            {f.author}{f.screen ? ` · ${f.screen}` : ""}{f.platform ? ` · ${f.platform}` : ""}
          </button>
          <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{f.text}</p>
          {f.photos > 0 && (
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {Array.from({ length: f.photos }, (_, n) => <Shot key={n} id={f.id} n={n} />)}
            </div>
          )}
          <div className="small" style={{ marginTop: 8, color: f.doneNote ? "var(--mint, #1f9d6b)" : "var(--muted)" }}>
            {f.doneNote ? `✅ ${f.doneNote}` : "⏳ ещё не учтён"}
          </div>
        </div>
      ))}
    </div>
  );
}

function PersonSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data } = useApi<Card>(["admin", "user", String(id)], `/admin/users/${id}`, { enabled: id !== null });
  const block = useAct((v: { id: number; blocked: boolean }) => api(`/admin/users/${v.id}/block`, { body: { blocked: v.blocked } }), ["admin"]);
  const p = id !== null && data?.id === id ? data : null;
  return (
    <Sheet open={id !== null} onClose={onClose} title={p?.name ?? "…"}>
      {!p ? (
        <Spinner />
      ) : (
        <>
          <div className="small muted" style={{ marginTop: -6, lineHeight: 1.5 }}>
            {p.username ? <>@{p.username} · </> : null}id {p.id}
            <br />с {when(p.createdAt)} · {seen(p.seenAt)}
            <br />{p.partner ? `пара: ${p.partner.name}` : "половинки пока нет"}{p.blocked ? " · доступ закрыт" : ""}
            {p.source && <><br />метка прихода: {p.source}</>}
          </div>
          {p.pair && <PairBlock pair={p.pair} />}
          {p.byKind.length > 0 && (
            <>
              <Section title="За неделю" />
              <div className="card" style={{ padding: "6px 14px" }}>
                {p.byKind.map((k) => (
                  <div key={k.label} className="row between admin-feed">
                    <span>{k.label}</span>
                    <b>{k.n}</b>
                  </div>
                ))}
              </div>
            </>
          )}
          {p.feedback.length > 0 && (
            <>
              <Section title="Отзывы" />
              {p.feedback.map((f) => (
                <div key={f.id} className="bubble small" style={{ marginBottom: 6 }}><b>{f.kind}</b> · {f.text}</div>
              ))}
            </>
          )}
          <Section title="Последние действия" />
          <div className="card" style={{ padding: "4px 14px", maxHeight: 280, overflowY: "auto" }}>
            {p.recent.length ? p.recent.map((r, i) => (
              <div key={i} className="row admin-feed">
                <span className="small muted" style={{ width: 92, flexShrink: 0 }}>{when(r.at)}</span>
                <span className="grow">{r.label}</span>
              </div>
            )) : <div className="small muted" style={{ padding: "10px 0" }}>Пока ничего</div>}
          </div>
          <button
            className={`btn${p.blocked ? " soft" : ""}`}
            style={{ marginTop: 16, ...(p.blocked ? {} : { background: "var(--rose)" }) }}
            disabled={block.isPending}
            onClick={async () => {
              const next = !p.blocked;
              if (next && !(await confirm(`Закрыть доступ для ${p.name}? Приложение перестанет открываться у этого человека. Данные не удаляются.`))) return;
              block.mutate({ id: p.id, blocked: next }, { onSuccess: () => { haptic.success(); store.toast(next ? "Доступ закрыт" : "Доступ возвращён"); } });
            }}
          >
            {p.blocked ? "Вернуть доступ" : "Заблокировать"}
          </button>
        </>
      )}
    </Sheet>
  );
}

// ——— воронка и блогеры (11.10.2026) ———

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");
const mskToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const minusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const money = (r: FunnelRow) => [r.rub ? `${r.rub.toLocaleString("ru-RU")} ₽` : "", r.stars ? `${r.stars.toLocaleString("ru-RU")} ⭐` : ""].filter(Boolean).join(" + ") || "—";

/** Шаги воронки: люди, потом пары. Доля — от пар, у D7/D14 — от пар, которым уже 7/14 дней. */
function Steps({ t }: { t: FunnelRow }) {
  const steps: [string, number, string, number][] = [
    ["Старты", t.starts, "людей", 1],
    ["Пара сложилась", t.pairs, t.starts ? `${pct(t.pairs * 2, t.starts)} стартов в парах` : "", t.starts ? Math.min(1, (t.pairs * 2) / t.starts) : 0],
    ["Живы на 7-й день", t.d7, t.d7of ? `${pct(t.d7, t.d7of)} из ${t.d7of}, кому уже 7 дней` : "пока никому нет 7 дней", t.d7of ? t.d7 / t.d7of : 0],
    ["Живы на 14-й день", t.d14, t.d14of ? `${pct(t.d14, t.d14of)} из ${t.d14of}, кому уже 14 дней` : "пока никому нет 14 дней", t.d14of ? t.d14 / t.d14of : 0],
    ["Дошли до замка", t.lock, `${pct(t.lock, t.pairs)} пар`, t.pairs ? t.lock / t.pairs : 0],
    ["Видели «Вдвоём+»", t.plusView, `${pct(t.plusView, t.pairs)} пар`, t.pairs ? t.plusView / t.pairs : 0],
    ["Начали оплату", t.checkout, `${pct(t.checkout, t.pairs)} пар`, t.pairs ? t.checkout / t.pairs : 0],
    ["Оплатили", t.paid, `${pct(t.paid, t.pairs)} пар · ${money(t)}`, t.pairs ? t.paid / t.pairs : 0],
  ];
  return (
    <div className="card funnel-steps">
      {steps.map(([title, n, note, share]) => (
        <div key={title} className="funnel-step">
          <div className="row between">
            <span>{title}</span>
            <b>{n.toLocaleString("ru-RU")}</b>
          </div>
          <div className="funnel-bar"><div style={{ width: `${Math.round(share * 100)}%` }} /></div>
          {note && <div className="small muted">{note}</div>}
        </div>
      ))}
    </div>
  );
}

function FunnelTable({ rows, first }: { rows: FunnelRow[]; first: string }) {
  if (!rows.length) return <div className="small muted" style={{ padding: "4px 2px 8px" }}>За этот период никого</div>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>{first}</th>
            <th>Старты</th>
            <th>Пары</th>
            <th>D7</th>
            <th>D14</th>
            <th>Замок</th>
            <th>«Вдвоём+»</th>
            <th>Оплата</th>
            <th>Оплатили</th>
            <th>Выручка</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th title={r.key}>{r.label}</th>
              <td>{r.starts}</td>
              <td>{r.pairs}</td>
              <td>{r.d7of ? `${r.d7}/${r.d7of}` : "—"}</td>
              <td>{r.d14of ? `${r.d14}/${r.d14of}` : "—"}</td>
              <td>{r.lock}</td>
              <td>{r.plusView}</td>
              <td>{r.checkout}</td>
              <td>{r.paid}</td>
              <td>{money(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FunnelScreen() {
  const [to, setTo] = useState(mskToday);
  const [from, setFrom] = useState(() => minusDays(mskToday(), 55));
  const [src, setSrc] = useState("*");
  const q = `from=${from}&to=${to}`;
  const { data } = useApi<Funnel>(["admin", "funnel", q], `/admin/funnel?${q}`);
  const cohortQ = src === "*" ? null : `${q}&source=${encodeURIComponent(src)}`;
  const { data: one } = useApi<Funnel>(["admin", "funnel", cohortQ ?? "-"], cohortQ ? `/admin/funnel?${cohortQ}` : null);
  const weeks = (n: number) => {
    const t = mskToday();
    setTo(t);
    setFrom(minusDays(t, n * 7 - 1));
  };
  const cohorts = src === "*" ? data?.cohorts : one?.cohorts;
  return (
    <>
      <div className="card">
        <div className="row funnel-dates" style={{ gap: 8 }}>
          <Field label="С"><input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="По"><input className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {([[1, "неделя"], [4, "4 недели"], [8, "8 недель"], [12, "12 недель"]] as const).map(([n, t]) => (
            <button key={n} className="pill" onClick={() => weeks(n)}>{t}</button>
          ))}
        </div>
      </div>
      {!data ? (
        <Spinner />
      ) : (
        <>
          <Steps t={data.total} />
          <details className="card admin-def">
            <summary>Как считаем</summary>
            <p className="small muted">{data.definition}</p>
          </details>
          <Section title="По источникам" />
          <FunnelTable rows={data.bySource} first="Источник" />
          <Section title="Когорты по неделе прихода" />
          <select className="input" style={{ marginBottom: 8 }} value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Источник для когорт">
            <option value="*">Все источники</option>
            <option value="">Без метки</option>
            {data.sources.map((s) => <option key={s.key} value={s.key}>{s.label === s.key ? s.key : `${s.label} · ${s.key}`}</option>)}
          </select>
          {cohorts ? <FunnelTable rows={cohorts} first="Неделя" /> : <Spinner />}
        </>
      )}
      <Partners />
    </>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    haptic.success();
    store.toast("Ссылка скопирована");
  } catch {
    store.toast(text);
  }
}

function Partners() {
  const { data } = useApi<{ items: Partner[] }>(["admin", "partners"], "/admin/partners");
  const [edit, setEdit] = useState<Partner | "new" | null>(null);
  const del = useAct((code: string) => api(`/admin/partners/${code}`, { method: "DELETE" }), ["admin"]);
  return (
    <>
      <Section
        title="Блогеры"
        action={<button className="pill" aria-label="Добавить блогера" onClick={() => setEdit("new")}><Plus size={15} /> Добавить</button>}
      />
      {!data ? <Spinner /> : !data.items.length ? (
        <div className="card small muted">Пока никого. Добавь блогера — появятся его ссылки с меткой b_код, а в воронке его строка.</div>
      ) : (
        <div className="stack">
          {data.items.map((p) => (
            <div key={p.code} className="card" style={{ margin: 0 }}>
              <div className="row between" style={{ gap: 8 }}>
                <div className="grow">
                  <b>{p.name}</b> <span className="muted small">b_{p.code}{p.platform ? ` · ${p.platform}` : ""}</span>
                  <div className="small muted">стартов: {p.starts}{p.url ? <> · <a href={p.url} target="_blank" rel="noreferrer">профиль</a></> : null}</div>
                  {p.note && <div className="small" style={{ marginTop: 4 }}>{p.note}</div>}
                </div>
                <button className="icon-btn" aria-label={`Править ${p.name}`} onClick={() => setEdit(p)}><Pencil size={16} /></button>
                <button
                  className="icon-btn"
                  aria-label={`Удалить ${p.name}`}
                  onClick={async () => {
                    if (await confirm(`Убрать ${p.name} из списка? Метки у пришедших останутся, в воронке будет код b_${p.code}.`)) del.mutate(p.code);
                  }}
                ><Trash2 size={16} /></button>
              </div>
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button className="pill" onClick={() => copy(p.links.app)}><Copy size={14} /> ссылка в приложение</button>
                <button className="pill" onClick={() => copy(p.links.bot)}><Copy size={14} /> ссылка в бота</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <PartnerSheet value={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function PartnerSheet({ value, onClose }: { value: Partner | "new" | null; onClose: () => void }) {
  const isNew = value === "new";
  const p = value && value !== "new" ? value : null;
  const [f, setF] = useState({ code: "", name: "", platform: "", url: "", note: "" });
  const [shownFor, setShownFor] = useState<Partner | "new" | null>(null);
  if (value !== shownFor) {
    setShownFor(value);
    setF({ code: p?.code ?? "", name: p?.name ?? "", platform: p?.platform ?? "", url: p?.url ?? "", note: p?.note ?? "" });
  }
  const save = useAct(
    () => (isNew ? api("/admin/partners", { body: f }) : api(`/admin/partners/${p!.code}`, { method: "PATCH", body: f })),
    ["admin"],
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open={value !== null} onClose={onClose} title={isNew ? "Новый блогер" : p?.name ?? ""}>
      <Field label="Код в ссылке (после b_)">
        <input className="input" value={f.code} disabled={!isNew} onChange={set("code")} placeholder="anya_dima" autoCapitalize="off" />
      </Field>
      <Field label="Имя"><input className="input" value={f.name} onChange={set("name")} placeholder="Аня и Дима" /></Field>
      <Field label="Площадка"><input className="input" value={f.platform} onChange={set("platform")} placeholder="инстаграм" /></Field>
      <Field label="Профиль"><input className="input" value={f.url} onChange={set("url")} placeholder="https://…" inputMode="url" /></Field>
      <Field label="Заметка"><textarea className="input" value={f.note} onChange={set("note")} rows={3} placeholder="условия, даты, промокод" /></Field>
      <button
        className="btn"
        style={{ marginTop: 12 }}
        disabled={save.isPending || !f.name.trim() || !f.code.trim()}
        onClick={() => save.mutate(undefined, { onSuccess: () => { haptic.success(); store.toast(isNew ? "Блогер добавлен" : "Сохранено"); onClose(); } })}
      >
        {isNew ? "Добавить" : "Сохранить"}
      </button>
    </Sheet>
  );
}

// ——— пара и подарок «Вдвоём+» ———

const day = (s: string) => toDate(s.length === 10 ? `${s} 00:00:00` : s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const PLAN_RU: Record<string, string> = { month: "месяц", year: "год", year_offer: "год по акции", forever: "навсегда", date: "до даты" };
type Term = "month" | "year" | "forever" | "date";

function PairBlock({ pair }: { pair: PairInfo }) {
  const [term, setTerm] = useState<Term>("month");
  const [until, setUntil] = useState(() => minusDays(mskToday(), -30));
  const [notify, setNotify] = useState(true);
  const gift = useAct(
    () => api<{ until: string; forever: boolean }>(`/admin/pairs/${pair.id}/plus`, { body: { term, until: term === "date" ? until : undefined, notify } }),
    ["admin"],
  );
  const status = pair.forever ? "навсегда" : pair.plusActive && pair.plusUntil ? `до ${day(pair.plusUntil)}` : "нет";
  const what = term === "forever" ? "навсегда" : term === "date" ? `до ${day(until)}` : term === "year" ? "на год" : "на месяц";
  return (
    <>
      <Section title={`Пара №${pair.id}`} />
      <div className="card pair-plus">
        <div className="small muted" style={{ lineHeight: 1.5 }}>
          {pair.members.map((m) => m.name).join(" и ") || "никого"}
          {pair.pairedAt ? ` · вдвоём с ${day(pair.pairedAt)}` : " · половинка ещё не пришла"}
          {pair.source && <><br />источник: {pair.sourceLabel && pair.sourceLabel !== pair.source ? `${pair.sourceLabel} (${pair.source})` : pair.source}</>}
        </div>
        <div className="row between" style={{ marginTop: 10 }}>
          <span>«Вдвоём+»</span>
          <b className={pair.plusActive ? "plus-on" : "muted"}>{status}</b>
        </div>
        {pair.payments.length > 0 && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {pair.payments.map((x, i) => (
              <div key={i}>{when(x.at)} · {x.method === "gift" ? `🎁 подарок, ${PLAN_RU[x.plan] ?? x.plan}` : `${PLAN_RU[x.plan] ?? x.plan}, ${x.amount} ${x.method === "stars" ? "⭐" : "₽"}`}</div>
            ))}
          </div>
        )}
        {!pair.forever && (
          <>
            <div style={{ height: 12 }} />
            <Pills value={term} onChange={setTerm} items={[["month", "Месяц"], ["year", "Год"], ["forever", "Навсегда"], ["date", "До даты"]]} />
            {term === "date" && (
              <Field label="До какого дня"><input className="input" type="date" value={until} min={mskToday()} onChange={(e) => e.target.value && setUntil(e.target.value)} /></Field>
            )}
            <div className="row between" style={{ marginTop: 10 }}>
              <span className="small">Написать паре в бот</span>
              <Toggle on={notify} onChange={setNotify} label="Написать паре в бот" />
            </div>
            <button
              className="btn"
              style={{ marginTop: 12 }}
              disabled={gift.isPending}
              onClick={async () => {
                if (!(await confirm(`Выдать «Вдвоём+» ${what} паре №${pair.id}? Платить им не нужно, в оплатах будет подарок на 0 ₽.`))) return;
                gift.mutate(undefined, {
                  onSuccess: (r) => {
                    haptic.success();
                    store.toast(r.forever ? "«Вдвоём+» выдан навсегда" : `«Вдвоём+» выдан до ${day(r.until)}`);
                    void queryClient.invalidateQueries({ queryKey: ["admin"] });
                  },
                });
              }}
            >
              <Gift size={18} /> Выдать «Вдвоём+» {what}
            </button>
          </>
        )}
      </div>
    </>
  );
}
