import { motion } from "motion/react";
import { Bookmark, Camera, Check, ImagePlus, Lock, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, queryClient, upload, useAct, useApi } from "../api.ts";
import { useMe } from "../data.ts";
import { addDays, dayLabel, dayMonth, genitive, today } from "../fmt.ts";
import { shrink } from "../media.ts";
import { confirm, haptic } from "../tg.ts";
import { store } from "../store.ts";
import { Empty, Field, Head, Pills, Section, Segmented, Sheet, Spinner } from "../ui/kit.tsx";
import {
  CATEGORY_LABEL, dominantColor, missing, NAMED, nearestName, OCCASIONS, PAIR_MODES, pairLooks, STYLE_LABEL, weatherLine,
  type Category, type Occasion, type PairLook, type PairMode, type StyleTag, type Weather, type WItem,
} from "../style.ts";

const CATS: Category[] = ["top", "bottom", "dress", "outer", "shoes", "accessory"];

export function WardrobeScreen() {
  const { me, partner } = useMe();
  const [tab, setTab] = useState<"looks" | "mine" | "theirs">("looks");
  const { data } = useApi<{ items: WItem[] }>(["wardrobe"], "/wardrobe");
  const items = data?.items ?? [];
  const mine = items.filter((i) => i.owner_id === me?.id);
  const theirs = partner ? items.filter((i) => i.owner_id === partner.id) : [];
  return (
    <>
      <Head back caption="гардероб и парные луки" title="Что надеть" />
      <Segmented
        value={tab}
        onChange={setTab}
        items={[["looks", "Парные луки"], ["mine", `Мои · ${mine.length}`], ...(partner ? ([["theirs", `${partner.name} · ${theirs.length}`]] as [typeof tab, string][]) : [])]}
      />
      {!data ? (
        <Spinner />
      ) : tab === "looks" ? (
        <Looks mine={mine} theirs={theirs} all={items} onGo={setTab} />
      ) : (
        <Closet items={tab === "mine" ? mine : theirs} editable={tab === "mine" || !!partner?.ghost} forPartner={tab === "theirs"} />
      )}
    </>
  );
}

// ——— гардероб одного человека ———

function Closet({ items, editable, forPartner }: { items: WItem[]; editable: boolean; forPartner: boolean }) {
  const { partner } = useMe();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<WItem | null>(null);
  return (
    <>
      {editable && (
        <button className="btn" style={{ marginBottom: 14 }} onClick={() => setAdding(true)}>
          <ImagePlus size={18} /> Добавить вещь
        </button>
      )}
      {!items.length ? (
        <Empty
          art="gift"
          title={forPartner ? `У ${genitive(partner?.name ?? "")} пока пусто` : "Гардероб пуст"}
          text={forPartner ? "Когда появятся вещи, приложение начнёт собирать луки на двоих." : "Сфотографируй вещи: верх, низ, обувь, верхнюю одежду. Цвет приложение определит само, а потом соберёт образы на двоих."}
        />
      ) : (
        CATS.map((cat) => {
          const list = items.filter((i) => i.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat}>
              <Section title={`${CATEGORY_LABEL[cat]} · ${list.length}`} />
              <div className="grid-3" style={{ gap: 8 }}>
                {list.map((i) => (
                  <motion.button key={i.id} whileTap={{ scale: 0.95 }} className="wd-tile" onClick={() => setOpen(i)}>
                    <img src={i.url} alt="" loading="lazy" />
                    <span className="wd-dot" style={{ background: i.color }} title={i.color_name} />
                  </motion.button>
                ))}
              </div>
            </div>
          );
        })
      )}
      <AddItemSheet open={adding} onClose={() => setAdding(false)} forPartner={forPartner} />
      <ItemSheet item={open} editable={editable} forPartner={forPartner} onClose={() => setOpen(null)} />
    </>
  );
}

