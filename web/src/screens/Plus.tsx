import { Check, ChevronLeft, CreditCard, Globe, Heart, Lock, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, queryClient, track, useApi, type PlusFrom } from "../api.ts";
import { useMe } from "../data.ts";
import { accusative, dayMonth, genitive, plural } from "../fmt.ts";
import { haptic, openInvoice, openLink, openTelegramLink } from "../tg.ts";
import { nav, store } from "../store.ts";
import { Sheet, Spinner } from "../ui/kit.tsx";
import { offerEnds, offerLive, perEach } from "./Paywall.tsx";
import "./plus.css";

interface PlusState {
  active: boolean;
  until: string | null;
  forever: boolean;
  card: boolean;
  stars: boolean;
  receiptEmail: boolean;
  support: string | null;
  plans: { key: string; rub: number; stars: number; days: number; title: string }[];
  offer: { key: string; until: string; rub: number; stars: number; oldRub: number; oldStars: number } | null;
  free: { films: number; capsules: number; goals: number; wardrobe: number };
  freeTests: string[];
  tests: number;
  testList: { id: string; title: string; emoji: string; blurb: string; free: boolean }[];
  /** Что ещё в новых тестах: раунды и «Шпаргалка» */
  extras?: { id: string; emoji: string; title: string; blurb: string }[];
}

