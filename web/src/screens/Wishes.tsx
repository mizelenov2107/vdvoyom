import { motion } from "motion/react";
import { Archive, ExternalLink, Gift, Link2, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, useAct, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { dayMonth, genitive, human, money } from "../fmt.ts";
import { confirm, haptic, openLink } from "../tg.ts";
import { nav, store } from "../store.ts";
import { Avatar, Empty, Field, Head, Pills, Progress, Section, Segmented, Sheet, Spinner } from "../ui/kit.tsx";

interface Wish {
  id: number;
  owner_id: number;
  title: string;
  url: string | null;
  price: number | null;
  image: string | null;
  level: number;
  note: string | null;
  reserved_by: number | null;
  done_at: string | null;
}

interface Entry {
  id: number;
  plan_id: number;
  user_id: number;
  amount: number;
  note: string | null;
  created_at: string;
}

interface Plan {
  id: number;
  author_id: number;
  kind: string;
  title: string;
  target: number;
  currency: string;
  due: string | null;
  archived_at: string | null;
  saved: number;
  spent: number;
  byUser: Record<string, { in: number; out: number }>;
  entries: Entry[];
}

const LEVELS = ["", "можно", "хочу", "очень хочу"];

export function WishesScreen() {
  const [seg, setSeg] = useState<"wishes" | "plans">("wishes");
  const [adding, setAdding] = useState(false);
  return (
    <div className="screen">
      <Head
        caption={seg === "wishes" ? "что подарить" : "копим вместе"}
        title={seg === "wishes" ? "Хотелки" : "Планы"}
        actions={<button className="icon-btn" onClick={() => setAdding(true)} aria-label="Добавить"><Plus size={20} /></button>}
      />
      <Segmented value={seg} onChange={setSeg} items={[["wishes", "Хотелки"], ["plans", "Планы"]]} />
      {seg === "wishes" ? <WishList adding={adding} setAdding={setAdding} /> : <PlanList adding={adding} setAdding={setAdding} />}
    </div>
  );
}

// ——— хотелки ———

function WishList({ adding, setAdding }: { adding: boolean; setAdding: (v: boolean) => void }) {
  const { me, partner, theyColor, meColor } = useMe();
  const { data } = useApi<{ wishes: Wish[] }>(["wishes"], "/wishes");
  const [filter, setFilter] = useState<string>("partner");
  const [open, setOpen] = useState<Wish | null>(null);
  const wishes = data?.wishes ?? [];
  const theirs = wishes.filter((w) => w.owner_id === partner?.id && !w.done_at);
  const mine = wishes.filter((w) => w.owner_id === me?.id && !w.done_at);
  const done = wishes.filter((w) => w.done_at);
  const f = partner ? filter : "mine";
  const list = f === "partner" ? theirs : f === "mine" ? mine : f === "done" ? done : wishes.filter((w) => !w.done_at);

  return (
    <>
      <Pills
        value={f}
        onChange={setFilter}
        scroll
        items={[
          ...(partner ? ([["partner", `${partner.name} · ${theirs.length}`, theyColor]] as [string, string, string][]) : []),
          ["mine", `Мои · ${mine.length}`, meColor],
          ["all", "Все"],
          ...(done.length ? ([["done", `Подарено · ${done.length}`]] as [string, string][]) : []),
        ]}
      />
      {!data ? (
        <Spinner />
      ) : !list.length ? (
        f === "partner" ? (
          <Empty art="gift" title={`У ${genitive(partner!.name)} пока пусто`} text="Когда появятся хотелки, ты увидишь их здесь и сможешь тайно забронировать подарок." />
        ) : (
          <Empty art="gift" title="Список желаний пуст" text="Вставь ссылку на товар — название, цена и картинка подтянутся сами.">
            <button className="btn inline" onClick={() => setAdding(true)}>Добавить хотелку</button>
          </Empty>
        )
      ) : (
        <div className="stack">
          {list.map((w) => (
            <WishCard key={w.id} w={w} onOpen={() => setOpen(w)} />
          ))}
        </div>
      )}
      <WishSheet open={adding} onClose={() => setAdding(false)} />
      <WishDetail w={open} onClose={() => setOpen(null)} />
    </>
  );
}

function WishCard({ w, onOpen }: { w: Wish; onOpen: () => void }) {
  const { me, colorFor } = useMe();
  const mine = w.owner_id === me?.id;
  const reservedByMe = w.reserved_by === me?.id;
  return (
    <motion.div whileTap={{ scale: 0.985 }} className="card row" style={{ padding: 12, alignItems: "stretch" }} onClick={onOpen}>
      {w.image ? (
        <img className="thumb-img" style={{ width: 76, height: 76 }} src={w.image} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      ) : (
        <div className="thumb-img" style={{ width: 76, height: 76 }}>🎁</div>
      )}
      <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 6 }}>
        <div>
          <div style={{ fontWeight: 650, lineHeight: 1.25 }}>{w.title}</div>
          {w.price ? <div className="num" style={{ fontSize: 17, marginTop: 4 }}>{money(w.price)}</div> : null}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className={`chip${w.level === 3 ? " solid" : ""}`} style={{ ["--c" as string]: colorFor(w.owner_id) }}>{LEVELS[w.level]}</span>
          {!mine && reservedByMe && <span className="chip solid" style={{ ["--c" as string]: "var(--green)" }}>🎁 даришь ты</span>}
          {!mine && w.reserved_by && !reservedByMe && <span className="chip">уже кто-то дарит</span>}
          {w.done_at && <span className="chip">подарено</span>}
        </div>
      </div>
    </motion.div>
  );
}

