export interface UserRow {
  id: number;
  first_name: string;
  username: string | null;
  photo_url: string | null;
  name: string | null;
  color: string;
  birthday: string | null;
  pair_id: number | null;
  onboarded: number;
  chat_ok: number;
  commute_min: number;
  /** Запас до встречи в минутах: вычитается до и после очных дел */
  gap_min: number;
  day_start_min: number;
  day_end_min: number;
  rea_group: string | null;
  rea_synced_at: string | null;
  mood: string | null;
  mood_at: string | null;
  consent_at: string | null;
  /** JSON-список скрытых разделов, см. MODULES */
  hidden: string;
  /** JSON-список выключенных напоминаний, см. NOTIFY */
  muted: string;
  created_at: string;
  /** Заблокирован владельцем: API отвечает 403 */
  blocked_at?: string | null;
  /** Откуда пришёл (start_param, например b_<код> блогера): первое касание, не перезаписывается */
  source?: string | null;
  /** 0 — цвет по умолчанию, 1 — выбрал сам, 2 — назначил сервер при соединении пары */
  color_chosen?: number;
  ics_url?: string | null;
  ics_synced_at?: string | null;
  seen_at?: string | null;
}

/**
 * Разделы, которые можно убрать у себя. Работающим, например, ни к чему
 * расписание пар. Убранный раздел пропадает из меню и главной,
 * и бот перестаёт о нём напоминать; данные при этом не стираются.
 */
export const MODULES = ["schedule", "tasks", "goals", "daily", "wardrobe", "tests", "capsules", "votes", "cards", "notes"] as const;
/** Напоминания бота, которые можно выключить. */
export const NOTIFY = ["morning", "daily", "weekly", "tomorrow", "tests"] as const;

export function listOf(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export const hides = (u: Pick<UserRow, "hidden">, module: (typeof MODULES)[number]) => listOf(u.hidden).includes(module);
export const mutes = (u: Pick<UserRow, "muted">, kind: (typeof NOTIFY)[number]) => listOf(u.muted).includes(kind);

export interface PairRow {
  id: number;
  invite_code: string;
  together_since: string | null;
  /** «Вдвоём+» оплачен до этого дня включительно */
  plus_until: string | null;
  /** Источник пары: у создателя, иначе у пригласившего или второго */
  source?: string | null;
  /** Когда второй пришёл по приглашению */
  paired_at?: string | null;
  created_at: string;
}

export function displayName(u: Pick<UserRow, "name" | "first_name">): string {
  return u.name || u.first_name;
}

/** Публичная карточка пользователя для клиента: без служебных полей. */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    name: displayName(u),
    firstName: u.first_name,
    username: u.username,
    photo: u.photo_url,
    color: u.color,
    birthday: u.birthday,
    mood: u.mood,
    moodAt: u.mood_at,
    gapMin: u.gap_min,
    dayStartMin: u.day_start_min,
    dayEndMin: u.day_end_min,
    reaGroup: u.rea_group,
    // Ссылка на календарь секретная: наружу — только сайт, чтобы было видно, откуда пары
    icsHost: u.ics_url ? new URL(u.ics_url).hostname : null,
    reaSyncedAt: u.rea_synced_at,
    onboarded: !!u.onboarded,
    chatOk: !!u.chat_ok,
    /** Заготовка: половинку завели заранее, сама она ещё не заходила */
    ghost: u.id < 0,
    consented: !!u.consent_at,
  };
}
