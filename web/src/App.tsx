import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Gift, House, LayoutGrid } from "lucide-react";
import { Logo } from "./ui/kit.tsx";
import { lazy, Suspense, useEffect, useRef, type ComponentType } from "react";
import { api, connectStream, queryClient } from "./api.ts";
import { useMe } from "./data.ts";
import { goParam, haptic, promoParam, setBackButton, startParam } from "./tg.ts";
import { FeedbackSheet } from "./screens/Feedback.tsx";
import { instrumental } from "./fmt.ts";
import { SearchSheet } from "./screens/Search.tsx";
import { nav, store, useStore, type Tab } from "./store.ts";
import { Spinner, Toast } from "./ui/kit.tsx";
import { MatchOverlay } from "./screens/MatchOverlay.tsx";
import { PingBurst } from "./screens/PingBurst.tsx";
import { Paywall } from "./screens/Paywall.tsx";
import { HomeScreen } from "./screens/Home.tsx";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { Art, type ArtName } from "./ui/Art.tsx";
import "./tabbar.css";

// Экраны кроме главной грузятся отдельными кусками: первый экран открывается
// быстрее, а остальное подтягивается в фоне сразу после него.
type Loader = () => Promise<Record<string, unknown>>;
const chunks: Record<string, Loader> = {
  onboarding: () => import("./screens/Onboarding.tsx"),
  calendar: () => import("./screens/Calendar.tsx"),
  swipes: () => import("./screens/Swipes.tsx"),
  tests: () => import("./screens/Tests.tsx"),
  testsV1: () => import("./screens/TestsV1.tsx"),
  wishes: () => import("./screens/Wishes.tsx"),
  more: () => import("./screens/More.tsx"),
  goals: () => import("./screens/Goals.tsx"),
  wardrobe: () => import("./screens/Wardrobe.tsx"),
  plus: () => import("./screens/Plus.tsx"),
  admin: () => import("./screens/Admin.tsx"),
};
function screen(chunk: string, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(() => chunks[chunk]().then((m) => ({ default: m[name] as ComponentType<any> })));
}
const Onboarding = screen("onboarding", "Onboarding");
const CalendarScreen = screen("calendar", "CalendarScreen");
const DayScreen = screen("calendar", "DayScreen");
const WindowsScreen = screen("calendar", "WindowsScreen");
const ScheduleScreen = screen("calendar", "ScheduleScreen");
const SwipesScreen = screen("swipes", "SwipesScreen");
const DeckScreen = screen("swipes", "DeckScreen");
const MatchesScreen = screen("swipes", "MatchesScreen");
const TestsScreenV2 = screen("tests", "TestsScreen");
const TestScreenV2 = screen("tests", "TestScreen");
const CheatSheetScreenV2 = screen("tests", "CheatSheetScreen");
const TestsScreenV1 = screen("testsV1", "TestsScreen");
const TestScreenV1 = screen("testsV1", "TestScreen");

/**
 * Тесты (08.10.2026, этап 4): новые тесты и «Шпаргалка» — только в бете
 * (пара владельца, server/src/beta.ts), у остальных — старые семь тестов, как до 08.10.
 * Пока /me грузится, ничего не рисуем, чтобы не мигнуть чужой версией.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function byBeta(V2: ComponentType<any>, V1: ComponentType<any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function TestsByBeta(props: any) {
    const { data } = useMe();
    if (!data) return <Spinner />;
    const Screen = data.beta ? V2 : V1;
    return <Screen {...props} />;
  };
}
const TestsScreen = byBeta(TestsScreenV2, TestsScreenV1);
const TestScreen = byBeta(TestScreenV2, TestScreenV1);
// Вне беты «Шпаргалки» нет: по старой ссылке — просто список старых тестов
const CheatSheetScreen = byBeta(CheatSheetScreenV2, TestsScreenV1);
const WishesScreen = screen("wishes", "WishesScreen");
const PlanScreen = screen("wishes", "PlanScreen");
const MoreScreen = screen("more", "MoreScreen");
const TasksScreen = screen("more", "TasksScreen");
const VotesScreen = screen("more", "VotesScreen");
const CapsulesScreen = screen("more", "CapsulesScreen");
const CardsScreen = screen("more", "CardsScreen");
const NotesScreen = screen("more", "NotesScreen");
const NoteScreen = screen("more", "NoteScreen");
const DailyScreen = screen("more", "DailyScreen");
const SettingsScreen = screen("more", "SettingsScreen");
const GoalsScreen = screen("goals", "GoalsScreen");
const WardrobeScreen = screen("wardrobe", "WardrobeScreen");
const PlusScreen = screen("plus", "PlusScreen");
const AdminScreen = screen("admin", "AdminScreen");

/** Служебный экран: все рисунки пустых экранов разом (?go=art). */
function ArtGallery() {
  const names: ArtName[] = ["tasks", "gift", "jar", "letter", "vote", "cards", "notes", "photos", "goal", "match", "popcorn", "map", "calendar", "chat", "hourglass", "invite"];
  return (
    <div className="grid-2">
      {names.map((n) => (
        <div key={n} className="card center" style={{ margin: 0, padding: 8 }}>
          <Art name={n} size={150} />
          <div className="small muted">{n}</div>
        </div>
      ))}
    </div>
  );
}

