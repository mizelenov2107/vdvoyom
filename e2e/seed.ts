// Тестовая база для сквозных тестов: пара Миша (1) и Алина (2), вместе с
// 10.12.2023, по будням у Миши пары 10:00–13:00, у Алины 12:00–15:00.
// Запускается из server/ перед сервером, база — /tmp/vdvoyom-e2e.db.
import { get, run } from "../server/src/db.ts";
import { ensurePair, joinPair } from "../server/src/pairs.ts";

run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (1, 'Миша', 'Миша', 'violet', 1, datetime('now')), (2, 'Алина', 'Алина', 'rose', 1, datetime('now'))`,
);
const pair = ensurePair(1);
const joined = joinPair(2, pair.invite_code);
if (!joined.ok) throw new Error("не соединилась пара");
run("UPDATE pairs SET together_since = '2024-03-01' WHERE id = ?", pair.id);
for (let wd = 1; wd <= 5; wd++) {
  run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min, title) VALUES (1, 'weekly', ?, 600, 780, 'Матанализ')", wd);
  run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min, title) VALUES (2, 'weekly', ?, 720, 900, 'Микроэкономика')", wd);
}
// Вторая пара — бесплатная навсегда: на ней проверяются лимиты и акция.
// У неё уже две цели, то есть бесплатный предел целей выбран.
run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (3, 'Аня', 'Аня', 'sky', 1, datetime('now')), (4, 'Боря', 'Боря', 'violet', 1, datetime('now'))`,
);
const free = ensurePair(3);
if (!joinPair(4, free.invite_code).ok) throw new Error("не соединилась вторая пара");
run("INSERT INTO goals (pair_id, author_id, kind, title, emoji, target) VALUES (?, 3, 'count', '12 книг за год', '📚', 12), (?, 3, 'count', 'Встретить 5 рассветов', '🌅', 5)", free.id, free.id);
// Пары 5+6 и 7+8 покупают «навсегда», по одной на движок (chrome, iphone): бессрочный
// доступ прячет тарифы, поэтому им нужны свои пары, а движки идут параллельно
run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (5, 'Вера', 'Вера', 'mint', 1, datetime('now')), (6, 'Глеб', 'Глеб', 'sun', 1, datetime('now')),
          (7, 'Даша', 'Даша', 'coral', 1, datetime('now')), (8, 'Егор', 'Егор', 'sky', 1, datetime('now'))`,
);
for (const [a, b] of [[5, 6], [7, 8]]) {
  if (!joinPair(b, ensurePair(a).invite_code).ok) throw new Error(`не соединилась пара ${a}+${b}`);
}
console.log(`e2e: база готова, пары ${pair.id} и ${free.id}, «навсегда» — 5+6 и 7+8`);

// Как у владельца 04.10.2026: много сохранёнок из инстаграма не той жанровой масти.
// Колода с выбранной «комедией» обязана их отсекать (e2e/zhanry.spec.ts).
import { movies } from "../server/src/content.ts";
const notComedy = (movies() as { id: string; genres: string[] }[]).filter((m) => !m.genres.includes("комедия")).slice(0, 30);
for (const who of [3, 5, 7]) {
  const pid = get<{ pair_id: number }>("SELECT pair_id FROM users WHERE id = ?", who)!.pair_id;
  for (const m of notComedy) run("INSERT OR IGNORE INTO saved (pair_id, deck, item, added_by, source) VALUES (?, 'movie', ?, ?, 'instagram')", pid, m.id, who);
}


// Шаг 4 из проекта «Мини-апп Вдвоём»: восемь пунктов прогона на двух телефонах
// (e2e/shag4.spec.ts). Свои пары у движков: 21+22 (chrome) и 23+24 (iphone), обе
// с «Вдвоём+» навсегда — как в закрытом тесте, где всё открыто. У первого пары
// по будням 10:00–13:00, у второго только пары «с сайта РЭУ» на две даты: страница
// в формате rasp.rea.ru проходит через тот же разбор parseWeek и ложится в базу,
// как это делает syncUser.
import { parseWeek } from "../server/src/rea.ts";
import { addDays, today } from "../server/src/time.ts";
import { FOREVER } from "../server/src/plus.ts";

const REA_DNI = [2, 5]; // те же сдвиги в e2e/shag4.spec.ts
run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (21, 'Лёва', 'Лёва', 'violet', 1, datetime('now')), (22, 'Нина', 'Нина', 'rose', 1, datetime('now')),
          (23, 'Митя', 'Митя', 'sky', 1, datetime('now')), (24, 'Оля', 'Оля', 'coral', 1, datetime('now'))`,
);
const reaHtml = (d1: string, d2: string) => {
  const ru = (d: string) => d.split("-").reverse().join(".");
  const slot = (t: string, what: string) =>
    `<tr class="slot load-lecture"><td>${t}</td><td><a href='#' class='task'>${what}<br>Лекция<br>3 корпус - 305</a></td></tr>`;
  return `<input id="weekNum" value="7">
<th class="dayh">${ru(d1)}</th>${slot("1 пара<br>08:30 - 10:00", "Микроэкономика")}${slot("2 пара<br>10:10 - 11:40", "Статистика")}<tr class="slot load-empty"><td>3 пара</td></tr>
<th class="dayh">${ru(d2)}</th>${slot("4 пара<br>14:00 - 15:30", "Эконометрика")}`;
};
// id 9–20 не трогаем: adminka.spec.ts берёт 11 и 12 как «новых людей»
for (const [a, b] of [[21, 22], [23, 24]]) {
  const p = ensurePair(a);
  if (!joinPair(b, p.invite_code).ok) throw new Error(`не соединилась пара ${a}+${b}`);
  run("UPDATE pairs SET plus_until = ?, together_since = '2024-02-14' WHERE id = ?", FOREVER, p.id);
  for (let wd = 1; wd <= 5; wd++) run("INSERT INTO schedule (user_id, kind, weekday, start_min, end_min, title) VALUES (?, 'weekly', ?, 600, 780, 'Матанализ')", a, wd);
  const { lessons } = parseWeek(reaHtml(addDays(today(), REA_DNI[0]), addDays(today(), REA_DNI[1])));
  for (const l of lessons) {
    run(
      `INSERT INTO schedule (user_id, kind, date, start_min, end_min, title, place, online, skip, source)
       VALUES (?, 'once', ?, ?, ?, ?, ?, ?, 0, 'rea')`,
      b, l.date, l.start_min, l.end_min, l.kind ? `${l.title} · ${l.kind.toLowerCase()}` : l.title, l.place, l.online ? 1 : 0,
    );
  }
}

