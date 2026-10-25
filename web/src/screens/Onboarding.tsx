import { AnimatePresence, motion } from "motion/react";
import { CalendarHeart, Check, Clapperboard, Gift } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, queryClient } from "../api.ts";
import { useMe } from "../data.ts";
import { genitive } from "../fmt.ts";
import { haptic, openLink, requestWriteAccess } from "../tg.ts";
import { store } from "../store.ts";
import { COLOR_HEX, Duo, Field, Logo, PICKABLE, Toast } from "../ui/kit.tsx";
import { DataSheet, InvitePanel } from "./Invite.tsx";

const COLOR_NAME: Record<string, string> = { violet: "фиолетовый", rose: "розовый", sky: "голубой", mint: "мятный", sun: "жёлтый", coral: "коралловый" };

/** Стартовый цвет: свой, если он уже выбран и не совпадает с цветом половинки; второму в паре — розовый. */
export function startColor(mine: string | null | undefined, taken: string | null | undefined, invited: boolean): string {
  if (mine && PICKABLE.includes(mine) && mine !== taken) return mine;
  const want = invited ? "rose" : "violet";
  return want !== taken ? want : (PICKABLE.find((c) => c !== taken) ?? want);
}

/**
 * Знакомство для любого человека: сам запускает мини-приложение, заполняет
 * профиль, отдельной галочкой даёт согласие на обработку персональных данных
 * и зовёт половинку. Пришедший по приглашению уже в паре: видит, кто его позвал,
 * и вместо приглашения — «Вы вдвоём».
 * 11.10.2026: шаг «Что вам нужно» (10 переключателей) убран из обязательного пути —
 * все разделы включены, выключить их можно в «Ещё» → «Настроить разделы».
 */
