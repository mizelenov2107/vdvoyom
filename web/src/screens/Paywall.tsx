// «Вдвоём+» на главной и в месте, где упёрлись в бесплатный лимит.
// Акция — год по цене восьми месяцев, 72 часа; конец хранит сервер, он же не
// примет акционную цену после него. С 11.10.2026 акция заводится только после
// первой общей пользы пары (server/src/plus.ts → offerOf), а время пишется датой:
// «до вечера пятницы, 14 октября». Бегущие секунды выглядели как давление.
import { Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { track, type LockFeature } from "../api.ts";
import { useMe } from "../data.ts";
import { MONTHS_GEN } from "../fmt.ts";
import { haptic } from "../tg.ts";
import { nav, store, useStore } from "../store.ts";
import { Sheet } from "../ui/kit.tsx";

const WD_GEN = ["воскресенья", "понедельника", "вторника", "среды", "четверга", "пятницы", "субботы"];

/**
 * Когда кончается акция — словами и по Москве, без секунд: «сегодня до 17:01»,
 * «до завтра, 17:01», «до вечера пятницы, 14 октября». Конец глубокой ночью
 * пишем как «до конца пятницы»: обещаем чуть меньше, чем есть, а не больше.
 */
export function offerEnds(until: string, now = Date.now()): string {
  const msk = (t: number) => new Date(t + 180 * 60_000); // поля UTC = московское время
  let e = msk(Date.parse(until));
  const n = msk(now);
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const hm = `${String(e.getUTCHours()).padStart(2, "0")}:${String(e.getUTCMinutes()).padStart(2, "0")}`;
  const diff = Math.round((day(e) - day(n)) / 86_400_000);
  if (diff <= 0) return `сегодня до ${hm}`;
  if (diff === 1 && e.getUTCHours() >= 5) return `до завтра, ${hm}`;
  const h = e.getUTCHours();
  let part: string;
  if (h < 5) {
    e = new Date(e.getTime() - 86_400_000);
    part = "конца";
  } else part = h < 12 ? "утра" : h < 17 ? "дня" : "вечера";
  return `до ${part} ${WD_GEN[e.getUTCDay()]}, ${e.getUTCDate()}\u00a0${MONTHS_GEN[e.getUTCMonth()]}`;
}

/** Акция ещё идёт. Без таймера: проверяется при отрисовке, дальше разберётся сервер. */
export const offerLive = (until: string | null | undefined): boolean => !!until && Date.parse(until) > Date.now();

/** «по 41 ₽ в месяц с каждого»: одна оплата на двоих делит цену пополам. */
export const perEach = (rubYear: number) => Math.round(rubYear / 24);

const HIDE_KEY = "vdvoyom:offer-hidden-until";
const hiddenUntil = () => {
  try {
    return Number(localStorage.getItem(HIDE_KEY) ?? 0);
  } catch {
    return 0;
  }
};

/**
 * Акция на главной — спокойной карточкой ниже вопроса дня, не первым блоком
 * (11.10.2026). Появляется, только когда сервер завёл акцию, то есть после
 * первой общей пользы. Крестик прячет на сутки.
 */
export function OfferBanner() {
  const { pair } = useMe();
  const offer = pair?.offer;
  const [hidden, setHidden] = useState(() => hiddenUntil() > Date.now());
  if (!offer || !offerLive(offer.until) || hidden) return null;
  return (
    <div className="card offer plus-offer" style={{ marginTop: 10, position: "relative" }}>
      <button
        aria-label="Скрыть на сутки"
        className="icon-hit"
        onClick={() => {
          try {
            localStorage.setItem(HIDE_KEY, String(Date.now() + 86_400_000));
          } catch {
            /* приватный режим */
          }
          setHidden(true);
        }}
        style={{ position: "absolute", top: 2, right: 2, zIndex: 2, color: "var(--faint)", padding: 12 }}
      >
        <X size={17} />
      </button>
      <div className="small muted" style={{ paddingRight: 30 }}>🔥 Цена для новых пар {offerEnds(offer.until)}</div>
      <div style={{ marginTop: 4, fontWeight: 800, fontSize: 17 }}>
        «Вдвоём+» на год за {`${offer.rub.toLocaleString("ru-RU")}\u00a0₽`}{" "}
        <s className="muted" style={{ fontWeight: 600 }}>{`${offer.oldRub.toLocaleString("ru-RU")}\u00a0₽`}</s>
      </div>
      <div className="row between" style={{ marginTop: 8, gap: 12 }}>
        <div className="small muted">по {perEach(offer.rub)}&nbsp;₽ в месяц с каждого · одна оплата на двоих</div>
        <button className="btn soft sm inline" style={{ minHeight: 44 }} onClick={() => { haptic.medium(); nav.push("plus", { via: "home" }); }}>
          Посмотреть
        </button>
      </div>
    </div>
  );
}

const FEATURES: LockFeature[] = ["films", "capsules", "goals", "wardrobe", "tests", "rounds", "cheat"];
/** feature шторки → одно из допустимых в аналитике (api.ts → LockFeature): неизвестное — к ближайшему по смыслу. */
export function lockFeature(f: string): LockFeature {
  if ((FEATURES as string[]).includes(f)) return f as LockFeature;
  return FEATURES.find((k) => f.includes(k.replace(/s$/, ""))) ?? "tests";
}

/** Шторка «это во «Вдвоём+»»: открывается сама, когда сервер ответил 402, или по замку на экране. */
export function Paywall() {
  const p = useStore((s) => s.paywall);
  const { pair } = useMe();
  const offer = pair?.offer && offerLive(pair.offer.until) ? pair.offer : null;
  const close = () => store.paywall(null);
  // Аналитика: шторку замка увидели (D, 11.10.2026)
  useEffect(() => {
    if (p) track("lock_view", { feature: lockFeature(p.feature) });
  }, [p]);
  const open = () => {
    haptic.medium();
    close();
    nav.push("plus", { via: "lock", ...(p ? { from: p.feature } : {}) });
  };
  return (
    <Sheet open={!!p} onClose={close} title="Это во «Вдвоём+»">
      {p && (
        <>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div className="icon-btn" style={{ background: "var(--accent-soft, var(--card-2))", color: "var(--accent, var(--me))", flexShrink: 0 }}>
              <Lock size={19} />
            </div>
            <p style={{ margin: 0, lineHeight: 1.45 }}>
              {p.text}. Во «Вдвоём+» — без ограничений, сразу для вас обоих. Всё остальное остаётся бесплатным.
            </p>
          </div>
          {offer ? (
            <div className="card flat" style={{ margin: "14px 0 0", padding: 14 }}>
              <div style={{ fontWeight: 800 }}>
                Год за {offer.rub.toLocaleString("ru-RU")} ₽ <s className="muted" style={{ fontWeight: 600 }}>{offer.oldRub.toLocaleString("ru-RU")} ₽</s>
              </div>
              <div className="small muted">цена для новых пар {offerEnds(offer.until)}</div>
            </div>
          ) : (
            <p className="small muted" style={{ margin: "12px 0 0" }}>199 ₽ в месяц, 1 490 ₽ в год или 1 990 ₽ навсегда, на двоих.</p>
          )}
          <button className="btn" style={{ marginTop: 16 }} onClick={open}>
            Посмотреть «Вдвоём+»
          </button>
          <button className="link small" style={{ display: "block", margin: "4px auto 0", minHeight: 44, padding: "0 16px" }} onClick={close}>Не сейчас</button>
        </>
      )}
    </Sheet>
  );
}