function StyleChips({ value, onChange }: { value: StyleTag[]; onChange: (v: StyleTag[]) => void }) {
  return (
    <div className="pills">
      {(Object.keys(STYLE_LABEL) as StyleTag[]).map((s) => (
        <button key={s} className={`pill${value.includes(s) ? " on" : ""}`} onClick={() => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s])}>
          {STYLE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (name: string, hex: string) => void }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {NAMED.map((n) => (
        <button
          key={n.name}
          onClick={() => onChange(n.name, n.hex)}
          title={n.name}
          aria-label={n.name}
          style={{ width: 30, height: 30, borderRadius: "50%", background: n.hex, border: "1px solid var(--line)", boxShadow: value === n.name ? `0 0 0 2px var(--card), 0 0 0 4px var(--text)` : "none" }}
        />
      ))}
    </div>
  );
}

/** Новая вещь: фото → цвет определяется сам → вид, теплота, стиль. */
function AddItemSheet({ open, onClose, forPartner }: { open: boolean; onClose: () => void; forPartner: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  // Отдельный вход для камеры: на андроиде в телеграме accept="image/*" без capture
  // открывает только выбор файла, снять вещь было нельзя (отзыв #1 от 28.09.2026)
  const camera = useRef<HTMLInputElement>(null);
  const last = useRef<"camera" | "gallery">("camera");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [color, setColor] = useState({ name: "", hex: "#888888" });
  const [category, setCategory] = useState<Category | "">("");
  const [warmth, setWarmth] = useState("2");
  const [styles, setStyles] = useState<StyleTag[]>(["casual"]);
  const [busy, setBusy] = useState(false);

  async function pick(f: File) {
    const { blob } = await shrink(f, 900);
    const hex = await dominantColor(blob);
    const name = nearestName(hex);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    setColor({ name, hex: NAMED.find((n) => n.name === name)!.hex });
  }

  async function save(again: boolean) {
    if (!photo || !category) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", photo.blob, "item.jpg");
      form.append("category", category);
      form.append("color", color.hex);
      form.append("color_name", color.name);
      form.append("warmth", warmth);
      form.append("styles", styles.join(","));
      await upload(`/wardrobe${forPartner ? "?for=partner" : ""}`, form);
      haptic.success();
      await queryClient.invalidateQueries({ queryKey: ["wardrobe"] });
      setPhoto(null);
      setCategory("");
      if (again) (last.current === "camera" ? camera : input).current?.click();
      else onClose();
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Новая вещь">
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pick(f); }} />
      {!photo ? (
        <>
          <button className="btn" onClick={() => { last.current = "camera"; camera.current?.click(); }}><Camera size={18} /> Сфотографировать</button>
          <button className="btn soft" style={{ marginTop: 8 }} onClick={() => { last.current = "gallery"; input.current?.click(); }}><ImagePlus size={18} /> Выбрать из галереи</button>
          <p className="small muted center">Лучше на однотонном фоне — на кровати, полу или вешалке. Цвет определится сам.</p>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 14, marginBottom: 14 }}>
            <img src={photo.url} alt="" style={{ width: 110, height: 140, objectFit: "cover", borderRadius: 16 }} />
            <div className="grow">
              <div className="caps">Цвет</div>
              <div className="row" style={{ gap: 8, margin: "6px 0 10px" }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: color.hex, border: "1px solid var(--line)" }} />
                <b>{color.name}</b>
              </div>
              <div className="small muted">Если не угадал — выбери ниже</div>
            </div>
          </div>
          <ColorPicker value={color.name} onChange={(name, hex) => setColor({ name, hex })} />
          <div style={{ height: 14 }} />
          <Field label="Что это">
            <Pills value={category} onChange={(v) => setCategory(v as Category)} scroll items={CATS.map((c) => [c, CATEGORY_LABEL[c]])} />
          </Field>
          <Field label="Насколько тёплое">
            <Pills value={warmth} onChange={setWarmth} items={[["1", "лёгкое"], ["2", "среднее"], ["3", "тёплое"]]} />
          </Field>
          <Field label="Куда подходит">
            <StyleChips value={styles} onChange={setStyles} />
          </Field>
          <div className="grid-2">
            <button className="btn soft" disabled={!category || busy} onClick={() => save(true)}>Ещё вещь</button>
            <button className="btn" disabled={!category || busy} onClick={() => save(false)}>Готово</button>
          </div>
          {!category && <p className="small muted center" style={{ marginBottom: 0 }}>Выбери, что это за вещь</p>}
        </>
      )}
    </Sheet>
  );
}

