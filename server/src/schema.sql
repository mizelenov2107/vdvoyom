-- Схема базы «Вдвоём». Одна пара — одно общее пространство; всё, кроме
-- пользователей и их расписаний, привязано к pair_id, и каждый запрос
-- на сервере фильтруется по паре того, кто спрашивает.
-- Время дня хранится минутами от полуночи по Москве, даты — строкой YYYY-MM-DD.

CREATE TABLE IF NOT EXISTS pairs (
  id              INTEGER PRIMARY KEY,
  invite_code     TEXT NOT NULL UNIQUE,
  together_since  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,           -- id пользователя в телеграме
  first_name      TEXT NOT NULL,
  username        TEXT,
  photo_url       TEXT,
  name            TEXT,                          -- как подписывать в приложении
  color           TEXT NOT NULL DEFAULT 'blue',
  birthday        TEXT,                          -- YYYY-MM-DD, год может быть 0000
  pair_id         INTEGER REFERENCES pairs(id),
  onboarded       INTEGER NOT NULL DEFAULT 0,
  chat_ok         INTEGER NOT NULL DEFAULT 0,    -- писал боту, сообщения доходят
  commute_min     INTEGER NOT NULL DEFAULT 45,   -- дорога до и после пары
  day_start_min   INTEGER NOT NULL DEFAULT 600,  -- раньше 10:00 не зовём
  day_end_min     INTEGER NOT NULL DEFAULT 1380, -- позже 23:00 не зовём
  rea_group       TEXT,                          -- группа РЭУ для автоподтяжки
  rea_synced_at   TEXT,
  mood            TEXT,
  mood_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- kind: weekly — пара по дню недели; once — занятость на дату;
--       free — разовое освобождение (пару отменили).
-- skip = 1: пара в расписании есть, но я на неё не хожу, время свободно.
-- online = 1: вебинар, дорога вокруг него не нужна.
CREATE TABLE IF NOT EXISTS schedule (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('weekly','once','free')),
  weekday     INTEGER,
  date        TEXT,
  start_min   INTEGER NOT NULL,
  end_min     INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  place       TEXT,
  skip        INTEGER NOT NULL DEFAULT 0,
  online      INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_schedule_user ON schedule(user_id, kind);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'event',     -- event | date | trip | birthday | anniversary
  date        TEXT NOT NULL,
  end_date    TEXT,
  start_min   INTEGER,
  end_min     INTEGER,
  yearly      INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_pair ON events(pair_id, date);

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY,
  pair_id      INTEGER NOT NULL REFERENCES pairs(id),
  author_id    INTEGER NOT NULL,
  title        TEXT NOT NULL,
  due          TEXT,
  assignee_id  INTEGER,                          -- NULL — свободная задача
  taken_at     TEXT,
  done_at      TEXT,
  done_by      INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_pair ON tasks(pair_id);

-- reserved_by: половинка тайно отметила «подарю я». Владельцу не отдаётся.
CREATE TABLE IF NOT EXISTS wishes (
  id           INTEGER PRIMARY KEY,
  pair_id      INTEGER NOT NULL REFERENCES pairs(id),
  owner_id     INTEGER NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT,
  price        INTEGER,
  image        TEXT,
  level        INTEGER NOT NULL DEFAULT 2,       -- 1 можно, 2 хочу, 3 очень хочу
  note         TEXT,
  reserved_by  INTEGER,
  done_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wishes_pair ON wishes(pair_id);

CREATE TABLE IF NOT EXISTS plans (
  id           INTEGER PRIMARY KEY,
  pair_id      INTEGER NOT NULL REFERENCES pairs(id),
  author_id    INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'покупка',  -- поездка | покупка | ремонт | событие | другое
  title        TEXT NOT NULL,
  target       INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT '₽',
  due          TEXT,
  place_id     TEXT,                             -- если план родился из мэтча направления
  archived_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- amount > 0 — взнос в копилку, amount < 0 — трата из неё.
CREATE TABLE IF NOT EXISTS plan_entries (
  id          INTEGER PRIMARY KEY,
  plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  amount      INTEGER NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  store       TEXT NOT NULL,
  number      TEXT NOT NULL,
  format      TEXT NOT NULL DEFAULT 'CODE128',   -- EAN13 | EAN8 | CODE128 | QR
  color       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  question    TEXT NOT NULL,
  options     TEXT NOT NULL,                     -- JSON-массив строк
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vote_answers (
  vote_id     INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  option      INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (vote_id, user_id)
);

CREATE TABLE IF NOT EXISTS capsules (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  open_at     TEXT NOT NULL,
  notified    INTEGER NOT NULL DEFAULT 0,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily (
  pair_id      INTEGER NOT NULL,
  date         TEXT NOT NULL,
  question_id  INTEGER NOT NULL,
  PRIMARY KEY (pair_id, date)
);
CREATE TABLE IF NOT EXISTS daily_answers (
  pair_id     INTEGER NOT NULL,
  date        TEXT NOT NULL,
  user_id     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair_id, date, user_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0,
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- duration: 2h — пара часов, half — полдня, day — целый день, night — с ночёвкой.
CREATE TABLE IF NOT EXISTS ideas (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  title       TEXT NOT NULL,
  place       TEXT,
  price       TEXT,
  duration    TEXT,
  emoji       TEXT,
  note        TEXT,
  url         TEXT,
  status      TEXT NOT NULL DEFAULT 'want',      -- want | done | dropped
  done_on     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Свайпы трёх колод: movie (фильмы), idea (куда сходить), place (куда слетать).
CREATE TABLE IF NOT EXISTS swipes (
  pair_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  deck        TEXT NOT NULL,
  item        TEXT NOT NULL,
  liked       INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair_id, user_id, deck, item)
);
CREATE TABLE IF NOT EXISTS matches (
  pair_id     INTEGER NOT NULL,
  deck        TEXT NOT NULL,
  item        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',       -- new | planned | done
  done_on     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair_id, deck, item)
);

CREATE TABLE IF NOT EXISTS movie_prefs (
  user_id     INTEGER PRIMARY KEY,
  genres      TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_answers (
  pair_id      INTEGER NOT NULL,
  test_id      TEXT NOT NULL,
  user_id      INTEGER NOT NULL,
  answers      TEXT NOT NULL,
  finished_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair_id, test_id, user_id)
);

CREATE TABLE IF NOT EXISTS pings (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL,
  from_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ключ уже отправленного напоминания, чтобы крон не повторял его.
CREATE TABLE IF NOT EXISTS sent (
  key         TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Совместные цели. kind: count — набрать число («12 книг», «20 новых мест»),
-- checklist — пройти шаги, habit — делать N раз в неделю.
CREATE TABLE IF NOT EXISTS goals (
  id           INTEGER PRIMARY KEY,
  pair_id      INTEGER NOT NULL REFERENCES pairs(id),
  author_id    INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'count',
  title        TEXT NOT NULL,
  emoji        TEXT,
  target       INTEGER,
  unit         TEXT,
  due          TEXT,
  archived_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS goal_steps (
  id          INTEGER PRIMARY KEY,
  goal_id     INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  pos         INTEGER NOT NULL DEFAULT 0,
  done_by     INTEGER,
  done_at     TEXT
);
CREATE TABLE IF NOT EXISTS goal_marks (
  id          INTEGER PRIMARY KEY,
  goal_id     INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  date        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Фото-моменты: снимки со свиданий и поездок. Файл лежит на томе /data/photos.
CREATE TABLE IF NOT EXISTS moments (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  date        TEXT NOT NULL,
  caption     TEXT,
  file        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  event_id    INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_moments_pair ON moments(pair_id, date);

-- Гардероб: вещи каждого из пары. Фото на томе /data/photos, как у моментов.
-- category: top | bottom | dress | outer | shoes | accessory
-- warmth: 1 лёгкое, 2 среднее, 3 тёплое. styles — JSON: casual, smart, sport.
CREATE TABLE IF NOT EXISTS wardrobe (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  owner_id    INTEGER NOT NULL,
  file        TEXT NOT NULL,
  category    TEXT NOT NULL,
  color       TEXT NOT NULL,
  color_name  TEXT NOT NULL,
  warmth      INTEGER NOT NULL DEFAULT 2,
  styles      TEXT NOT NULL DEFAULT '["casual"]',
  title       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wardrobe_pair ON wardrobe(pair_id, owner_id);

-- Сохранённые парные луки. items — JSON {"<id пользователя>": [id вещей]}.
CREATE TABLE IF NOT EXISTS looks (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL REFERENCES pairs(id),
  author_id   INTEGER NOT NULL,
  title       TEXT NOT NULL,
  occasion    TEXT,
  date        TEXT,
  items       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Карточки колод, которые кто-то сохранил у себя (например, фильмы из
-- инстаграм-сохранёнок): в колоде они идут раньше и помечены источником.
CREATE TABLE IF NOT EXISTS saved (
  pair_id     INTEGER NOT NULL,
  deck        TEXT NOT NULL,
  item        TEXT NOT NULL,
  added_by    INTEGER NOT NULL,
  source      TEXT NOT NULL DEFAULT 'instagram',
  url         TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair_id, deck, item)
);

-- Фильмы, которые пары нашли поиском по IMDb и добавили сами. Общий кэш:
-- одна и та же картина у двух пар хранится один раз, а в колоду пары она
-- попадает строкой saved с item = 'i:<tt-номер>' и source = 'user'.
CREATE TABLE IF NOT EXISTS films (
  imdb        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  original    TEXT,
  year        INTEGER,
  genres      TEXT NOT NULL DEFAULT '[]',
  minutes     INTEGER,
  description TEXT,
  poster      TEXT,                                  -- файл в film-posters/, NULL — постера нет
  series      INTEGER NOT NULL DEFAULT 0,
  kp          INTEGER,                               -- номер на Кинопоиске (из Викиданных)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Оценки Кинопоиска из их информера. rating NULL — спросили, оценки нет.
CREATE TABLE IF NOT EXISTS kp_ratings (
  kp          INTEGER PRIMARY KEY,
  rating      REAL,
  votes       INTEGER,
  updated_at  TEXT NOT NULL
);

-- Оплаты «Вдвоём+» через ЮKassa. id — идентификатор платежа в ЮKassa.
-- status повторяет её статусы; succeeded ставится только после нашей проверки.
CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,
  pair_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  plan        TEXT NOT NULL,
  amount      INTEGER NOT NULL,                      -- рубли
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_pair ON payments(pair_id, status);

-- Отзывы закрытого теста (27.09.2026): кнопка «Отзыв» в приложении. Сообщение
-- уходит владельцу в телеграм; его реплай на это сообщение бот пересылает автору.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  pair_id     INTEGER,
  kind        TEXT NOT NULL,                         -- dislike | add | remove | design | bug
  text        TEXT NOT NULL,
  screen      TEXT,                                  -- откуда открыли: «Главная», «Календарь»…
  platform    TEXT,                                  -- ios 8.0 · 390×844
  photos      TEXT,                                  -- JSON: файлы в photosDir/feedback
  tg_message  INTEGER,                               -- id сообщения владельцу
  reply       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_tg ON feedback(tg_message);

-- Вопрос дня (28.09.2026): реакция смайликом на ответ половинки и переписка под
-- ответами. Открываются, когда ответили оба.
CREATE TABLE IF NOT EXISTS daily_reactions (
  pair_id    INTEGER NOT NULL,
  date       TEXT NOT NULL,
  user_id    INTEGER NOT NULL,                       -- кто реагирует (на ответ половинки)
  emoji      TEXT NOT NULL,
  PRIMARY KEY (pair_id, date, user_id)
);
CREATE TABLE IF NOT EXISTS daily_comments (
  id          INTEGER PRIMARY KEY,
  pair_id     INTEGER NOT NULL,
  date        TEXT NOT NULL,
  user_id     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_comments ON daily_comments(pair_id, date);

-- Журнал действий для админки (28.09.2026): кто, когда и что сделал — метод и
-- маршрут, без содержимого (тексты, фото и письма пары сюда не попадают).
-- Хранится 90 дней, чистит cron.
CREATE TABLE IF NOT EXISTS activity (
  id       INTEGER PRIMARY KEY,
  user_id  INTEGER NOT NULL,
  pair_id  INTEGER,
  action   TEXT NOT NULL,                            -- «POST /moments», «JOIN» — первый вход
  at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity(user_id, at);

-- Расходы на ИИ (28.09.2026): распознавание расписания через Яндекс. Цена
-- считается по тарифам из env (PRICE_OCR, PRICE_IN, PRICE_OUT) — для лимита
-- AI_MONTH_LIMIT_RUB и для админки.
CREATE TABLE IF NOT EXISTS ai_usage (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  pages       INTEGER NOT NULL DEFAULT 0,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  rub         REAL NOT NULL DEFAULT 0,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_at ON ai_usage(at);

-- Тесты на совместимость, формат 2 (08.10.2026): раунды из пула вопросов.
-- Старая таблица test_answers больше не читается, но и не чистится: ответы
-- первых тестировщиков остаются в базе (определения старых тестов —
-- data/tests-v1.json).
-- question_ids — JSON-список вопросов раунда; again = 1 — пул кончился, вопросы по второму кругу.
CREATE TABLE IF NOT EXISTS test_rounds (
  pair_id      INTEGER NOT NULL,
  test_id      TEXT NOT NULL,
  round        INTEGER NOT NULL,
  question_ids TEXT NOT NULL,
  again        INTEGER NOT NULL DEFAULT 0,
  opened_at    TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at    TEXT,                                 -- закончили оба: результат открыт
  reminded_at  TEXT,                                 -- напоминание через 48 часов ушло
  PRIMARY KEY (pair_id, test_id, round)
);
-- Ответы человека в раунде. Пока finished_at пусто — это черновик: answers
-- переписываются после каждого ответа, pos — где продолжить.
-- answers: {"<вопрос>": {"self": "<вариант>", "guess": "<вариант>"} | {"skip": true}}
CREATE TABLE IF NOT EXISTS test_round_answers (
  pair_id      INTEGER NOT NULL,
  test_id      TEXT NOT NULL,
  round        INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  answers      TEXT NOT NULL DEFAULT '{}',
  pos          INTEGER NOT NULL DEFAULT 0,
  finished_at  TEXT,
  nudged_at    TEXT,                                 -- когда этот человек последний раз нажал «Напомнить»
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair_id, test_id, round, user_id)
);
-- Отметки к результату: talked — «Обсудили» (видят оба), act — создано действие
-- (ref: «task:12»), cheat — ответ партнёра в «Шпаргалке».
CREATE TABLE IF NOT EXISTS test_marks (
  pair_id      INTEGER NOT NULL,
  test_id      TEXT NOT NULL,
  round        INTEGER NOT NULL,
  question_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  user_id      INTEGER NOT NULL,
  ref          TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pair_id, test_id, round, question_id, kind, user_id)
);

-- Блогеры и другие источники прихода (11.10.2026). code — то, что идёт после b_ в
-- ссылке t.me/<бот>?startapp=b_<code> или ?start=b_<code>; в users.source и
-- pairs.source лежит уже вместе с приставкой: b_<code>.
CREATE TABLE IF NOT EXISTS partners (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  platform    TEXT,                                  -- инстаграм, тикток, телеграм…
  url         TEXT,                                  -- профиль блогера
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