const TABS: { key: Tab; label: string; Icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { key: "home", label: "Главная", Icon: House },
  { key: "calendar", label: "Календарь", Icon: CalendarDays },
  { key: "swipes", label: "Свайпы", Icon: House },
  { key: "wishes", label: "Хотелки", Icon: Gift },
  { key: "more", label: "Ещё", Icon: LayoutGrid },
];

const TAB_SCREENS: Record<Tab, ComponentType> = {
  home: HomeScreen,
  calendar: CalendarScreen,
  swipes: SwipesScreen,
  wishes: WishesScreen,
  more: MoreScreen,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PUSHED: Record<string, ComponentType<any>> = {
  day: DayScreen,
  windows: WindowsScreen,
  schedule: ScheduleScreen,
  deck: DeckScreen,
  matches: MatchesScreen,
  tests: TestsScreen,
  test: TestScreen,
  cheatsheet: CheatSheetScreen,
  plan: PlanScreen,
  tasks: TasksScreen,
  votes: VotesScreen,
  capsules: CapsulesScreen,
  cards: CardsScreen,
  notes: NotesScreen,
  note: NoteScreen,
  daily: DailyScreen,
  settings: SettingsScreen,
  goals: GoalsScreen,
  wardrobe: WardrobeScreen,
  plus: PlusScreen,
  admin: AdminScreen,
  art: ArtGallery,
};

/**
 * «Вдвоём+» во весь экран при входе, как у «Между строк» (27.09.2026). Только
 * когда половинка уже в приложении (рост идёт через приглашение, мешать ему
 * нельзя), «Вдвоём+» ещё нет и с прошлого показа прошли сутки.
 *
 * С 11.10.2026 — только после первой общей пользы пары (раунд теста у обоих,
 * мэтч, вопрос дня у обоих; server/src/plus.ts →
 * benefitAt) и не в тот же заход, когда она случилась: смотрим только первый
 * ответ /home этого захода — польза в нём была до того, как приложение открыли.
 * ?promo=1 показывает экран сразу (показ и снимки), ?promo=0 — никогда.
 */
const PROMO_KEY = "vdvoyom:promo-shown";
function promoDue(data: ReturnType<typeof useMe>["data"], benefit: boolean): boolean {
  const p = promoParam();
  if (p === "0" || !data?.plusOn) return false;
  if (!data?.pair || !data.partner || data.partner.ghost || data.pair.plus?.active) return false;
  if (p === "1") return true;
  if (!benefit) return false;
  try {
    if (Date.now() - Number(localStorage.getItem(PROMO_KEY) ?? 0) < 86_400_000) return false;
    localStorage.setItem(PROMO_KEY, String(Date.now()));
  } catch {
    /* приватный режим — покажем, но без памяти о показе */
  }
  return true;
}

/**
 * Начало захода: была ли у пары общая польза до него. Если была — заводим акцию на
 * 72 часа (если ещё не заведена) и решаем, показать ли «Вдвоём+» во весь экран.
 * Тот же запрос, что у главной: кэш общий, лишнего похода на сервер нет.
 */
async function sellAfterBenefit(data: ReturnType<typeof useMe>["data"], skipPromo: boolean): Promise<void> {
  if (!data?.plusOn || data.pair?.plus?.active) return;
  let benefit = false;
  try {
    const h = await queryClient.fetchQuery<{ benefit?: boolean; offerStarted?: boolean }>({ queryKey: ["home"], queryFn: () => api("/home") });
    benefit = !!h.benefit;
    if (benefit && !h.offerStarted && data.partner && !data.partner.ghost) {
      await api("/plus/offer", { body: {} });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["plus"] });
    }
  } catch {
    /* сеть — продадим в другой раз */
  }
  if (!skipPromo && promoDue(data, benefit)) nav.push("plus", { promo: true, via: "promo" });
}

/** Кнопка из сообщения бота ведёт сразу на нужный экран: ?go=movies, ?go=test:love */
function openGo(go: string, beta: boolean) {
  const [name, arg] = go.split(":");
  const tabs: Record<string, Tab> = { home: "home", calendar: "calendar", wishes: "wishes", plans: "wishes", swipes: "swipes", more: "more" };
  if (tabs[name]) return nav.tab(tabs[name]);
  const decks: Record<string, string> = { movies: "movie", ideas: "idea", places: "place" };
  if (decks[name]) {
    nav.tab("swipes");
    return nav.push("deck", { deck: decks[name] });
  }
  if (name === "matches") {
    nav.tab("swipes");
    return nav.push("matches", { deck: arg ?? "movie" });
  }
  if (name === "test" || name === "tests" || name === "cheatsheet") {
    // Тесты живут на вкладке «Свайпы»: список, тест, шпаргалка
    nav.tab("swipes");
    if (name !== "tests") nav.push("tests");
    // Вне беты новых тестов «Шпаргалки» нет: остаётся список тестов
    if (name === "cheatsheet" && !beta) return;
    return name === "test" ? nav.push("test", { id: arg }) : nav.push(name);
  }
  if (name === "windows") {
    nav.tab("calendar");
    return nav.push("windows");
  }
  if (PUSHED[name]) {
    nav.tab("more");
    // «Вдвоём+» по ссылке (go=plus, возврат из ЮKassa startapp=plus) — помечаем для аналитики
    nav.push(name, name === "plus" ? { via: "link" } : undefined);
  }
}

