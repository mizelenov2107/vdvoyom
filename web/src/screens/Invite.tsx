import { Copy, QrCode, Send, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useMe } from "../data.ts";
import { haptic, shareLink } from "../tg.ts";
import { store } from "../store.ts";
import { Sheet } from "../ui/kit.tsx";
import { Art } from "../ui/Art.tsx";
import { GhostSheet } from "./Sheets.tsx";

export const INVITE_TEXT = "Давай вести наши планы, хотелки и свидания вместе — в «Вдвоём» 💞";

/**
 * Приглашение половинки: ссылкой в чат, копией или QR-кодом, если вы рядом.
 * onShared — ссылку отправили, скопировали или показали QR: онбординг меняет
 * «Позову позже» на следующий шаг (тест 11.10.2026).
 */
export function InvitePanel({ compact = false, withGhost = true, onShared }: { compact?: boolean; withGhost?: boolean; onShared?: () => void }) {
  const { pair, partner } = useMe();
  const [qr, setQr] = useState(false);
  const [ghost, setGhost] = useState(false);
  if (!pair) return null;
  return (
    <>
      {!compact && <Art name="invite" size={220} />}
      <div className="stack" style={{ marginTop: compact ? 0 : 12 }}>
        <button className="btn" onClick={() => { haptic.light(); shareLink(pair.invite, INVITE_TEXT); onShared?.(); }}>
          <Send size={18} /> Отправить ссылку в Телеграм
        </button>
        <div className="grid-2">
          <button
            className="btn soft"
            onClick={() => { onShared?.(); void navigator.clipboard?.writeText(pair.invite).then(() => store.toast("Ссылка скопирована"), () => store.toast(pair.invite)); }}
          >
            <Copy size={17} /> Копировать
          </button>
          <button className="btn soft" onClick={() => { setQr(true); onShared?.(); }}>
            <QrCode size={17} /> QR-код
          </button>
        </div>
        {withGhost && !partner && (
          <button className="btn soft" onClick={() => setGhost(true)}>
            <UserPlus size={17} /> Внести половинку заранее
          </button>
        )}
      </div>
      {withGhost && !partner && (
        <p className="small muted center" style={{ margin: "10px 0 0" }}>
          «Заранее» — если хочется сразу увидеть общие окна: имя и расписание половинки можно внести за неё, при входе всё перейдёт ей.
        </p>
      )}
      <QrSheet open={qr} url={pair.invite} onClose={() => setQr(false)} />
      <GhostSheet open={ghost} onClose={() => setGhost(false)} />
    </>
  );
}

function QrSheet({ open, url, onClose }: { open: boolean; url: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (open && canvas.current) void QRCode.toCanvas(canvas.current, url, { width: 260, margin: 1, color: { dark: "#1d1520", light: "#ffffff" } });
  }, [open, url]);
  return (
    <Sheet open={open} onClose={onClose} title="Наведи камеру">
      <div className="center" style={{ background: "#fff", borderRadius: 24, padding: 20, margin: "0 auto", width: "fit-content" }}>
        <canvas ref={canvas} />
      </div>
      <p className="small muted center">Половинка наводит камеру телефона — откроется бот, и вы окажетесь в одном пространстве.</p>
    </Sheet>
  );
}

/** Честно и без юридического тумана: что хранится, где и как удалить. */
export function DataSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Как мы храним данные">
      <div className="stack small" style={{ lineHeight: 1.55 }}>
        <p style={{ margin: 0 }}>
          <b>Что хранится.</b> Имя и фото профиля из Телеграма, то, что вы сами добавили: день рождения, расписание, события, задачи, хотелки, копилки,
          ответы на вопросы и тесты, фото. Пароли не нужны — вход подтверждает сам Телеграм.
        </p>
        <p style={{ margin: 0 }}>
          <b>Где.</b> На сервере в России (Санкт-Петербург). Данные не продаются и не передаются рекламным сетям, аналитики и трекеров в приложении нет.
        </p>
        <p style={{ margin: 0 }}>
          <b>Кто видит.</b> Только вы двое: каждый запрос проверяется на сервере, чужое пространство открыть нельзя. Фото отдаются по подписанным ссылкам.
        </p>
        <p style={{ margin: 0 }}>
          <b>Как удалить.</b> Настройки → «Удалить аккаунт». Личное стирается сразу. Если в пространстве больше никого нет, стирается и оно целиком.
        </p>
        <p style={{ margin: 0 }}>
          <b>Копии.</b> Ночная резервная копия базы хранится 14 дней и затем удаляется.
        </p>
      </div>
    </Sheet>
  );
}
