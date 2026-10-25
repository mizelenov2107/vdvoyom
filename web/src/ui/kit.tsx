import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ChevronLeft } from "lucide-react";
import { isValidElement, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { nav, useStore } from "../store.ts";
import type { Person } from "../types.ts";
import { Art, type ArtName } from "./Art.tsx";

/** Цвета, из которых каждый выбирает свой. Старые ключи оставлены для тех, кто уже выбрал. */
export const COLOR_HEX: Record<string, string> = {
  violet: "#7b61ff",
  rose: "#ff4f8b",
  sky: "#3fa7ff",
  mint: "#22c3a6",
  sun: "#ffb020",
  coral: "#ff6b4a",
  blue: "#3fa7ff",
  green: "#22c3a6",
  amber: "#ffb020",
  pink: "#ff4f8b",
};

/** Палитра для выбора — без дублей старых ключей. */
export const PICKABLE = ["violet", "rose", "sky", "mint", "sun", "coral"];

export function colorOf(p?: Pick<Person, "color"> | null): string {
  return COLOR_HEX[p?.color ?? "violet"] ?? COLOR_HEX.violet;
}

export function Avatar({ p, size = 40 }: { p?: Person | null; size?: number }) {
  const initial = (p?.name ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.42, ["--c" as string]: p ? colorOf(p) : "var(--card-3)" }}>
      {p?.photo ? <img src={p.photo} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} /> : initial}
    </div>
  );
}

export function Duo({ a, b, size = 44 }: { a?: Person | null; b?: Person | null; size?: number }) {
  return (
    <div className="duo">
      <Avatar p={a} size={size} />
      <Avatar p={b} size={size} />
    </div>
  );
}

const HEART = "M50 90C22 70 4 53 4 33 4 18 15 7 29 7c9 0 17 5 21 13 4-8 12-13 21-13 14 0 25 11 25 26 0 20-18 37-46 57z";

/** Логотип: целое сердце из двух половинок разного цвета — две половинки, которые сошлись. */
export function Logo({ size = 44, a = "var(--logo-a, #7b61ff)", b = "var(--logo-b, #ff4f8b)" }: { size?: number; a?: string; b?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <clipPath id={`l${id}`}><rect x="0" y="0" width="49.2" height="100" /></clipPath>
        <clipPath id={`r${id}`}><rect x="50.8" y="0" width="49.2" height="100" /></clipPath>
      </defs>
      <path d={HEART} fill={a} clipPath={`url(#l${id})`} />
      <path d={HEART} fill={b} clipPath={`url(#r${id})`} />
    </svg>
  );
}

export function Head({ caption, title, actions, back }: { caption?: ReactNode; title: ReactNode; actions?: ReactNode; back?: boolean }) {
  return (
    <div className="head">
      <div className="grow">
        {back && (
          <button className="row muted" style={{ gap: 2, marginLeft: -4, minHeight: 44 }} onClick={nav.back}>
            <ChevronLeft size={20} /> Назад
          </button>
        )}
        {caption && <div className="caps">{caption}</div>}
        <h1 className="title-xl">{title}</h1>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Section({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="section">
      <div className="caps">{title}</div>
      {action}
    </div>
  );
}

export function Empty({ emoji, art, title, text, children }: { emoji?: string; art?: ArtName; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {art ? <div style={{ marginBottom: 10 }}><Art name={art} /></div> : <div className="emoji">{emoji}</div>}
      <div className="title-md" style={{ color: "var(--text)" }}>{title}</div>
      {text && <p className="small" style={{ margin: "6px auto 16px", maxWidth: 280 }}>{text}</p>}
      {children}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  const id = useId();
  return (
    <div className="segmented">
      {items.map(([k, label]) => (
        <button key={k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          {value === k && <motion.div layoutId={id} className="thumb" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <span style={{ position: "relative" }}>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Pills<T extends string>({ value, onChange, items, scroll }: { value: T; onChange: (v: T) => void; items: [T, string, string?][]; scroll?: boolean }) {
  return (
    <div className={`pills${scroll ? " scroll" : ""}`}>
      {items.map(([k, label, color]) => (
        <button
          key={k}
          className={`pill${color ? " tint" : ""}${value === k ? " on" : ""}`}
          style={color ? { ["--c" as string]: color } : undefined}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const controls = useDragControls();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // Клавиатура телефона. В Telegram на айфоне она ложится поверх страницы, а шторка
  // прибита к низу экрана — поле письма оказывалось под клавиатурой (самая частая
  // жалоба на капсулы You&Me). Видимую высоту даёт visualViewport: шторка поднимается
  // над клавиатурой, а поле, где стоит курсор, докручивается в видимую часть.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const root = document.documentElement;
    const fit = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty("--kb", `${kb}px`);
      const el = document.activeElement as HTMLElement | null;
      if (kb > 0 && el && box.current?.contains(el) && el.matches("input, textarea, select")) {
        requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }));
      }
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      root.style.setProperty("--kb", "0px");
    };
  }, [open]);
  // Шторка выводится в корень страницы, а не внутрь экрана: экран — прокручиваемый
  // контейнер, и в WebKit на айфоне position: fixed внутри него привязывается к
  // прокрутке. На прокрученной главной «Моё настроение» открывалось наполовину,
  // а «С какого дня вы вместе» уезжало за край (жалоба 26.09.2026).
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={box}
            className="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => (i.offset.y > 110 || i.velocity.y > 600) && onClose()}
          >
            <div onPointerDown={(e) => controls.start(e)} style={{ touchAction: "none", padding: "4px 0 2px" }}>
              <div className="grip" />
            </div>
            {title && <h3 className="title-lg">{title}</h3>}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Переключатель «вкл/выкл» для настроек. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/**
 * Подпись над полем. <label> — только вокруг одного поля ввода: вокруг ряда кнопок
 * он «подписывает» первую из них, и её имя для VoiceOver становится всей подписью
 * с соседями («Что это Низ Платье …»), а касание подписи или зазора между пилюлями
 * нажимает её (найдено 07.10.2026 при сверке с жалобами на чужие приложения).
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const single = isValidElement(children) && typeof children.type === "string" && ["input", "textarea", "select"].includes(children.type);
  if (single) {
    return (
      <label className="field">
        <span className="caps">{label}</span>
        {children}
      </label>
    );
  }
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="caps">{label}</span>
      {children}
    </div>
  );
}

export function Progress({ parts }: { parts: { value: number; color: string }[] }) {
  return (
    <div className="progress">
      {parts.map((p, i) => (
        <div key={i} style={{ width: `${Math.max(0, Math.min(100, p.value))}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Toast() {
  const t = useStore((s) => s.toast);
  return (
    <AnimatePresence>
      {t && (
        <motion.div key={t.id} className="toast" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}>
          {t.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