function WishDetail({ w, onClose }: { w: Wish | null; onClose: () => void }) {
  const { me, partner } = useMe();
  const act = useAct((body: Record<string, unknown>) => api(`/wishes/${w!.id}`, { method: "PATCH", body }), ["wishes", "home"]);
  const del = useAct(() => api(`/wishes/${w!.id}`, { method: "DELETE" }), ["wishes"]);
  const mine = w?.owner_id === me?.id;
  return (
    <Sheet open={!!w} onClose={onClose} title={w?.title}>
      {w && (
        <>
          {w.image && <img src={w.image} alt="" referrerPolicy="no-referrer" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 18, background: "#fff", marginBottom: 14 }} />}
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="num" style={{ fontSize: 26 }}>{w.price ? money(w.price) : "цена не указана"}</div>
            <span className="chip">{LEVELS[w.level]}</span>
          </div>
          {w.note && <p style={{ marginTop: 0 }}>{w.note}</p>}
          <div className="stack">
            {w.url && (
              <button className="btn soft" onClick={() => openLink(w.url!)}>
                <ExternalLink size={18} /> Открыть ссылку
              </button>
            )}
            {!mine && !w.done_at && (
              w.reserved_by === me?.id ? (
                <button className="btn soft" onClick={() => act.mutate({ action: "unreserve" }, { onSuccess: onClose })}>Отменить бронь</button>
              ) : !w.reserved_by ? (
                <button className="btn tint" style={{ ["--c" as string]: "var(--green)" }} onClick={() => act.mutate({ action: "reserve" }, { onSuccess: () => { haptic.success(); store.toast(`${partner?.name} об этом не узнает 🤫`); onClose(); } })}>
                  <Gift size={18} /> Подарю я — тайно
                </button>
              ) : null
            )}
            {!w.done_at ? (
              <button className="btn soft" onClick={() => act.mutate({ action: "done" }, { onSuccess: () => { haptic.success(); onClose(); } })}>
                {mine ? "Мне это подарили 🎉" : "Уже подарено 🎉"}
              </button>
            ) : (
              <button className="btn soft" onClick={() => act.mutate({ action: "undo" }, { onSuccess: onClose })}>Вернуть в список</button>
            )}
            {mine && (
              <button className="btn danger" onClick={async () => (await confirm("Удалить хотелку?")) && del.mutate(undefined, { onSuccess: onClose })}>
                <Trash2 size={18} /> Удалить
              </button>
            )}
          </div>
          {!mine && <p className="small muted center" style={{ marginBottom: 0 }}>Бронь видишь только ты. {partner?.name} увидит лишь подарок.</p>}
        </>
      )}
    </Sheet>
  );
}

function WishSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [level, setLevel] = useState("2");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const add = useAct(
    () => api("/wishes", { body: { url: url || null, title, price: price ? Number(price.replace(/\D/g, "")) : null, image, level: Number(level), note } }),
    ["wishes"],
  );

  // Вставили ссылку — через полсекунды пробуем достать название, цену и картинку
  useEffect(() => {
    if (!/^https?:\/\/\S+\.\S+/.test(url)) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = await api<{ title: string | null; price: number | null; image: string | null }>("/wishes/preview", { body: { url } });
        if (p.title && !title) setTitle(p.title);
        if (p.price && !price) setPrice(String(p.price));
        if (p.image) setImage(p.image);
        if (!p.title && !p.image) store.toast("Магазин не отдал описание — заполни руками");
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [url]);

  const reset = () => {
    setUrl(""); setTitle(""); setPrice(""); setImage(null); setLevel("2"); setNote("");
  };

  return (
    <Sheet open={open} onClose={onClose} title="Новая хотелка">
      <Field label="Ссылка на товар">
        <div className="row" style={{ gap: 8 }}>
          <Link2 size={18} className="faint" />
          <input className="input" inputMode="url" aria-label="Ссылка на товар" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://…" />
        </div>
      </Field>
      {loading && <div className="small muted" style={{ margin: "-4px 4px 10px" }}>Смотрю, что там…</div>}
      {image && <img src={image} alt="" referrerPolicy="no-referrer" style={{ height: 120, borderRadius: 14, margin: "0 auto 12px", background: "#fff" }} />}
      <Field label="Что хочется">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ваза Fern Studio" />
      </Field>
      <Field label="Цена, ₽">
        <input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="7400" />
      </Field>
      <Field label="Насколько хочется">
        <Pills value={level} onChange={setLevel} items={[["1", "можно"], ["2", "хочу"], ["3", "очень хочу"]]} />
      </Field>
      <Field label="Подсказка">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Размер S, цвет — любой, кроме белого" />
      </Field>
      <button className="btn" disabled={!title.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); reset(); onClose(); } })}>
        Добавить
      </button>
    </Sheet>
  );
}

// ——— планы и копилки ———

const PLAN_KINDS = ["поездка", "покупка", "ремонт", "событие", "подарок", "другое"];

