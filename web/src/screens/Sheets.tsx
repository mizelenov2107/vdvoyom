import { Check, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { api, queryClient, useAct, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { accusative, dayLabel, duration, hhmm, parseHhmm, plural } from "../fmt.ts";
import { haptic } from "../tg.ts";
import { store } from "../store.ts";
import { COLOR_HEX, Field, PICKABLE, Sheet, Spinner } from "../ui/kit.tsx";
import type { Win } from "../types.ts";

type Item = Record<string, unknown> & { id: string };

const NEED_MIN: Record<string, number> = { "2h": 150, half: 240, day: 480, night: 900 };

/**
 * Позвать на свидание в выбранное окно. Половинке приходит сообщение с
 * кнопками «Иду» и «Не могу», согласие ложится в календарь само.
 */
export function InviteSheet({ win, idea, onClose }: { win: Win | null; idea?: Item | null; onClose: () => void }) {
  return (
    <Sheet open={!!win} onClose={onClose} title="Позвать на свидание">
      {win && <InviteForm key={`${win.date}-${win.start}`} win={win} idea={idea ?? null} onDone={onClose} />}
    </Sheet>
  );
}

function InviteForm({ win, idea, onDone }: { win: Win; idea: Item | null; onDone: () => void }) {
  const { partner } = useMe();
  const { data } = useApi<{ matches: { item: string; status: string; data: Item }[] }>(["matches", "idea"], "/matches/idea");
  const [picked, setPicked] = useState<Item | null>(idea);
  const [title, setTitle] = useState(idea ? String(idea.title) : "Свидание");
  const [from, setFrom] = useState(hhmm(win.start));
  const [to, setTo] = useState(hhmm(Math.min(win.end, win.start + 180)));
  const [note, setNote] = useState("");
  const len = win.end - win.start;
  const fits = useMemo(
    () => (data?.matches ?? []).filter((m) => m.status !== "done" && len >= (NEED_MIN[String(m.data.duration)] ?? 120)).map((m) => m.data),
    [data, len],
  );
  const real = partner && !partner.ghost;
  const send = useAct(
    () =>
      api("/events", {
        body: {
          kind: "date", title, date: win.date, start_min: parseHhmm(from), end_min: parseHhmm(to), note,
          invite: real, idea_item: picked?.id ?? null,
        },
      }),
    ["events", "home"],
  );
  return (
    <>
      <div className="card flat" style={{ marginTop: -6, marginBottom: 14 }}>
        <div className="caps">{dayLabel(win.date)}</div>
        <div className="num" style={{ fontSize: 22, marginTop: 4 }}>{hhmm(win.start)} – {hhmm(win.end)}</div>
        <div className="small muted">оба свободны {duration(len)}</div>
      </div>
      {fits.length > 0 && (
        <>
          <div className="caps" style={{ margin: "0 4px 8px" }}>Из ваших мэтчей влезает</div>
          <div className="scroll-x" style={{ marginBottom: 14 }}>
            {fits.map((f) => (
              <button
                key={f.id}
                className={`pill${picked?.id === f.id ? " on" : ""}`}
                onClick={() => {
                  haptic.select();
                  setPicked(picked?.id === f.id ? null : f);
                  setTitle(picked?.id === f.id ? "Свидание" : String(f.title));
                }}
              >
                <span className="emoji">{String(f.emoji ?? "💡")}</span> {String(f.title)}
              </button>
            ))}
          </div>
        </>
      )}
      <Field label="Куда">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid-2">
        <Field label="С">
          <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="До">
          <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Пара слов">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Встретимся у метро" />
      </Field>
      <button
        className="btn"
        disabled={!title.trim() || send.isPending}
        onClick={() =>
          send.mutate(undefined, {
            onSuccess: () => {
              haptic.success();
              store.toast(real ? "Приглашение отправлено 💌" : "Записано в календарь");
              onDone();
            },
          })
        }
      >
        <Send size={18} /> {real ? `Позвать ${accusative(partner!.name)}` : "Записать в календарь"}
      </button>
      {!real && partner?.ghost && (
        <p className="small muted center" style={{ marginBottom: 0 }}>
          {partner.name} ещё не в приложении — приглашение с кнопками придёт, когда зайдёт.
        </p>
      )}
    </>
  );
}

/** Завести половинку заранее: имя, цвет, день рождения и, если учится в РЭУ, её группа. */
export function GhostSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("rose");
  const [birthday, setBirthday] = useState("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data } = useApi<{ groups: { key: string; name: string; meta: string }[] }>(["rea-search", q], q.length >= 2 ? `/schedule/rea/search?q=${encodeURIComponent(q)}` : null);

  async function save() {
    setBusy(true);
    try {
      await api("/pair/partner", { body: { name, color, birthday: birthday || null } });
      if (group) {
        const r = await api<{ imported: number }>("/schedule/rea?for=partner", { body: { group } });
        store.toast(`Подтянуто ${r.imported} ${plural(r.imported, "пара", "пары", "пар")}`);
      }
      await queryClient.invalidateQueries();
      haptic.success();
      onClose();
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Партнёр заранее">
      <p className="small muted" style={{ marginTop: -8 }}>
        Окна и календарь заработают сразу, ещё до того, как партнёр зайдёт. При входе по приглашению всё перейдёт в его аккаунт.
      </p>
      <Field label="Имя">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя партнёра" />
      </Field>
      <Field label="Цвет партнёра">
        <div className="row" style={{ gap: 10 }}>
          {PICKABLE.map((k) => (
            <button
              key={k}
              onClick={() => setColor(k)}
              style={{ width: 36, height: 36, borderRadius: "50%", background: COLOR_HEX[k], display: "grid", placeItems: "center", color: "#fff", boxShadow: color === k ? `0 0 0 3px var(--card), 0 0 0 5px ${COLOR_HEX[k]}` : "none" }}
            >
              {color === k && <Check size={16} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </Field>
      <Field label="День рождения">
        <input className="input" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
      </Field>
      <Field label="Группа в РЭУ — если учится там">
        <input className="input" value={group ?? q} onChange={(e) => { setGroup(null); setQ(e.target.value); }} placeholder="гдэ02а/26" />
      </Field>
      {!group && (data?.groups ?? []).length > 0 && (
        <div className="stack" style={{ marginBottom: 12 }}>
          {data!.groups.slice(0, 5).map((g) => (
            <button key={g.key} className="card flat" style={{ width: "100%", textAlign: "left", padding: 12 }} onClick={() => setGroup(g.key)}>
              <div style={{ fontWeight: 700 }}>{g.name}</div>
              <div className="small muted">{g.meta}</div>
            </button>
          ))}
        </div>
      )}
      <button className="btn" disabled={!name.trim() || busy} onClick={save}>
        {busy ? "Сохраняю…" : "Сохранить"}
      </button>
      {busy && <Spinner />}
    </Sheet>
  );
}