// Личные дела «Только я» (08.10.2026, e2e/lichnoe.spec.ts): пары 25+26 (chrome) и
// 27+28 (iphone) без расписания — весь день свободен, и окно рвёт только маникюр
run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (25, 'Сева', 'Сева', 'violet', 1, datetime('now')), (26, 'Тома', 'Тома', 'rose', 1, datetime('now')),
          (27, 'Уля', 'Уля', 'coral', 1, datetime('now')), (28, 'Фёдор', 'Фёдор', 'sky', 1, datetime('now'))`,
);
for (const [a, b] of [[25, 26], [27, 28]]) {
  const p = ensurePair(a);
  if (!joinPair(b, p.invite_code).ok) throw new Error(`не соединилась пара ${a}+${b}`);
  run("UPDATE pairs SET plus_until = ? WHERE id = ?", FOREVER, p.id);
}

// Тесты на совместимость, формат 2 (08.10.2026, e2e/testy.spec.ts): пары 29+30 (chrome)
// и 31+32 (iphone) — «Угадай меня» и «Идеальное свидание» проходятся двумя людьми, раунды
// и действия меняют общие данные. С «Вдвоём+» навсегда: с вечера 08.10 второй раунд
// во «Вдвоём+», а здесь проверяется сама механика. Граница бесплатного — пары 47–50 ниже
// (e2e/limity.spec.ts)
run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (29, 'Ася', 'Ася', 'violet', 1, datetime('now')), (30, 'Тимур', 'Тимур', 'rose', 1, datetime('now')),
          (31, 'Яна', 'Яна', 'coral', 1, datetime('now')), (32, 'Лев', 'Лев', 'sky', 1, datetime('now'))`,
);
for (const [a, b] of [[29, 30], [31, 32]]) {
  const p = ensurePair(a);
  if (!joinPair(b, p.invite_code).ok) throw new Error(`не соединилась пара ${a}+${b}`);
  run("UPDATE pairs SET plus_until = ? WHERE id = ?", FOREVER, p.id);
}