export function App() {
  const { me, partner, data, isLoading, error, meColor, theyColor } = useMe();
  const tab = useStore((s) => s.tab);
  const stack = useStore((s) => s.stack);
  const started = useRef(false);

  useEffect(() => {
    document.documentElement.style.setProperty("--me", meColor);
    document.documentElement.style.setProperty("--they", theyColor);
  }, [meColor, theyColor]);

  useEffect(() => {
    if (!me || started.current) return;
    started.current = true;
    store.setMe(me.id);
    connectStream();
    // ?go= — кнопка из сообщения бота; startapp=plus — возврат со страницы оплаты ЮKassa
    const go = goParam() ?? (startParam() === "plus" ? "plus" : null);
    if (go && me.onboarded) openGo(go, !!data?.beta);
    if (me.onboarded) void sellAfterBenefit(data, !!go);
    // Во время знакомства тост не нужен: экран «зовёт тебя» уже это говорит
    if (data?.joined && me?.onboarded) {
      const w = instrumental(data.joined);
      store.toast(w ? `Теперь вы вдвоём с ${w} 💞` : `${data.joined} и ты теперь вдвоём 💞`);
    }
    // Экраны новых тестов вне беты не подгружаются (их там нет)
    const warm = () => Object.entries(chunks).forEach(([k, load]) => (data?.beta ? k !== "testsV1" : k !== "tests") && void load().catch(() => {}));
    if ("requestIdleCallback" in window) requestIdleCallback(warm);
    else setTimeout(warm, 1500);
  }, [me, data?.joined]);

  useEffect(() => {
    setBackButton(stack.length ? () => nav.back() : null);
  }, [stack.length]);

  if (isLoading) return <Spinner />;
  if (error || !me)
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <div className="emoji">🔒</div>
        <div className="title-md" style={{ color: "var(--text)" }}>Открой «Вдвоём» из телеграма</div>
        <p className="small">{(error as Error)?.message}</p>
      </div>
    );
  if (!me.onboarded)
    return (
      <Suspense fallback={<Spinner />}>
        <Onboarding />
      </Suspense>
    );

  const Current = TAB_SCREENS[tab];
  return (
    <div className="app">
      <ErrorBoundary key={tab}>
        <Suspense fallback={<div className="screen"><Spinner /></div>}>
          <Current />
        </Suspense>
      </ErrorBoundary>
      <AnimatePresence initial={false}>
        {stack.map((r, i) => {
          const Screen = PUSHED[r.name];
          if (!Screen) return null;
          return (
            <motion.div
              key={`${i}-${r.name}`}
              className="screen pushed"
              style={{ zIndex: 20 + i }}
              // «Вдвоём+» при входе выезжает снизу, как отдельный экран, остальное — справа
              initial={r.params?.promo ? { y: "100%" } : { x: "100%" }}
              animate={r.params?.promo ? { y: 0 } : { x: 0 }}
              exit={r.params?.promo ? { y: "100%" } : { x: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
            >
              <ErrorBoundary>
                <Suspense fallback={<Spinner />}>
                  <Screen {...(r.params ?? {})} />
                </Suspense>
              </ErrorBoundary>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {/* Закрытый тест: «Отзыв» на всех вкладках, кроме свайпов — там внизу свои кнопки */}
      <FeedbackSheet />
      <SearchSheet />
      <nav className="tabbar" style={{ visibility: stack.length ? "hidden" : "visible" }}>
        {TABS.map(({ key, label, Icon }) =>
          key === "swipes" ? (
            <motion.button
              key={key}
              whileTap={{ scale: 0.9 }}
              className={`tab-center${tab === key ? " on" : ""}`}
              aria-label={label}
              onClick={() => {
                haptic.medium();
                nav.tab(key);
              }}
            >
              <span className="center">
                <Logo size={34} a="#ffffff" b="rgba(255,255,255,.72)" />
              </span>
              {/* Подпись под сердцем: без неё не догадаться, что за ним фильмы, места и тесты */}
              <span className="tab-heart-label">{label}</span>
            </motion.button>
          ) : (
            <button
              key={key}
              className={tab === key ? "on" : ""}
              onClick={() => {
                if (tab !== key) haptic.select();
                nav.tab(key);
              }}
            >
              {tab === key && <motion.div layoutId="tab-bg" className="tab-bg" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <Icon size={21} strokeWidth={tab === key ? 2.4 : 2} />
              {label}
            </button>
          ),
        )}
      </nav>
      <MatchOverlay />
      <Paywall />
      <PingBurst partnerName={partner?.name ?? ""} />
      <Toast />
    </div>
  );
}