function ItemSheet({ item, editable, forPartner, onClose }: { item: WItem | null; editable: boolean; forPartner: boolean; onClose: () => void }) {
  const q = forPartner ? "?for=partner" : "";
  const patch = useAct((body: Record<string, unknown>) => api(`/wardrobe/${item!.id}${q}`, { method: "PATCH", body }), ["wardrobe"]);
  const del = useAct(() => api(`/wardrobe/${item!.id}${q}`, { method: "DELETE" }), ["wardrobe"]);
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? CATEGORY_LABEL[item.category] : ""}>
      {item && (
        <>
          <img src={item.url} alt="" style={{ width: "100%", maxHeight: "42dvh", objectFit: "contain", borderRadius: 18, background: "var(--card-2)", marginBottom: 14 }} />
          {editable ? (
            <>
              <Field label={`Цвет: ${item.color_name}`}>
                <ColorPicker value={item.color_name} onChange={(name, hex) => patch.mutate({ color_name: name, color: hex })} />
              </Field>
              <Field label="Что это">
                <Pills value={item.category} onChange={(v) => patch.mutate({ category: v })} scroll items={CATS.map((c) => [c, CATEGORY_LABEL[c]])} />
              </Field>
              <Field label="Насколько тёплое">
                <Pills value={String(item.warmth)} onChange={(v) => patch.mutate({ warmth: Number(v) })} items={[["1", "лёгкое"], ["2", "среднее"], ["3", "тёплое"]]} />
              </Field>
              <Field label="Куда подходит">
                <StyleChips value={item.styles} onChange={(v) => patch.mutate({ styles: v })} />
              </Field>
              <button className="btn danger" onClick={async () => (await confirm("Убрать вещь из гардероба?")) && del.mutate(undefined, { onSuccess: onClose })}>
                <Trash2 size={17} /> Убрать
              </button>
            </>
          ) : (
            <p className="muted">{item.color_name} · {["", "лёгкое", "среднее", "тёплое"][item.warmth]} · {item.styles.map((s) => STYLE_LABEL[s]).join(", ")}</p>
          )}
        </>
      )}
    </Sheet>
  );
}

// ——— парные луки ———