// Экраны тестов для кликабельности и снимков (на паре Миша и Алина, только чтение):
// «Что мне приятно» — закрытый раунд с результатом, «Идеальное свидание» — начатый
// раунд у Миши (черновик, три ответа), «Угадай меня» — ещё не начат.
import { tests as allTests } from "../server/src/content.ts";
{
  const pid = pair.id;
  const pr = allTests().find((t) => t.id === "priyatno")!;
  const ids = pr.pool.slice(0, pr.perRound).map((q) => q.id);
  run("INSERT INTO test_rounds (pair_id, test_id, round, question_ids, closed_at) VALUES (?, 'priyatno', 1, ?, datetime('now'))", pid, JSON.stringify(ids));
  const ans = (self: number, guess: number) =>
    JSON.stringify(Object.fromEntries(pr.pool.slice(0, pr.perRound).map((q, i) => [q.id, i === 9 ? { skip: true } : { self: q.options[(self + i) % 4].id, guess: q.options[(guess + i) % 4].id }])));
  run("INSERT INTO test_round_answers (pair_id, test_id, round, user_id, answers, pos, finished_at) VALUES (?, 'priyatno', 1, 1, ?, 10, datetime('now'))", pid, ans(0, 1));
  run("INSERT INTO test_round_answers (pair_id, test_id, round, user_id, answers, pos, finished_at) VALUES (?, 'priyatno', 1, 2, ?, 10, datetime('now'))", pid, ans(1, 0));
  const sv = allTests().find((t) => t.id === "svidanie")!;
  const svIds = sv.pool.slice(0, sv.perRound).map((q) => q.id);
  run("INSERT INTO test_rounds (pair_id, test_id, round, question_ids) VALUES (?, 'svidanie', 1, ?)", pid, JSON.stringify(svIds));
  const draft = Object.fromEntries(sv.pool.slice(0, 3).map((q) => [q.id, { self: q.options[0].id }]));
  run("INSERT INTO test_round_answers (pair_id, test_id, round, user_id, answers, pos) VALUES (?, 'svidanie', 1, 1, ?, 3)", pid, JSON.stringify(draft));
}

// Бета новых тестов (08.10.2026, этап 4): новые тесты и «Шпаргалку» видит
// только пара владельца — та, где есть кто-то из ADMIN_IDS. В e2e ADMIN_IDS задан в
// playwright.config.ts: Миша (1) — «владелец», и по одному человеку из пар, на которых
// идут e2e новых тестов (29, 31). Все остальные пары —
// обычные: у них старые семь тестов, как до 08.10.
// Обычные пары для e2e/testy-v1.spec.ts: 41+42 (chrome) и 43+44 (iphone). У каждой уже
// есть старый результат «Это или то» в test_answers — он должен быть виден, как раньше.
import { testsV1 } from "../server/src/content.ts";
run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (41, 'Жора', 'Жора', 'violet', 1, datetime('now')), (42, 'Зоя', 'Зоя', 'rose', 1, datetime('now')),
          (43, 'Илья', 'Илья', 'sky', 1, datetime('now')), (44, 'Кира', 'Кира', 'coral', 1, datetime('now'))`,
);
{
  const tot = testsV1().find((t) => t.id === "thisorthat")!;
  const ans = (shift: number) => JSON.stringify(Object.fromEntries(tot.questions.map((q, i) => [q.id as string, (i + shift) % 3 ? "a" : "b"])));
  for (const [a, b] of [[41, 42], [43, 44]]) {
    const p = ensurePair(a);
    if (!joinPair(b, p.invite_code).ok) throw new Error(`не соединилась пара ${a}+${b}`);
    run("INSERT INTO test_answers (pair_id, test_id, user_id, answers) VALUES (?, 'thisorthat', ?, ?), (?, 'thisorthat', ?, ?)", p.id, a, ans(0), p.id, b, ans(1));
  }
}

// Что бесплатно, а что во «Вдвоём+» в новых тестах (08.10.2026, e2e/limity.spec.ts): бета-пары
// без «Вдвоём+» 47+48 (chrome) и 49+50 (iphone), все четверо в ADMIN_IDS (бета).
// Первый раунд «Угадай меня» закрыт, догадки мимо — шпаргалка длиннее трёх строк.
run(
  `INSERT OR REPLACE INTO users (id, first_name, name, color, onboarded, consent_at)
   VALUES (47, 'Маша', 'Маша', 'violet', 1, datetime('now')), (48, 'Никита', 'Никита', 'rose', 1, datetime('now')),
          (49, 'Полина', 'Полина', 'coral', 1, datetime('now')), (50, 'Рустам', 'Рустам', 'sky', 1, datetime('now'))`,
);
for (const [a, b] of [[47, 48], [49, 50]]) {
  const pid = ensurePair(a).id;
  if (!joinPair(b, ensurePair(a).invite_code).ok) throw new Error(`не соединилась пара ${a}+${b}`);
  const ug = allTests().find((t) => t.id === "ugaday")!;
  const qs = ug.pool.slice(0, ug.perRound);
  run("INSERT INTO test_rounds (pair_id, test_id, round, question_ids, closed_at) VALUES (?, 'ugaday', 1, ?, datetime('now'))", pid, JSON.stringify(qs.map((q) => q.id)));
  const miss = JSON.stringify(Object.fromEntries(qs.map((q) => [q.id, { self: q.options[0].id, guess: q.options[1].id }])));
  for (const who of [a, b]) run("INSERT INTO test_round_answers (pair_id, test_id, round, user_id, answers, pos, finished_at) VALUES (?, 'ugaday', 1, ?, ?, ?, datetime('now'))", pid, who, miss, qs.length);
}
