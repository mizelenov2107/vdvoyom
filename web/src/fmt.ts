// Даты, деньги и склонения. Время — московское, как на сервере.

const MSK = 180;

export function today(): string {
  return new Date(Date.now() + MSK * 60_000).toISOString().slice(0, 10);
}

export function nowMinutes(): number {
  const d = new Date(Date.now() + MSK * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function weekday(date: string): number {
  const d = new Date(date + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

export const WD = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];
export const WD_FULL = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function dayMonth(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

export function human(date: string): string {
  const diff = daysBetween(today(), date);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff === -1) return "вчера";
  if (diff > 1 && diff < 7) return WD_FULL[weekday(date)];
  return dayMonth(date);
}

/** «сегодня, 24 сентября», «пятница, 25 сентября» — для заголовков дней. */
export function dayLabel(date: string): string {
  const diff = daysBetween(today(), date);
  const head = diff === 0 ? "сегодня" : diff === 1 ? "завтра" : WD_FULL[weekday(date)];
  return `${head}, ${dayMonth(date)}`;
}

export function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function parseHhmm(v: string): number | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 0 && n <= 1440 ? n : null;
}

export function duration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function money(n: number, cur = "₽"): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")} ${cur}`;
}

export function spaced(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

/** Имя в родительном падеже: «хотелки Алины», «ответ Миши». Только частые окончания. */
export function genitive(name: string): string {
  if (/[ая]$/.test(name) && name.length > 2) {
    const stem = name.slice(0, -1);
    return /[гкхжчшщ]$/.test(stem) || name.endsWith("я") ? stem + "и" : stem + "ы";
  }
  if (/[бвгдзклмнпрстфхцжчшщ]$/i.test(name)) return name + "а";
  if (name.endsWith("й")) return name.slice(0, -1) + "я";
  return name;
}

/** Винительный: «позвать Алину». */
export function accusative(name: string): string {
  if (name.endsWith("а") && name.length > 2) return name.slice(0, -1) + "у";
  if (name.endsWith("я") && name.length > 2) return name.slice(0, -1) + "ю";
  if (/[бвгдзклмнпрстфхцжчшщ]$/i.test(name)) return name + "а";
  if (name.endsWith("й")) return name.slice(0, -1) + "я";
  return name;
}

/** Дательный: «напиши Алине». */
export function dative(name: string): string {
  if (/[ая]$/.test(name) && name.length > 2) return name.slice(0, -1) + (name.endsWith("ия") ? "и" : "е");
  if (/[бвгдзклмнпрстфхцжчшщ]$/i.test(name)) return name + "у";
  if (name.endsWith("й")) return name.slice(0, -1) + "ю";
  return name;
}

/** Творительный по именам, где окончание надёжно говорит само за себя. */
const INSTRUMENTAL_EXACT: Record<string, string> = {
  Илья: "Ильёй",
  Любовь: "Любовью",
  Игорь: "Игорем",
};

/**
 * Творительный: «вдвоём с Артёмом», «с Мишей», «с Аней», «с Лизой». Если окончание
 * не говорит, как склонять (Любовь/Игорь — уже в словаре, а Адель, Кармен, Ники,
 * латиница, имя с фамилией), — null: тогда фразу строим без склонения
 * («Артём и ты теперь вдвоём»). Ошибки вида «вдвоём с Артём» хуже, чем без падежа.
 */
export function instrumental(name: string): string | null {
  const n = name.trim();
  if (INSTRUMENTAL_EXACT[n]) return INSTRUMENTAL_EXACT[n];
  // Только одно слово кириллицей с большой буквы, не короче двух букв
  if (!/^[А-ЯЁ][а-яё]+$/.test(n)) return null;
  const stem = n.slice(0, -1);
  if (/ия$/.test(n)) return stem + "ей"; // Мария → Марией
  if (/ья$/.test(n)) return stem + "ей"; // Наталья → Натальей
  if (/я$/.test(n)) return stem + "ей"; // Аня → Аней, Катя → Катей
  if (/[жшчщц]а$/.test(n)) return stem + "ей"; // Миша → Мишей, Саша → Сашей
  if (/а$/.test(n)) return stem + "ой"; // Лиза → Лизой, Дима → Димой
  if (/[ая]й$/.test(n) || /ей$/.test(n) || /ий$/.test(n)) return stem + "ем"; // Николай → Николаем, Алексей → Алексеем, Василий → Василием
  // Мягкий знак — может быть и он, и она (Игорь, Любовь, Адель): не угадываем
  if (/ь$/.test(n)) return null;
  // Шипящие и ц без ударения на конце дают «-ем», но имён таких мало и ударение
  // не угадать — не склоняем
  if (/[жшчщц]$/.test(n)) return null;
  // Твёрдый согласный: Артём → Артёмом, Олег → Олегом. Женские имена на согласный
  // (Кармен, Элис, Рут) не склоняются — их не отличить, поэтому только частые мужские окончания
  if (/[бвгдзклмнпрстфх]$/.test(n)) return FEMININE_CONSONANT.has(n) ? null : n + "ом";
  return null;
}

/** Женские имена на согласный — несклоняемые: «с Кармен», не «с Карменом». */
const FEMININE_CONSONANT = new Set(["Кармен", "Элис", "Рут", "Эстер", "Ирен", "Николь", "Мишель", "Изабель", "Ассоль", "Нинель", "Адель", "Агнес", "Ингрид", "Мэрилин", "Энн", "Сьюзен", "Ким", "Мерседес", "Долорес", "Беатрис", "Алис", "Ивон", "Кэтрин", "Жаклин", "Эвелин", "Мадлен", "Кристин", "Вивьен", "Ширин", "Айгерим", "Гульназ", "Гульнур", "Айгуль", "Гузель", "Наргиз"]);

export function nextYearly(md: string, from = today()): string {
  const mmdd = md.slice(5);
  const y = Number(from.slice(0, 4));
  for (const year of [y, y + 1]) if (`${year}-${mmdd}` >= from) return `${year}-${mmdd}`;
  return `${y + 1}-${mmdd}`;
}

/**
 * Даты повторяющегося события в [from, to]: каждую неделю или каждый месяц с даты
 * начала. Месяц без такого числа пропускается. То же правило — repeatDates на сервере.
 */
export function repeatDates(start: string, repeat: string | null | undefined, from: string, to: string): string[] {
  const out: string[] = [];
  if (from < start) from = start;
  if (repeat === "week") {
    for (let d = addDays(start, Math.ceil(daysBetween(start, from) / 7) * 7); d <= to; d = addDays(d, 7)) out.push(d);
  } else if (repeat === "month") {
    const day = Number(start.slice(8));
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    for (let i = 0; i < 240; i++, m === 12 ? ((m = 1), y++) : m++) {
      const d = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (d > to) break;
      if (day <= new Date(Date.UTC(y, m, 0)).getUTCDate() && d >= from) out.push(d);
    }
  }
  return out;
}
