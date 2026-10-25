// Отзывы закрытого теста (27.09.2026): кнопка «Отзыв» на главных экранах и
// шторка, где можно пожаловаться, предложить, попросить убрать лишнее, ругать
// дизайн и присылать ошибки со скриншотами. Сообщение приходит владельцу в
// телеграм, его ответ бот пересылает автору.
import { ImagePlus, MessageCircleHeart, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { upload } from "../api.ts";
import { shrink } from "../media.ts";
import { store, useStore } from "../store.ts";
import { haptic, tg } from "../tg.ts";
import { Sheet } from "../ui/kit.tsx";

const KINDS = [
  { key: "dislike", label: "😣 Не нравится", hint: "Что бесит или неудобно? Например: «долго искать, где поставить настроение»" },
  { key: "add", label: "✨ Добавить", hint: "Чего не хватает? Какой раздел, кнопку или функцию стоит добавить?" },
  { key: "remove", label: "🗑 Убрать", hint: "Что лишнее и только мешает? Какой раздел или плашку убрать?" },
  { key: "design", label: "🎨 Дизайн", hint: "Какой экран и что в нём некрасиво: цвета, шрифты, отступы, иконки. Скриншот очень поможет" },
  { key: "bug", label: "🐞 Ошибка", hint: "Что сломалось и что было перед этим? Приложи скриншот" },
] as const;

/**
 * Плавающая кнопка «Отзыв» была над нижним меню на всех вкладках, кроме свайпов,
 * и лежала поверх живых кнопок: «Поставить» в целях, «По часам» в календаре
 * (тест 11.10.2026). С 11.10.2026 её нет: отзыв пишут из «Ещё» — там это первая
 * строка («Написать отзыв»), шторка та же. Компонент оставлен, чтобы App.tsx
 * не ломался; вернуть кнопку можно, сняв `if (!FAB) return null`.
 */
const FAB = false;
export function FeedbackButton({ screen }: { screen: string }) {
  if (!FAB) return null;
  return (
    <button className="feedback-fab" onClick={() => { haptic.select(); store.feedback(screen); }}>
      <MessageCircleHeart size={18} /> Отзыв
    </button>
  );
}

export function FeedbackSheet() {
  const open = useStore((s) => s.feedback);
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("dislike");
  const [text, setText] = useState("");
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const close = () => store.feedback(null);

  // Превью скриншотов — object URL, их надо отпускать
  useEffect(() => () => shots.forEach((s) => URL.revokeObjectURL(s.url)), [shots]);

  function addShots(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).slice(0, 3 - shots.length).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setShots((s) => [...s, ...next]);
  }

  async function send() {
    if (text.trim().length < 3) return store.toast("Напиши хотя бы пару слов");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("text", text.trim());
      form.append("screen", open?.screen ?? "");
      form.append("platform", `${tg?.platform ?? "браузер"} ${tg?.version ?? ""} · ${innerWidth}×${innerHeight}`.replace(/\s+/g, " "));
      // Caddy пускает тело до 2 МБ: три скриншота по ~600 КБ в него влезают
      for (const s of shots) form.append("file", (await shrink(s.file, 1400, 600_000)).blob, "shot.jpg");
      await upload("/feedback", form);
      haptic.success();
      store.toast("Спасибо! Прочитаем и ответим в чате с ботом 💞");
      setText("");
      setShots([]);
      close();
    } catch (e) {
      store.toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const k = KINDS.find((x) => x.key === kind)!;
  return (
    <Sheet open={!!open} onClose={close} title="Что исправить?">
      <p className="small muted" style={{ marginTop: -8, lineHeight: 1.45 }}>
        «Вдвоём» сейчас в закрытом тесте. Пиши всё: что бесит, чего не хватает, что убрать, что некрасиво. Читаем каждое сообщение и отвечаем в чате с ботом.
      </p>
      <div className="pills" style={{ flexWrap: "wrap", margin: "4px 0 12px" }} role="radiogroup" aria-label="О чём отзыв">
        {KINDS.map((x) => (
          <button key={x.key} className={`pill${kind === x.key ? " on" : ""}`} role="radio" aria-checked={kind === x.key} onClick={() => { haptic.select(); setKind(x.key); }}>
            {x.label}
          </button>
        ))}
      </div>
      <textarea className="input" rows={5} placeholder={k.hint} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} aria-label="Текст отзыва" />
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {shots.map((s, i) => (
          <div key={s.url} className="feedback-shot">
            <img src={s.url} alt={`Скриншот ${i + 1}`} />
            <button aria-label="Убрать скриншот" onClick={() => setShots((all) => all.filter((x) => x !== s))}><X size={14} /></button>
          </div>
        ))}
        {shots.length < 3 && (
          <button className="pill" onClick={() => pickRef.current?.click()}>
            <ImagePlus size={16} /> Скриншот
          </button>
        )}
        <input ref={pickRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addShots(e.target.files); e.target.value = ""; }} aria-label="Прикрепить скриншот" />
      </div>
      <button className="btn" style={{ marginTop: 14 }} disabled={busy || text.trim().length < 3} onClick={send}>
        {busy ? "Отправляю…" : "Отправить"}
      </button>
    </Sheet>
  );
}