export function Onboarding() {
  const { me, partner } = useMe();
  const invited = !!partner && !partner.ghost;
  // Цвет половинки (и заготовки тоже) занят: иначе в календаре не понять, где чьё
  const taken = partner?.color ?? null;
  const [step, setStep] = useState<"hello" | "profile" | "pair">("hello");
  const [name, setName] = useState(me?.name ?? "");
  const [color, setColor] = useState(() => startColor(me?.color, taken, invited));
  const [birthday, setBirthday] = useState(me?.birthday ?? "");
  // Согласие на обработку персональных данных — отдельной галочкой, без неё «Дальше» неактивна
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const screen = useRef<HTMLDivElement>(null);

  // Новый шаг — с самого верха: экран — общий прокручиваемый контейнер, и шаг 3
  // открывался с прокруткой шага 2, заголовок был срезан (тест 11.10.2026)
  const toTop = () => {
    screen.current?.scrollTo(0, 0);
  };
  useEffect(() => {
    toTop();
  }, [step]);

  async function saveProfile() {
    setBusy(true);
    try {
      await api("/me", { body: { name, color, birthday: birthday || null, consent: true } });
      // Разрешение боту писать первым: без него не придут напоминания и приглашения
      const ok = await requestWriteAccess();
      if (ok) await api("/me", { body: { writeAccess: true } });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      setStep("pair");
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await api("/me", { body: { onboarded: true } });
    haptic.success();
    await queryClient.invalidateQueries();
  }

  const slide = {
    initial: { opacity: 0, x: 40 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -40 },
    transition: { type: "spring" as const, stiffness: 300, damping: 32 },
  };

  return (
    <div ref={screen} className="screen" style={{ paddingBottom: 40, display: "flex", flexDirection: "column" }}>
      <AnimatePresence mode="wait" onExitComplete={toTop}>
        {step === "hello" && (
          <motion.div key="hello" {...slide} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
            <motion.div initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 180, damping: 12 }}>
              {invited ? <Duo a={partner} b={null} size={72} /> : <Logo size={84} />}
            </motion.div>
            {invited ? (
              <>
                <h1 className="title-xl" style={{ fontSize: 34 }}>
                  {partner!.name} зовёт тебя во «Вдвоём»
                </h1>
                <p className="muted" style={{ fontSize: 17, margin: 0 }}>
                  Тут видно, когда вы оба свободны, лежат общие хотелки, а фильм на вечер выбирается свайпами. Твоё личное видишь только ты.
                </p>
                <p style={{ margin: 0, fontWeight: 650 }}>Вы уже в паре — осталось рассказать о себе.</p>
              </>
            ) : (
              <>
                <h1 className="title-xl" style={{ fontSize: 38 }}>
                  Вы двое —<br />
                  <span className="grad-text">в одном месте</span>
                </h1>
                <div className="stack">
                  {[
                    [CalendarHeart, "Когда вы оба свободны — по расписанию обоих"],
                    [Clapperboard, "Фильм на вечер свайпами: совпали — выбрано"],
                    [Gift, "Хотелки, копилки, цели и письма в будущее"],
                  ].map(([Icon, text], i) => {
                    const I = Icon as typeof Gift;
                    return (
                      <div key={i} className="row" style={{ gap: 12 }}>
                        <div className="icon-btn" style={{ background: "var(--card-2)", flexShrink: 0 }}><I size={19} /></div>
                        <div style={{ fontWeight: 650 }}>{text as string}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ marginTop: 20 }}>
              <button className="btn" onClick={() => setStep("profile")}>
                {invited ? "Поехали" : "Начать"}
              </button>
              <p className="small faint center" style={{ marginBottom: 0 }}>Бесплатно · без рекламы · данные хранятся в России</p>
            </div>
          </motion.div>
        )}

        {step === "profile" && (
          <motion.div key="profile" {...slide} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, paddingTop: 20 }}>
            <div className="caps">Шаг 1 из 2</div>
            <h1 className="title-xl" style={{ marginBottom: 22 }}>Про тебя</h1>
            <Field label="Как тебя подписывать">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Имя" />
            </Field>
            <Field label="Твой цвет">
              <div className="row" style={{ gap: 10, padding: "4px 2px", flexWrap: "wrap" }}>
                {PICKABLE.map((c) => {
                  const theirs = c === taken;
                  return (
                    <button
                      key={c}
                      onClick={() => { setColor(c); haptic.select(); }}
                      disabled={theirs}
                      aria-pressed={color === c}
                      aria-label={theirs ? `${COLOR_NAME[c]}, цвет ${genitive(partner!.name)}` : COLOR_NAME[c]}
                      className="color-dot"
                      style={{ background: COLOR_HEX[c], boxShadow: color === c ? `0 0 0 3px var(--bg), 0 0 0 5px ${COLOR_HEX[c]}` : "none", opacity: theirs ? 0.45 : 1 }}
                    >
                      {color === c ? <Check size={20} strokeWidth={3} /> : theirs ? partner!.name.slice(0, 1).toUpperCase() : null}
                    </button>
                  );
                })}
              </div>
              {taken && PICKABLE.includes(taken) && (
                <div className="small muted" style={{ marginTop: 2 }}>
                  {COLOR_NAME[taken][0].toUpperCase() + COLOR_NAME[taken].slice(1)} уже у {genitive(partner!.name)}: так в календаре видно, где чьё
                </div>
              )}
            </Field>
            <Field label="День рождения — не обязательно, чтобы о нём не забыли">
              <input className="input" type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            </Field>
            <div className="consent">
              <button type="button" role="checkbox" aria-checked={consent} className="consent-row" onClick={() => { setConsent(!consent); haptic.select(); }}>
                <span className={`check${consent ? " on" : ""}`} style={{ ["--c" as string]: "var(--accent, var(--violet))" }} aria-hidden>
                  {consent && <Check size={15} strokeWidth={3} />}
                </span>
                <span>Даю согласие на обработку моих персональных данных</span>
              </button>
              <div className="consent-links small">
                <button className="link small" onClick={() => openLink(`${location.origin}/consent`)}>Согласие на обработку данных</button>
                <button className="link small" onClick={() => openLink(`${location.origin}/privacy`)}>Политика конфиденциальности</button>
                <button className="link small" onClick={() => setDataOpen(true)}>Коротко: что храним</button>
              </div>
            </div>
            <div style={{ marginTop: "auto", paddingTop: 20 }}>
              <button className="btn" disabled={!name.trim() || !consent || busy} onClick={saveProfile}>
                Дальше
              </button>
              {!consent && name.trim() && <p className="small muted center" style={{ margin: "8px 0 0" }}>Отметь согласие — без него приложение не может хранить твои данные</p>}
            </div>
          </motion.div>
        )}

        {step === "pair" && (
          <motion.div key="pair" {...slide} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, paddingTop: 20 }}>
            <div className="caps">Шаг 2 из 2</div>
            {invited ? (
              <>
                <h1 className="title-xl">Вы вдвоём 💞</h1>
                <div className="card row">
                  <Duo a={{ ...me!, name, color }} b={partner} />
                  <div>
                    <div className="title-md">{name || me?.name} и {partner!.name}</div>
                    <div className="small muted">общее пространство готово</div>
                  </div>
                </div>
                <p className="muted" style={{ margin: "4px 0 0", lineHeight: 1.45 }}>
                  Личное видишь только ты. Ответы в тестах откроются, когда ответите оба.
                </p>
              </>
            ) : (
              <>
                <h1 className="title-xl">Позови половинку</h1>
                <p className="muted" style={{ margin: "0 0 4px" }}>
                  Приложение работает и для одного. Когда половинка откроет ссылку, ваши пространства соединятся, и всё, что ты успеешь добавить, останется.
                </p>
                {/* После отправки ссылки следующий шаг — сразу здесь, а не «Позову позже» под прокруткой */}
                {shared && (
                  <div className="card" role="status">
                    <div className="row" style={{ gap: 12 }}>
                      <span className="check on" style={{ ["--c" as string]: "var(--mint)" }} aria-hidden><Check size={15} strokeWidth={3} /></span>
                      <div className="small" style={{ lineHeight: 1.45 }}>
                        <b>Ссылка у половинки.</b> Как только её откроют, вы окажетесь вдвоём. А пока можно осмотреться и добавить своё.
                      </div>
                    </div>
                    <button className="btn" style={{ marginTop: 12 }} onClick={finish}>Готово, в приложение</button>
                  </div>
                )}
                <InvitePanel onShared={() => setShared(true)} />
              </>
            )}
            <p className="small muted center" style={{ margin: "6px 0 0" }}>
              Лишние разделы можно убрать потом: «Ещё» → «Настроить разделы».
            </p>
            {(invited || !shared) && (
              <div style={{ marginTop: "auto", paddingTop: 16 }}>
                <button className={`btn${invited ? "" : " soft"}`} onClick={finish}>
                  {invited ? "В приложение" : "Позову позже"}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <DataSheet open={dataOpen} onClose={() => setDataOpen(false)} />
      <Toast />
    </div>
  );
}
