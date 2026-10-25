// Статичный контент приложения: каталоги колод, вопросы дня и тесты.
// Файлы лежат в data/ и читаются один раз при первом обращении.
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.ts";

export interface Movie {
  id: string;
  title: string;
  original: string | null;
  year: number;
  genres: string[];
  minutes: number | null;
  description: string;
  kp: number | null;
  imdb: string | null;
  poster: string;
  /** Сериал из сохранёнок: длительность серии не показываем, в жанрах первым идёт «сериал». */
  series?: boolean;
}

export interface Place {
  id: string;
  name: string;
  country: string;
  flag: string;
  kind: string;
  route: string;
  budget: number;
  season: string;
  days: string;
  why: string;
  image: string;
}

export interface CatalogIdea {
  id: string;
  title: string;
  emoji: string;
  place: string;
  price: string;
  duration: "2h" | "half" | "day" | "night";
  why: string;
}

export interface Question {
  id: number;
  text: string;
  category: string;
}

/**
 * Тесты на совместимость, формат 2 (08.10.2026). У теста пул вопросов, пара проходит раунды по perRound вопросов.
 * id вариантов стабильные: правка текста не ломает сохранённые ответы.
 */
export interface TestOption {
  id: string;
  text: string;
  /** «Что мне приятно»: язык жеста (words, time, gifts, acts, touch); «Идеальное свидание»: полюс оси */
  tag?: string;
}

export type ActType = "task" | "event" | "wish" | "goal" | "plan" | "capsule" | "note" | "cheat";

/** Действие после расхождения. В title подставляются {mine}, {theirs} и {name}. */
export interface TestAct {
  type: ActType;
  title?: string;
  list?: string;
  /** Срок дела, дата события или открытия капсулы: через столько дней */
  days?: number;
  price?: number;
  target?: number;
  unit?: string;
  emoji?: string;
  kind?: string;
  /** Дело сразу на себя («взять на эту неделю») */
  assignee?: "me";
}

export interface TestQuestion {
  id: string;
  /** Вопрос про себя */
  self: string;
  /** Строка угадывания с {name} в именительном падеже; по умолчанию «А что выберет {name}?» */
  about?: string;
  options: TestOption[];
  /** Два-три вопроса для разговора */
  talk: string[];
  act: TestAct;
  /** 1 — лёгкий, 2 — серьёзный (выше в результатах) */
  weight?: number;
  /** «Идеальное свидание»: ось профиля свидания */
  axis?: string;
}

export interface DateIdea {
  id: string;
  title: string;
  emoji: string;
  duration: string;
  price: string;
  why: string;
  tags: Record<string, string>;
  /** id карточки в колоде «Куда сходить», если идея оттуда */
  catalog?: string;
}

export interface Test {
  id: string;
  title: string;
  emoji: string;
  /** Одна строка для списка */
  blurb: string;
  /** Строка перед первым вопросом («Тут нет правильных ответов…») */
  intro?: string;
  /** guess — про себя и угадай; either — это или то без угадывания */
  kind: "guess" | "either";
  perRound: number;
  minutes: number;
  /** Показывать «ты угадываешь N из M» */
  score?: boolean;
  /** Промахи копятся в «Шпаргалке про партнёра» */
  cheat?: boolean;
  /** «Идеальное свидание»: оси профиля и их полюса */
  axes?: Record<string, { title: string; poles: Record<string, string> }>;
  ideas?: DateIdea[];
  pool: TestQuestion[];
}

/**
 * Старые тесты (до 08.10.2026): 7 тестов, ответы в test_answers. Их видят все пары,
 * кроме беты новых тестов (beta.ts); определения — server/data/tests-v1.json.
 */
export interface TestV1 {
  id: string;
  kind: "love_languages" | "this_or_that" | "know_me" | "scale";
  title: string;
  emoji: string;
  description: string;
  minutes: number;
  languages?: { key: string; title: string; description: string; tips: string[] }[];
  questions: Record<string, unknown>[];
}

const cache = new Map<string, unknown>();

function load<T>(file: string): T[] {
  if (cache.has(file)) return cache.get(file) as T[];
  const full = path.join(env.dataDir, file);
  let data: T[] = [];
  try {
    data = JSON.parse(fs.readFileSync(full, "utf8")) as T[];
  } catch (e) {
    console.warn(`content: ${file} не прочитан (${(e as Error).message})`);
  }
  cache.set(file, data);
  return data;
}

export const movies = () => load<Movie>("movies.json");
export const places = () => load<Place>("places.json");
export const catalogIdeas = () => load<CatalogIdea>("ideas.json");
export const questions = () => load<Question>("questions.json");
export const testsV1 = () => load<TestV1>("tests-v1.json");
/** tests.json формата 2: { "version": 2, "tests": [...] } */
export function tests(): Test[] {
  if (cache.has("tests.json")) return cache.get("tests.json") as Test[];
  let list: Test[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(env.dataDir, "tests.json"), "utf8")) as { version?: number; tests?: Test[] };
    list = raw.version === 2 && Array.isArray(raw.tests) ? raw.tests : [];
  } catch (e) {
    console.warn(`content: tests.json не прочитан (${(e as Error).message})`);
  }
  cache.set("tests.json", list);
  return list;
}

export function movieById(id: string): Movie | undefined {
  return movies().find((m) => m.id === id);
}
export function placeById(id: string): Place | undefined {
  return places().find((p) => p.id === id);
}

export const GENRES = [
  "комедия", "мелодрама", "драма", "фантастика", "фэнтези", "приключения", "боевик", "триллер",
  "детектив", "криминал", "ужасы", "мультфильм", "семейный", "аниме", "исторический", "военный",
  "биография", "музыкальный", "спорт", "сериал",
];