function PlanList({ adding, setAdding }: { adding: boolean; setAdding: (v: boolean) => void }) {
  const { data } = useApi<{ plans: Plan[] }>(["plans"], "/plans");
  const [archive, setArchive] = useState(false);
  const active = (data?.plans ?? []).filter((p) => !p.archived_at);
  const old = (data?.plans ?? []).filter((p) => p.archived_at);
  return (
    <>
      {!data ? (
        <Spinner />
      ) : !active.length ? (
        <Empty art="jar" title="Копилок пока нет" text="Поездка, покупка, событие — заведите цель и складывайтесь. Видно, кто сколько внёс и сколько осталось.">
          <button className="btn inline" onClick={() => setAdding(true)}>Завести план</button>
        </Empty>
      ) : (
        <div className="stack">
          {active.map((p) => <PlanCard key={p.id} p={p} />)}
        </div>
      )}
      {old.length > 0 && (
        <>
          <Section title="Архив" action={<button className="link" onClick={() => setArchive(!archive)}>{archive ? "Скрыть" : `Показать ${old.length}`}</button>} />
          {archive && <div className="stack">{old.map((p) => <PlanCard key={p.id} p={p} />)}</div>}
        </>
      )}
      <PlanSheet open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function PlanCard({ p }: { p: Plan }) {
  const { me, partner, meColor, theyColor, colorFor } = useMe();
  const balance = p.saved - p.spent;
  const over = p.target > 0 && p.spent > p.target;
  const base = Math.max(p.target, p.saved, 1);
  const mineIn = p.byUser[String(me?.id)]?.in ?? 0;
  const theirIn = partner ? p.byUser[String(partner.id)]?.in ?? 0 : 0;
  return (
    <motion.div whileTap={{ scale: 0.985 }} className="card" style={{ opacity: p.archived_at ? 0.6 : 1 }} onClick={() => nav.push("plan", { id: p.id })}>
      <div className="row between">
        <div className="caps">{p.kind}</div>
        <div className="row" style={{ gap: 6 }}>
          {over && <span className="chip solid" style={{ ["--c" as string]: "var(--red)" }}>+{money(p.spent - p.target, p.currency)}</span>}
          <div className="dot" style={{ width: 22, height: 22, ["--c" as string]: colorFor(p.author_id) }} />
        </div>
      </div>
      <div className="title-md" style={{ margin: "4px 0 14px", fontSize: 20 }}>{p.title}</div>
      <Progress
        parts={
          over
            ? [{ value: 100, color: "var(--red)" }]
            : [
                { value: (mineIn / base) * 100, color: meColor },
                { value: (theirIn / base) * 100, color: theyColor },
              ]
        }
      />
      <div className="row between" style={{ marginTop: 10 }}>
        <div className="num" style={{ fontSize: 19, color: over ? "var(--red)" : "var(--text)" }}>{money(over ? p.spent : balance, p.currency)}</div>
        {p.target > 0 && <div className="mono-sm">из {money(p.target, p.currency)}</div>}
      </div>
    </motion.div>
  );
}

export function PlanScreen({ id }: { id: number }) {
  const { me, partner, meColor, theyColor, personFor, colorFor } = useMe();
  const { data } = useApi<{ plans: Plan[] }>(["plans"], "/plans");
  const p = data?.plans.find((x) => x.id === id);
  const [entry, setEntry] = useState<"in" | "out" | null>(null);
  const act = useAct((body: Record<string, unknown>) => api(`/plans/${id}`, { method: "PATCH", body }), ["plans", "home"]);
  const del = useAct(() => api(`/plans/${id}`, { method: "DELETE" }), ["plans"]);
  const delEntry = useAct((eid: number) => api(`/plans/${id}/entries/${eid}`, { method: "DELETE" }), ["plans"]);

  const people = useMemo(() => [me, partner].filter(Boolean) as NonNullable<typeof me>[], [me, partner]);
  if (!p) return <Spinner />;
  const balance = p.saved - p.spent;
  const left = Math.max(0, p.target - p.saved);

  return (
    <>
      <Head back caption={p.kind + (p.due ? ` · до ${dayMonth(p.due)}` : "")} title={p.title} />
      <div className="card">
        <div className="caps">в копилке</div>
        <div className="num" style={{ fontSize: 42, margin: "6px 0 14px" }}>{money(balance, p.currency)}</div>
        {p.target > 0 && (
          <>
            <Progress
              parts={[
                { value: ((p.byUser[String(me?.id)]?.in ?? 0) / Math.max(p.target, 1)) * 100, color: meColor },
                { value: (partner ? (p.byUser[String(partner.id)]?.in ?? 0) / Math.max(p.target, 1) : 0) * 100, color: theyColor },
              ]}
            />
            <div className="row between small muted" style={{ marginTop: 10 }}>
              <span>цель {money(p.target, p.currency)}</span>
              <span>{left ? `осталось ${money(left, p.currency)}` : "цель собрана 🎉"}</span>
            </div>
          </>
        )}
        {p.spent > 0 && <div className="small" style={{ marginTop: 10, color: p.target && p.spent > p.target ? "var(--red)" : "var(--muted)" }}>потрачено {money(p.spent, p.currency)}</div>}
      </div>

      <div className="grid-2" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setEntry("in")}><Plus size={18} /> Внести</button>
        <button className="btn soft" onClick={() => setEntry("out")}><Minus size={18} /> Трата</button>
      </div>

      <Section title="Кто сколько" />
      <div className="grid-2">
        {people.map((u) => (
          <div key={u.id} className="card" style={{ margin: 0 }}>
            <Avatar p={u} size={30} />
            <div className="num" style={{ fontSize: 22, marginTop: 10, color: colorFor(u.id) }}>{money(p.byUser[String(u.id)]?.in ?? 0, p.currency)}</div>
            <div className="small muted">
              {u.id === me?.id ? "твой вклад" : `вклад ${genitive(u.name)}`}
              {(p.byUser[String(u.id)]?.out ?? 0) > 0 ? ` · траты ${money(p.byUser[String(u.id)].out, p.currency)}` : ""}
            </div>
          </div>
        ))}
      </div>

      {p.entries.length > 0 && <Section title="История" />}
      <div className="stack">
        {p.entries.map((e) => (
          <div key={e.id} className="card row" style={{ padding: 12 }}>
            <div className="dot" style={{ ["--c" as string]: colorFor(e.user_id) }} />
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{e.note || (e.amount > 0 ? "Взнос" : "Трата")}</div>
              <div className="mono-sm">{personFor(e.user_id)?.id === me?.id ? "ты" : personFor(e.user_id)?.name} · {human(e.created_at.slice(0, 10))}</div>
            </div>
            <div className="num" style={{ color: e.amount > 0 ? "var(--green)" : "var(--red)" }}>
              {e.amount > 0 ? "+" : "−"}{money(Math.abs(e.amount), p.currency)}
            </div>
            <button className="icon-btn ghost" onClick={async () => (await confirm("Удалить запись?")) && delEntry.mutate(e.id)} aria-label="Удалить"><Trash2 size={15} className="faint" /></button>
          </div>
        ))}
      </div>

      <div className="stack" style={{ marginTop: 22 }}>
        <button className="btn soft" onClick={() => act.mutate({ action: p.archived_at ? "unarchive" : "archive" }, { onSuccess: () => { store.toast(p.archived_at ? "Вернули из архива" : "План в архиве"); nav.back(); } })}>
          <Archive size={18} /> {p.archived_at ? "Вернуть из архива" : "Завершить и в архив"}
        </button>
        <button className="btn danger" onClick={async () => (await confirm("Удалить план со всей историей?")) && del.mutate(undefined, { onSuccess: () => nav.back() })}>
          <Trash2 size={18} /> Удалить
        </button>
      </div>
      <EntrySheet mode={entry} plan={p} onClose={() => setEntry(null)} />
    </>
  );
}

function EntrySheet({ mode, plan, onClose }: { mode: "in" | "out" | null; plan: Plan; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const add = useAct(
    () => api(`/plans/${plan.id}/entries`, { body: { amount: (mode === "out" ? -1 : 1) * Number(amount.replace(/\D/g, "")), note } }),
    ["plans"],
  );
  const quick = [500, 1000, 2000, 5000];
  return (
    <Sheet open={!!mode} onClose={onClose} title={mode === "in" ? "Положить в копилку" : "Записать трату"}>
      <input className="input num" style={{ fontSize: 30, textAlign: "center", padding: 18 }} inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`0 ${plan.currency}`} />
      <div className="grid-4" style={{ margin: "12px 0" }}>
        {quick.map((q) => (
          <button key={q} className="pill" onClick={() => setAmount(String((Number(amount.replace(/\D/g, "")) || 0) + q))}>+{q}</button>
        ))}
      </div>
      <Field label="На что">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "in" ? "Стипендия" : "Билеты на поезд"} />
      </Field>
      <button
        className="btn"
        disabled={!Number(amount.replace(/\D/g, "")) || add.isPending}
        onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); setAmount(""); setNote(""); onClose(); } })}
      >
        {mode === "in" ? "Внести" : "Записать"}
      </button>
    </Sheet>
  );
}

function PlanSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState("поездка");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [currency, setCurrency] = useState("₽");
  const [due, setDue] = useState("");
  const add = useAct(() => api("/plans", { body: { kind, title, target: Number(target.replace(/\D/g, "")) || 0, currency, due: due || null } }), ["plans"]);
  return (
    <Sheet open={open} onClose={onClose} title="Новый план">
      <Pills value={kind} onChange={setKind} scroll items={PLAN_KINDS.map((k) => [k, k])} />
      <Field label="Название">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "поездка" ? "Питер на выходные" : "Новая кофемашина"} />
      </Field>
      <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
        <div className="grow">
          <Field label="Цель">
            <input className="input" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="40 000" />
          </Field>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Pills value={currency} onChange={setCurrency} items={[["₽", "₽"], ["€", "€"], ["$", "$"]]} />
        </div>
      </div>
      <Field label="Срок">
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <button className="btn" disabled={!title.trim()} onClick={() => add.mutate(undefined, { onSuccess: () => { haptic.success(); setTitle(""); setTarget(""); onClose(); } })}>
        Завести
      </button>
      <p className="small muted center" style={{ marginBottom: 0 }}>Цель можно оставить пустой — тогда это просто общий кошелёк.</p>
    </Sheet>
  );
}