function Looks({ mine, theirs, all, onGo }: { mine: WItem[]; theirs: WItem[]; all: WItem[]; onGo: (t: "mine" | "theirs") => void }) {
  const { me, partner, meColor, theyColor } = useMe();
  const [occasion, setOccasion] = useState<Occasion>("date");
  const [mode, setMode] = useState<PairMode>("auto");
  const [day, setDay] = useState(today());
  const [locked, setLocked] = useState<number[]>([]);
  const [seed, setSeed] = useState(0);
  const { data: wx } = useApi<{ days: Record<string, Weather> }>(["weather"], "/weather");
  const { data: saved } = useApi<{ looks: { id: number; title: string; occasion: string | null; date: string | null; items: Record<string, number[]> }[] }>(["looks"], "/looks");
  const w = wx?.days[day] ?? null;
  const save = useAct((l: PairLook) =>
    api("/looks", {
      body: {
        title: `${OCCASIONS.find((o) => o[0] === occasion)![2]} · ${dayMonth(day)}`,
        occasion,
        date: day,
        items: { [String(me!.id)]: l.mine.items.map((i) => i.id), [String(partner!.id)]: l.theirs.items.map((i) => i.id) },
      },
    }), ["looks"]);
  const delLook = useAct((id: number) => api(`/looks/${id}`, { method: "DELETE" }), ["looks"]);

  const needMine = missing(mine);
  const needTheirs = partner ? missing(theirs) : "сначала позови партнёра";
  const looks = useMemo(
    () => (needMine || needTheirs ? [] : pairLooks(mine, theirs, occasion, mode, w, locked)),
    [mine, theirs, occasion, mode, w, locked, needMine, needTheirs],
  );
  const shown = looks.length ? [...looks.slice(seed % looks.length), ...looks.slice(0, seed % looks.length)] : [];
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(today(), n));
  const byId = (id: number) => all.find((i) => i.id === id);

  const toggleLock = (id: number) => {
    haptic.select();
    setLocked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  };

  const Column = ({ items, color, label }: { items: WItem[]; color: string; label: string }) => (
    <div className="grow" style={{ minWidth: 0 }}>
      <div className="small" style={{ fontWeight: 800, color, marginBottom: 6 }}>{label}</div>
      <div className="look-col">
        {items.map((i) => (
          <button key={i.id} className={`look-item${locked.includes(i.id) ? " locked" : ""}`} onClick={() => toggleLock(i.id)}>
            <img src={i.url} alt="" />
            {locked.includes(i.id) && <span className="lock"><Lock size={12} /></span>}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Pills value={occasion} onChange={(v) => { setOccasion(v); setSeed(0); }} scroll items={OCCASIONS.map(([k, e, l]) => [k, `${e} ${l}`])} />
      <div className="pills scroll">
        {days.map((d) => (
          <button key={d} className={`pill${day === d ? " on" : ""}`} onClick={() => setDay(d)}>
            {dayLabel(d).split(",")[0]}
            {wx?.days[d] ? ` · ${Math.round(wx.days[d].tmax)}°` : ""}
          </button>
        ))}
      </div>
      <Pills value={mode} onChange={setMode} scroll items={PAIR_MODES} />
      <div className="small muted" style={{ margin: "-4px 4px 12px" }}>
        {dayLabel(day)}: {weatherLine(w)}. Нажми на вещь, чтобы закрепить её — остальное подберётся под неё.
      </div>

      {needMine || needTheirs ? (
        <Empty art="match" title="Пока не из чего собрать" text={needMine ? `В твоём гардеробе ${needMine}.` : partner?.ghost || !partner ? `Нужен гардероб ${genitive(partner?.name ?? "партнёра")}: ${needTheirs}.` : `У ${genitive(partner.name)} ${needTheirs}.`}>
          <button className="btn inline" onClick={() => onGo(needMine ? "mine" : "theirs")}>{needMine ? "Добавить свои вещи" : "Открыть гардероб партнёра"}</button>
        </Empty>
      ) : !shown.length ? (
        <Empty art="match" title="Под этот повод не нашлось" text="Отметь у вещей, куда они подходят, или поменяй повод и режим." />
      ) : (
        <>
          {shown.slice(0, 4).map((l, idx) => (
            <motion.div key={`${seed}-${idx}`} className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <div className="small" style={{ fontWeight: 750 }}>{l.why}</div>
                <div className="row" style={{ gap: 3 }}>
                  {[...new Set([...l.mine.palette, ...l.theirs.palette])].slice(0, 6).map((c) => (
                    <span key={c} className="wd-dot static" style={{ background: NAMED.find((n) => n.name === c)?.hex }} title={c} />
                  ))}
                </div>
              </div>
              <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                <Column items={l.mine.items} color={meColor} label="Ты" />
                <Column items={l.theirs.items} color={theyColor} label={partner?.name ?? ""} />
              </div>
              <button className="btn soft sm" style={{ width: "100%", marginTop: 12 }} onClick={() => save.mutate(l, { onSuccess: () => { haptic.success(); store.toast("Лук сохранён 👗"); } })}>
                <Bookmark size={16} /> Сохранить лук
              </button>
            </motion.div>
          ))}
          <div className="grid-2" style={{ marginTop: 10 }}>
            <button className="btn soft" onClick={() => { haptic.light(); setSeed((s) => s + 4); }}><RefreshCw size={17} /> Другие варианты</button>
            <button className="btn soft" disabled={!locked.length} onClick={() => setLocked([])}>Снять закрепы</button>
          </div>
        </>
      )}

      {!!saved?.looks.length && (
        <>
          <Section title="Сохранённые луки" />
          <div className="stack">
            {saved.looks.map((lk) => (
              <div key={lk.id} className="card" style={{ padding: 12 }}>
                <div className="row between">
                  <div>
                    <div style={{ fontWeight: 750 }}>{lk.title}</div>
                    {lk.date && <div className="small muted">{dayLabel(lk.date)}</div>}
                  </div>
                  <button className="icon-btn ghost" onClick={async () => (await confirm("Удалить лук?")) && delLook.mutate(lk.id)} aria-label="Удалить"><Trash2 size={16} className="faint" /></button>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 10, overflowX: "auto" }}>
                  {Object.entries(lk.items).flatMap(([uid, ids], k) => [
                    ...(k ? [<div key={`sep${uid}`} style={{ width: 2, alignSelf: "stretch", background: "var(--line)", margin: "0 4px" }} />] : []),
                    ...ids.map((id) => byId(id)).filter(Boolean).map((i) => <img key={`${uid}-${i!.id}`} src={i!.url} alt="" style={{ width: 52, height: 64, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />),
                  ])}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="small faint center" style={{ marginTop: 16 }}>
        <Check size={12} style={{ verticalAlign: -1 }} /> Подбор учитывает повод, прогноз для Москвы и сочетание цветов у вас обоих
      </p>
    </>
  );
}
