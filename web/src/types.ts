export interface Person {
  id: number;
  name: string;
  firstName: string;
  username: string | null;
  photo: string | null;
  color: string;
  birthday: string | null;
  mood: string | null;
  moodAt: string | null;
  /** Запас до встречи в минутах */
  gapMin: number;
  dayStartMin: number;
  dayEndMin: number;
  reaGroup: string | null;
  /** Сайт календаря, из которого подтягиваются пары (HSE App X, SmartLMS, Google…) */
  icsHost?: string | null;
  reaSyncedAt: string | null;
  onboarded: boolean;
  chatOk: boolean;
  ghost: boolean;
  consented: boolean;
}

export interface Me {
  me: Person;
  partner: Person | null;
  pair: {
    id: number;
    togetherSince: string | null;
    invite: string;
    plus?: { active: boolean; until: string | null };
    /** Акция на год: до какого момента (ISO) и цены */
    offer?: { until: string; rub: number; oldRub: number } | null;
  } | null;
  bot: string;
  /** Платная часть включена; в бою на время закрытого теста — нет */
  plusOn?: boolean;
  /** Владелец: в «Ещё» есть админка */
  isAdmin?: boolean;
  /** Расписание по фото прямо в приложении */
  aiSchedule?: boolean;
  joined?: string | null;
  /** Что человек убрал у себя: разделы и напоминания бота */
  prefs?: { hidden: string[]; muted: string[] };
  /** Бета новых тестов (08.10.2026, этап 4): новые тесты и «Шпаргалка». false — старые семь тестов */
  beta?: boolean;
}

export interface Win {
  date: string;
  start: number;
  end: number;
  score: number;
}

export interface Block {
  id: number;
  user_id: number;
  kind: "weekly" | "once" | "free";
  weekday: number | null;
  date: string | null;
  start_min: number;
  end_min: number;
  title: string;
  place: string | null;
  skip: number;
  online: number;
  source: string;
  /** class | work | tutoring | sport | other | beauty | health | errands | friends */
  category: string;
}

export interface EventRow {
  id: number;
  author_id: number;
  title: string;
  kind: string;
  date: string;
  end_date: string | null;
  start_min: number | null;
  end_min: number | null;
  yearly: number;
  /** week | month — повтор, ежегодное отмечено yearly */
  repeat?: string | null;
  note: string | null;
  status: string | null;
  idea_item: string | null;
}

export interface Daily {
  date: string;
  question: { id: number; text: string; category: string };
  mine: string | null;
  partnerAnswered: boolean;
  partner: string | null;
  /** mine — моя реакция на ответ половинки, theirs — её на мой. Открываются, когда ответили оба */
  reactions: { mine: string | null; theirs: string | null };
  comments: { id: number; mine: boolean; text: string; at: string }[];
}

export interface NowStatus {
  state: "busy" | "free" | "road" | "rest";
  title: string | null;
  category: string | null;
  online: boolean;
  until: number | null;
  next: { title: string; start: number } | null;
}

export interface GoalBrief {
  id: number;
  title: string;
  emoji: string | null;
  kind: "count" | "checklist" | "habit";
  progress: number;
  target: number;
  unit: string | null;
  streak: number;
  byUser: Record<string, number>;
}

export interface Home {
  now: { me: NowStatus; partner: NowStatus | null };
  todayEvents: { id: number; title: string; kind: string; start_min: number | null; end_min: number | null; status: string | null; author_id: number }[];
  goals: GoalBrief[];
  together: { days: number; since: string; next: { date: string; daysLeft: number; years: number } } | null;
  windows: Win[];
  hasSchedule: { me: boolean; partner: boolean };
  daily: Daily | null;
  upcoming: { kind: string; title: string; date: string; daysLeft: number; who?: number }[];
  stats: { year: string; wishesDone: number; movies: number; ideasDone: number; plansClosed: number; tasksDone: number; questions: number };
  tasks: { mine: number; free: number };
  capsulesReady: { id: number; title: string; author_id: number; open_at: string }[];
  lastPing: { kind: string; created_at: string } | null;
  newMatches: number;
  /** Партнёр закончил раунд теста и ждёт тебя */
  testWaiting?: { id: string; title: string; emoji: string } | null;
}