const EMAIL_KEY = "vdvoyom:receipt-email";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const readEmail = () => {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * «Вдвоём+» по образцу «Между строк» (@TheCuteBot): обложка из карточек в одном
 * тоне, тарифы, кнопка с ценой. Основной путь — ЮKassa: кнопка сразу ведёт в
 * «Куда прислать чек?» (чек по закону уходит на почту), оттуда на страницу
 * оплаты. Картой иностранного банка — звёзды телеграма, ссылкой под кнопкой в
 * той же шторке: их покупают любой картой, Apple Pay или Google Pay.
 * После ЮKassa человек возвращается ссылкой t.me/…?startapp=plus, и экран
 * перепроверяет оплату, не дожидаясь уведомления.
 */
/**
 * via — откуда открыли, для аналитики (track "plus_view"): lock — шторка замка, home — главная
 * (баннер, искорка, шторка подарка), promo — сам при входе, link — ссылка go=plus/startapp=plus.
 * Без via: с вкладки «Ещё» — menu, иначе other. from — какой замок (feature).
 */
export function PlusScreen({ promo = false, via }: { promo?: boolean; from?: string; via?: PlusFrom }) {
  useEffect(() => {
    track("plus_view", { from: via ?? (store.get().tab === "more" ? "menu" : "other") });
  }, []);
  const { partner, data: meData, beta } = useMe();
  const { data, refetch } = useApi<PlusState>(["plus"], "/plus");
  const [plan, setPlan] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [step, setStep] = useState<null | "method" | "email">(null);
  const [email, setEmail] = useState(readEmail);
  const [busy, setBusy] = useState(false);
  // Шторка «Проверяем оплату» после перехода к оплате (образец — «Между строк»):
  // сама перепроверяет платёж, пока открыта. untilBefore — срок до оплаты:
  // изменился — значит, оплата прошла (так видно и продление, и тестовую оплату).
  const [waiting, setWaiting] = useState(false);
  const untilBefore = useRef<string | null>(null);
  const startWaiting = () => {
    untilBefore.current = data?.until ?? null;
    setWaiting(true);
  };

  async function check(quiet = false) {
    try {
      const r = await api<{ paid: boolean; active: boolean; until: string | null }>("/plus/check", { body: {} });
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      const done = r.paid || (waiting && r.active && r.until !== untilBefore.current);
      if (done) {
        haptic.success();
        store.toast("«Вдвоём+» включён 💞");
        setWaiting(false);
      } else if (!quiet) store.toast("Оплата пока не пришла. Если платёж прошёл, подожди минуту");
    } catch {
      /* сеть — проверим в следующий раз */
    }
  }

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => document.visibilityState === "visible" && void check(true), 4000);
    return () => clearInterval(t);
  }, [waiting]);

  // Вернулись со страницы оплаты — сразу перепроверяем, не дожидаясь уведомления ЮKassa
  useEffect(() => {
    void check(true);
    const onShow = () => document.visibilityState === "visible" && void check(true);
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  async function payCard() {
    if (!EMAIL.test(email.trim())) return store.toast("Проверь почту: в ней ошибка");
    setBusy(true);
    try {
      try {
        localStorage.setItem(EMAIL_KEY, email.trim());
      } catch {
        /* приватный режим — спросим в следующий раз */
      }
      const { url } = await api<{ url: string }>("/plus/checkout", { body: { plan: current, method: "card", email: email.trim() } });
      haptic.medium();
      setStep(null);
      startWaiting();
      openLink(url);
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function payStars() {
    setBusy(true);
    try {
      const r = await api<{ invoice?: string; url?: string }>("/plus/checkout", { body: { plan: current, method: "stars" } });
      setStep(null);
      if (r.url) {
        openLink(r.url); // разработка: тестовая оплата
        startWaiting();
        return;
      }
      const status = await openInvoice(r.invoice!);
      if (status === "paid") {
        store.toast("Оплачено, включаю «Вдвоём+»…");
        // Зачёт приходит боту отдельным сообщением — подождём его пару секунд
        for (let i = 0; i < 6; i++) {
          await new Promise((res) => setTimeout(res, 1200));
          const s = await refetch();
          if (s.data?.active) break;
        }
        void queryClient.invalidateQueries({ queryKey: ["me"] });
        haptic.success();
      } else if (status === "failed") store.toast("Оплата не прошла. Попробуй ещё раз или другим способом");
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Spinner />;
  const offer = data.offer && offerLive(data.offer.until) ? data.offer : null;
  const month = data.plans.find((p) => p.key === "month");
  const year = data.plans.find((p) => p.key === "year");
  const forever = data.plans.find((p) => p.key === "forever");
  // Год: по акции, пока она идёт, иначе обычный. Обычного года рядом с акцией нет — он стоит зачёркнутым
  const yearPlan = offer ? { key: offer.key, rub: offer.rub, stars: offer.stars, days: 365, title: "Год по акции" } : year;
  const all = [...(yearPlan ? [yearPlan] : []), ...data.plans];
  const current = plan ?? yearPlan?.key ?? "month";
  const chosen = all.find((p) => p.key === current) ?? data.plans[0];
  const f = data.free;
  const anyReady = data.card || data.stars;
  const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
  // «Платишь ты, откроется и у Алины» — одна оплата на двоих делит цену пополам, это главный довод
  const real = partner && !partner.ghost ? partner : null;
  const other = real ? genitive(real.name) : null;
  const buy = () => { haptic.medium(); setStep(data.card ? "email" : "method"); };
  const pick = (key: string) => { haptic.select(); setPlan(key); };
  const mark = data.active ? <Check size={18} color="var(--accent, var(--me))" style={{ flexShrink: 0 }} /> : <Lock size={17} color="var(--accent, var(--me))" style={{ flexShrink: 0 }} aria-label="во «Вдвоём+»" />;
  const planCard = (key: string, title: string, price: number, note: string, opts: { old?: number; chip?: string } = {}) => (
    <button
      key={key}
      className={`card tap row between plus-plan${current === key ? " on" : ""}`}
      onClick={() => pick(key)}
      aria-pressed={current === key}
    >
      <div>
        <div style={{ fontWeight: 800 }}>
          {title}
          {opts.chip && <span className="plus-chip">{opts.chip}</span>}
        </div>
        <div className="small muted">{note}</div>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <span className="title-lg" style={{ fontSize: 22 }}>{rub(price)}</span>
        {opts.old ? <div className="small muted"><s>{rub(opts.old)}</s></div> : null}
      </div>
    </button>
  );

  // Четыре причины, как в макете; подробный список — раскрытием
  type Reason = { e: string; t: string; d: string };
  const pays: Reason = { e: "💞", t: "Один платит, открыто обоим", d: other ? `Откроется и у ${other}` : "Одна оплата на двоих" };
  const unlimited: Reason = { e: "♾️", t: "Без лимитов", d: "Фильмы, капсулы, цели, гардероб" };
  const reasons: Reason[] = beta
    ? [
        { e: "🧩", t: `Все ${data.tests} ${plural(data.tests, "тест", "теста", "тестов")} и новые раунды`, d: "Свежие вопросы без конца" },
        { e: "📝", t: real ? `Шпаргалка про ${accusative(real.name)}` : "Шпаргалка про партнёра", d: "Целиком, а не первые строки" },
        unlimited,
        pays,
      ]
    : [
        { e: "🧩", t: `Все ${data.tests} ${plural(data.tests, "тест", "теста", "тестов")}`, d: "Деньги, быт, будущее и отдых" },
        unlimited,
        pays,
      ];
  const ugaday = data.testList.find((t) => t.id === "ugaday");

  return (
    <div>
      {/* Верх: «Назад» или, если экран открылся сам при входе, крестик */}
      {promo ? (
        <button className="icon-btn" aria-label="Закрыть" onClick={nav.back} style={{ position: "absolute", top: "calc(var(--safe-top) + 10px)", right: 16, zIndex: 3 }}>
          <X size={20} />
        </button>
      ) : (
        <button className="row muted" style={{ gap: 2, marginLeft: -4, minHeight: 44 }} onClick={nav.back}>
          <ChevronLeft size={20} /> Назад
        </button>
      )}

      <>
          {/* Обложка: веер карточек. В бете — то, что паре интересно сейчас: «Угадай меня», тесты, шпаргалка */}
          {beta ? (
            <div className="plus-fan" aria-hidden>
              <div className="plus-card c1"><span className="tag">Раунды</span><span className="big">{ugaday?.emoji ?? "🙈"}</span><span className="cap">Угадай меня</span></div>
              <div className="plus-card c2"><span className="tag">Вдвоём+</span><span className="big">🧩</span><span className="cap">Все тесты</span></div>
              <div className="plus-card c3"><span className="tag">Шпаргалка</span><span className="big">📝</span><span className="cap">Шпаргалка</span></div>
            </div>
          ) : (
            <div className="plus-fan" aria-hidden>
              <div className="plus-card c1"><span className="tag">Будущее</span><span className="big">🔮</span><span className="cap">Будущее</span></div>
              <div className="plus-card c2"><span className="tag">Вдвоём+</span><span className="big">💸</span><span className="cap">Деньги без ссор</span></div>
              <div className="plus-card c3"><span className="tag">Быт</span><span className="big">🏠</span><span className="cap">Быт</span></div>
            </div>
          )}
          {!data.active && (
            <h1 className="plus-h1">
              {beta ? <>Узнайте друг о&nbsp;друге то, о&nbsp;чём не&nbsp;спрашивали</> : <>Узнайте, где вы смотрите в&nbsp;разные стороны</>}
            </h1>
          )}
      </>

      {data.active && data.until && (
        <div className="card grad row" style={{ marginBottom: 10 }}>
          <Heart size={22} fill="currentColor" />
          <div className="grow">
            <div className="title-md">{data.forever ? "Включён навсегда" : `Включён до ${dayMonth(data.until)}`}</div>
            <div className="small" style={{ opacity: 0.88 }}>{other ? `У тебя и у ${other}. ` : ""}Спасибо, что поддерживаешь «Вдвоём».</div>
          </div>
        </div>
      )}

      {/* Четыре причины */}
      <div className="card plus-reasons">
        {reasons.map((r) => (
          <div key={r.t} className="row plus-test">
            <span className="emoji" style={{ fontSize: 24, width: 32, textAlign: "center" }}>{r.e}</span>
            <div className="grow">
              <div style={{ fontWeight: 750 }}>{r.t}</div>
              <div className="small muted">{r.d}</div>
            </div>
            {r !== pays && mark}
          </div>
        ))}
        <button className="link small plus-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? "Свернуть" : "Что входит подробнее"}
        </button>
      </div>

      {more && (
        <div className="card" style={{ padding: "6px 14px" }}>
          {data.testList.map((t) => (
            <div key={t.id} className="row plus-test">
              <span className="emoji" style={{ fontSize: 24, width: 32, textAlign: "center" }}>{t.emoji}</span>
              <div className="grow">
                <div style={{ fontWeight: 700 }}>{t.title}</div>
                <div className="small muted">{t.blurb}</div>
              </div>
              {t.free && !data.active ? <span className="small muted" style={{ whiteSpace: "nowrap" }}>уже есть</span> : mark}
            </div>
          ))}
          {data.extras?.map((x) => (
            <div key={x.id} className="row plus-test">
              <span className="emoji" style={{ fontSize: 24, width: 32, textAlign: "center" }}>{x.emoji}</span>
              <div className="grow">
                <div style={{ fontWeight: 700 }}>{x.title}</div>
                <div className="small muted">{x.blurb}</div>
              </div>
              {mark}
            </div>
          ))}
          <div className="row plus-test">
            <span className="emoji" style={{ fontSize: 24, width: 32, textAlign: "center" }}>♾️</span>
            <div className="grow">
              <div style={{ fontWeight: 700 }}>Без лимитов</div>
              <div className="small muted">свои фильмы, капсулы, цели и гардероб; бесплатно — {f.films} фильмов, 1 капсула, {f.goals} цели, {f.wardrobe} вещей</div>
            </div>
            {mark}
          </div>
        </div>
      )}

      {!data.forever && (<>
      {/* Тарифы как в макете: год выделен, месяц сразу виден — «попробовать», навсегда третьим.
          Одна цена на карточку, звёзды — только на шаге оплаты */}
      <div className="section"><div className="caps">Тариф</div></div>
      {offer && <p className="small muted" style={{ margin: "-4px 4px 10px" }}>🔥 Цена года для новых пар {offerEnds(offer.until)}</p>}
      <div className="stack" style={{ gap: 10 }}>
        {yearPlan && planCard(yearPlan.key, "Год", yearPlan.rub, `по ${perEach(yearPlan.rub)} ₽ в месяц с каждого`, { old: offer ? offer.oldRub : undefined, chip: "выгоднее" })}
        {month && planCard(month.key, "Месяц", month.rub, "попробовать: 30 дней")}
        {forever && planCard(forever.key, "Навсегда", forever.rub, "одна оплата, без продлений")}
      </div>
      <p className="small muted" style={{ margin: "10px 4px 0" }}>Не зайдёт — напиши нам, вернём деньги за оставшиеся дни.</p>
      </>)}

      {/* Возражения до того, как их зададут */}
      <div className="section"><div className="caps">Вопросы</div></div>
      <div className="card plus-faq">
        {[
          ["Это подписка?", "Нет. Платишь один раз за выбранный срок. Сама не продлевается и повторно ничего не списывает."],
          ["Платить нужно обоим?", other ? `Нет. Платит один, «Вдвоём+» включается и у ${other}.` : "Нет. Платит один, «Вдвоём+» включается у вас обоих."],
          ["А если не понравится?", "Напиши в поддержку, и мы вернём деньги за оставшиеся дни."],
          ["Что останется бесплатным?", "Всё, ради чего «Вдвоём»: когда вы оба свободны, свайпы и мэтчи, календарь, хотелки и дела. Навсегда."],
          ["Как платить?", "Картой российского банка, через СБП или SberPay на странице ЮKassa. Картой иностранного банка — звёздами Телеграма."],
        ].map(([q, a]) => (
          <div key={q}>
            <div style={{ fontWeight: 750 }}>{q}</div>
            <div className="small muted" style={{ lineHeight: 1.45 }}>{a}</div>
          </div>
        ))}
      </div>

      <p className="small muted center" style={{ marginTop: 12, lineHeight: 1.5 }}>
        {data.support ? <>Поддержка: {data.support}. </> : null}
        <button className="link small" onClick={() => openLink(`${location.origin}/plus-terms`)}>Условия и возврат</button>
      </p>

      {/* Единственное залитое пятно на экране — кнопка: «Открыть всё вдвоём» и цена выбранного тарифа */}
      {!data.forever && (
        <div className="plus-sticky">
          <button className="btn" disabled={!anyReady || busy} onClick={buy}>
            {!anyReady ? "Оплата скоро" : data.active && current !== "forever" ? `Продлить за ${rub(chosen.rub)}` : `Открыть всё вдвоём · ${rub(chosen.rub)}`}
          </button>
          <div className="small muted center" style={{ marginTop: 6 }}>{other ? `Платишь ты, откроется и у ${other}` : "Одна оплата на двоих"} · без автосписаний</div>
          {promo && (
            <button className="small muted plus-later" onClick={nav.back}>Может позже</button>
          )}
        </div>
      )}

      <Sheet open={step === "method"} onClose={() => setStep(null)} title="Способ оплаты">
        <div className="stack">
          <button className="card tap row pay-way" disabled={!data.card || busy} onClick={() => setStep("email")}>
            <CreditCard size={22} />
            <div className="grow">
              <div style={{ fontWeight: 750 }}>Картой российского банка</div>
              <div className="small muted">{data.card ? `${rub(chosen.rub)} · СБП, SberPay, МИР, ЮMoney` : "скоро: магазин подключается"}</div>
            </div>
          </button>
          <button className="card tap row pay-way" disabled={!data.stars || busy} onClick={payStars}>
            <Globe size={22} />
            <div className="grow">
              <div style={{ fontWeight: 750 }}>Картой иностранного банка</div>
              <div className="small muted">{chosen.stars.toLocaleString("ru-RU")} ⭐ звёздами Телеграма · Apple Pay, Google Pay</div>
            </div>
          </button>
        </div>
        <p className="small muted center" style={{ margin: "14px 0 0" }}>Если платёж не проходит, отключи VPN на время оплаты.</p>
      </Sheet>

      <Sheet open={waiting} onClose={() => setWaiting(false)}>
        <div className="center" style={{ padding: "4px 0 2px" }}>
          <div className="emoji" style={{ fontSize: 64, lineHeight: 1 }}>💞</div>
          <h3 className="title-lg" style={{ margin: "12px 0 4px" }}>Ещё минутку… Проверяем оплату</h3>
          <p className="small muted" style={{ margin: 0 }}>Как только платёж пройдёт, «Вдвоём+» включится сам — у вас обоих.</p>
        </div>
        <div className="card flat" style={{ margin: "14px 0 0", padding: 12 }}>
          <div className="small" style={{ fontWeight: 750 }}>Совет</div>
          <div className="small muted">Если платёж не проходит, отключи VPN на время оплаты: так всё пройдёт без лишних сложностей.</div>
        </div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => check()}>
          <RefreshCw size={17} /> Проверить ещё раз
        </button>
        <button
          className="link small"
          style={{ display: "block", margin: "12px auto 0" }}
          onClick={() => openTelegramLink(`https://t.me/${meData?.bot ?? "vdvoyom_app_bot"}?start=paysupport`)}
        >
          Написать в поддержку
        </button>
      </Sheet>

      <Sheet open={step === "email"} onClose={() => setStep(null)} title="Куда прислать чек?">
        <p className="small muted" style={{ marginTop: -8 }}>Чек об оплате по закону отправляется на электронную почту.</p>
        <input
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Электронная почта"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void payCard()}
        />
        <button className="btn" style={{ marginTop: 12 }} disabled={busy || !email.trim()} onClick={payCard}>
          {busy ? "Открываю оплату…" : `Перейти к оплате ${rub(chosen.rub)}`}
        </button>
        {data.stars && (
          <button className="link small" style={{ display: "block", margin: "14px auto 0" }} disabled={busy} onClick={payStars}>
            Картой иностранного банка: {chosen.stars.toLocaleString("ru-RU")} ⭐
          </button>
        )}
        <p className="small muted center" style={{ margin: "12px 0 0" }}>Если платёж не проходит, отключи VPN на время оплаты.</p>
      </Sheet>
    </div>
  );
}

/**
 * Творительный падеж имени для «у вас с Димой» — частые окончания, как genitive/dative
 * в fmt.ts (fmt.ts принадлежит другому агенту: перенести туда при сведении).
 */
export function instrumental(name: string): string {
  if (name.length > 2 && name.endsWith("ия")) return name.slice(0, -1) + "ей";
  if (name.length > 2 && name.endsWith("я")) return name.slice(0, -1) + "ей";
  if (name.length > 2 && name.endsWith("а")) return name.slice(0, -1) + (/[жшчщц]$/.test(name.slice(0, -1)) ? "ей" : "ой");
  if (name.endsWith("й") || name.endsWith("ь")) return name.slice(0, -1) + "ем";
  if (/[жшчщц]$/i.test(name)) return name + "ем";
  if (/[бвгдзклмнпрстфх]$/i.test(name)) return name + "ом";
  return name;
}
