// Поиск по разделам (отзыв #3, 28.09.2026): «функций много — хочу написать слово
// и сразу туда». Лупа на главной и в «Ещё», шторка со списком разделов; слово ищется
// в названии и в синонимах («письмо» → Капсулы, «лук» → Что надеть).
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useMe, type Module } from "../data.ts";
import { nav, store, useStore, type Tab } from "../store.ts";
import { haptic } from "../tg.ts";
import { Sheet } from "../ui/kit.tsx";

interface Place {
  title: string;
  sub: string;
  words: string;
  tab: Tab;
  push?: [string, Record<string, unknown>?];
  module?: Module;
  admin?: boolean;
  plus?: boolean;
  /** true — только в бете новых тестов, false — только вне беты */
  beta?: boolean;
  action?: () => void;
}

const PLACES: Place[] = [
  { title: "Главная", sub: "сейчас, дни вместе, настроение", words: "домой главный настроение скучаю годовщина дни вместе", tab: "home" },
  { title: "Календарь", sub: "события и свидания", words: "события свидание встреча дата день рождения праздник", tab: "calendar" },
  { title: "Когда оба свободны", sub: "общие окна по расписаниям", words: "окна свободны время встретиться запас", tab: "calendar", push: ["windows"], module: "schedule" },
  { title: "Расписание", sub: "пары, работа, импорт из чата с ИИ", words: "расписание пары вуз работа учёба занятия импорт рэу вшэ", tab: "calendar", push: ["schedule"], module: "schedule" },
  { title: "Фильмы", sub: "свайпы: что посмотреть вечером", words: "кино фильм сериал посмотреть свайп вечер свой фильм imdb кинопоиск", tab: "swipes", push: ["deck", { deck: "movie" }] },
  { title: "Куда сходить", sub: "места в городе", words: "места сходить ресторан кафе бар прогулка город своё место", tab: "swipes", push: ["deck", { deck: "place" }] },
  { title: "Идеи для свиданий", sub: "чем заняться вдвоём", words: "идеи свидание занятие чем заняться поездка", tab: "swipes", push: ["deck", { deck: "idea" }] },
  { title: "Мэтчи", sub: "что понравилось обоим", words: "мэтч совпадения понравилось обоим", tab: "swipes", push: ["matches", { deck: "movie" }] },
  // Тесты: новые — только в бете (пара владельца, 08.10.2026), у остальных — старые, как до 08.10
  { title: "Тесты на совместимость", sub: "угадай меня, свидание, деньги, будущее", words: "тест совместимость угадай меня свидание приятно языки любви деньги быт жить вместе будущее ссоры ревность телефон друзья знаешь шпаргалка", tab: "swipes", push: ["tests"], module: "tests", beta: true },
  { title: "Тесты на совместимость", sub: "языки любви, деньги, быт, будущее", words: "тест совместимость языки любви деньги быт будущее знаешь", tab: "swipes", push: ["tests"], module: "tests", beta: false },
  { title: "Хотелки", sub: "подарки, копилки, планы", words: "хотелки подарок желание вишлист копилка план поездка", tab: "wishes" },
  { title: "Дела", sub: "общий список с «Беру»", words: "дела задачи список покупки todo беру", tab: "more", push: ["tasks"], module: "tasks" },
  { title: "Вопрос дня", sub: "один вопрос на двоих", words: "вопрос дня ответ реакция", tab: "more", push: ["daily"], module: "daily" },
  { title: "Капсулы", sub: "письма в будущее", words: "капсула письмо будущее сюрприз послание", tab: "more", push: ["capsules"], module: "capsules" },
  { title: "Голосования", sub: "тайные, до ответа обоих", words: "голосование опрос выбор решить", tab: "more", push: ["votes"], module: "votes" },
  { title: "Карты", sub: "скидочные на двоих", words: "карты скидки лояльность магазин штрихкод", tab: "more", push: ["cards"], module: "cards" },
  { title: "Заметки", sub: "общий блокнот", words: "заметки записки блокнот", tab: "more", push: ["notes"], module: "notes" },
  { title: "Что надеть", sub: "гардероб и парные луки", words: "одежда гардероб лук образ надеть вещи", tab: "more", push: ["wardrobe"], module: "wardrobe" },
  { title: "Цели", sub: "к чему идём вместе", words: "цели цель отметки прогресс", tab: "more", push: ["goals"], module: "goals" },
  { title: "Настройки", sub: "профиль, разделы, напоминания", words: "настройки профиль имя цвет тема уведомления напоминания разделы удалить аккаунт", tab: "more", push: ["settings"] },
  { title: "Написать отзыв", sub: "что исправить или добавить", words: "отзыв ошибка баг идея предложить пожаловаться", tab: "more", action: () => store.feedback("Поиск") },
  { title: "Вдвоём+", sub: "всё без ограничений", words: "плюс подписка оплата премиум", tab: "more", push: ["plus"], plus: true },
  { title: "Админка", sub: "новые люди, действия, отзывы", words: "админка админ пользователи блокировка", tab: "more", push: ["admin"], admin: true },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export function SearchButton() {
  return (
    <button className="icon-btn" aria-label="Поиск" onClick={() => { haptic.select(); store.search(true); }}>
      <Search size={19} />
    </button>
  );
}

export function SearchSheet() {
  const open = useStore((s) => s.search);
  const { shown, data, beta } = useMe();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return PLACES.filter((p) => (!p.module || shown(p.module)) && (!p.admin || data?.isAdmin) && (!p.plus || data?.plusOn) && (p.beta === undefined || p.beta === beta)).filter((p) => {
      const hay = norm(`${p.title} ${p.sub} ${p.words}`);
      return words.every((w) => hay.includes(w));
    });
  }, [q, shown, data, beta]);
  const close = () => { store.search(false); setQ(""); };
  const go = (p: Place) => {
    haptic.select();
    close();
    if (p.action) return p.action();
    nav.tab(p.tab);
    if (p.push) nav.push(p.push[0], p.push[1]);
  };
  return (
    <Sheet open={open} onClose={close} title="Найти">
      <input
        className="input"
        autoFocus
        type="search"
        enterKeyHint="go"
        placeholder="Например: письмо, лук, когда свободны"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && list[0] && go(list[0])}
        aria-label="Что найти"
      />
      <div className="stack" style={{ marginTop: 12, gap: 8 }}>
        {list.map((p) => (
          <button key={p.title} className="card tap row" style={{ width: "100%", textAlign: "left", margin: 0 }} onClick={() => go(p)}>
            <div className="grow">
              <div style={{ fontWeight: 700 }}>{p.title}</div>
              <div className="small muted">{p.sub}</div>
            </div>
            <ChevronRight size={18} className="faint" />
          </button>
        ))}
        {!list.length && <p className="small muted center">Ничего не нашлось. Попробуй другое слово — или напиши, чего не хватает, через «Отзыв».</p>}
      </div>
    </Sheet>
  );
}
