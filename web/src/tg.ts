// Всё общение с телеграмом в одном месте. Вне телеграма (обычный браузер
// при разработке) методы молча ничего не делают, а вход идёт dev-заголовком.

/* eslint-disable @typescript-eslint/no-explicit-any */
type WebApp = any;

declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;
export const inTelegram = !!tg?.initData;

const params = new URLSearchParams(location.search);

/** В браузере ?dev=1 и ?dev=2 — два разных тестовых человека в двух вкладках. */
function devUser(): { id: number; name: string } {
  const fromUrl = params.get("dev");
  if (fromUrl) {
    try {
      sessionStorage.setItem("dev", fromUrl);
    } catch {
      /* приватный режим */
    }
  }
  let id = fromUrl;
  try {
    id ??= sessionStorage.getItem("dev");
  } catch {
    /* ничего */
  }
  const n = Number(id ?? 1) || 1;
  return { id: n, name: n === 1 ? "Миша" : n === 2 ? "Алина" : `Тест ${n}` };
}

export function authHeader(): string {
  if (inTelegram) return `tma ${tg.initData}`;
  const u = devUser();
  // ?startapp=… в браузере уходит на сервер, как start_param в initData телеграма:
  // так локально и в e2e проверяется источник прихода (b_<код> блогера)
  const sp = params.get("startapp");
  return `dev ${u.id}:${encodeURIComponent(u.name)}${sp ? `:${encodeURIComponent(sp)}` : ""}`;
}

export function startParam(): string | null {
  return tg?.initDataUnsafe?.start_param ?? params.get("startapp");
}

/** Экран, на который ведёт кнопка из сообщения бота: ?go=movies */
export function goParam(): string | null {
  return params.get("go");
}

/** ?promo=0 — не показывать «Вдвоём+» при входе (тесты), ?promo=1 — показать сразу (показ в окне). */
export function promoParam(): string | null {
  return params.get("promo");
}

export function isVersion(v: string): boolean {
  return !!tg?.isVersionAtLeast?.(v);
}

export const haptic = {
  light: () => tg?.HapticFeedback?.impactOccurred?.("light"),
  medium: () => tg?.HapticFeedback?.impactOccurred?.("medium"),
  heavy: () => tg?.HapticFeedback?.impactOccurred?.("heavy"),
  select: () => tg?.HapticFeedback?.selectionChanged?.(),
  success: () => tg?.HapticFeedback?.notificationOccurred?.("success"),
  error: () => tg?.HapticFeedback?.notificationOccurred?.("error"),
};

export function openLink(url: string): void {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

/**
 * Сохранить файл на телефон. В Telegram 8.0+ — системное окно загрузки
 * (WebApp.downloadFile), в старых версиях и в браузере — обычная ссылка-загрузка.
 */
export function downloadFile(url: string, fileName: string): void {
  const abs = new URL(url, location.href).href;
  if (tg?.downloadFile && isVersion("8.0")) {
    tg.downloadFile({ url: abs, file_name: fileName });
    return;
  }
  const a = document.createElement("a");
  a.href = abs;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Счёт в звёздах внутри телеграма. Ответ — как закончилась оплата. */
export function openInvoice(url: string): Promise<"paid" | "cancelled" | "failed" | "pending"> {
  return new Promise((resolve) => {
    if (!inTelegram || !tg?.openInvoice || !isVersion("6.1")) return resolve("failed");
    tg.openInvoice(url, (status: "paid" | "cancelled" | "failed" | "pending") => resolve(status));
  });
}

export function openTelegramLink(url: string): void {
  if (inTelegram && tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export function shareLink(url: string, text: string): void {
  openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

export function colorScheme(): "light" | "dark" {
  if (tg?.colorScheme) return tg.colorScheme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function paintChrome(bg: string): void {
  if (!inTelegram) return;
  try {
    tg.setHeaderColor?.(bg);
    tg.setBackgroundColor?.(bg);
    if (isVersion("7.10")) tg.setBottomBarColor?.(bg);
  } catch {
    /* старый клиент */
  }
}

let backHandler: (() => void) | null = null;
export function setBackButton(onBack: (() => void) | null): void {
  if (!tg?.BackButton) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = onBack;
  if (onBack) {
    tg.BackButton.onClick(onBack);
    tg.BackButton.show();
  } else tg.BackButton.hide();
}

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (inTelegram && tg?.showConfirm && isVersion("6.2")) tg.showConfirm(message, (ok: boolean) => resolve(ok));
    else resolve(window.confirm(message));
  });
}

export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!inTelegram || !tg?.requestWriteAccess || !isVersion("6.9")) return resolve(false);
    tg.requestWriteAccess((ok: boolean) => resolve(ok));
  });
}

/**
 * На айфоне встроенный способ открывает страницу t.me, чей значок лежит на CDN
 * телеграма, а из России он не грузится — на экране появляется буква «В».
 * Поэтому там открываем в Safari свою страницу /na-ekran со своим значком
 * (openLink на iOS всегда уходит во внешний браузер). Андроид рисует значок
 * из аватарки, скачанной самим телеграмом, — ему хватает встроенного способа.
 */
export const isIOS = () => tg?.platform === "ios";

export function addToHomeScreen(): boolean {
  if (!inTelegram) return false;
  if (isIOS()) {
    openLink(`${location.origin}/na-ekran`);
    return true;
  }
  if (!isVersion("8.0")) return false;
  tg.addToHomeScreen();
  return true;
}

export type HomeStatus = "unsupported" | "unknown" | "added" | "missed";

/**
 * Стоит ли уже «Вдвоём» на экране «Домой». Десктоп и телеграм старше 8.0 не
 * умеют — unsupported; айфон часто не знает ответа — unknown.
 */
export function homeScreenStatus(): Promise<HomeStatus> {
  return new Promise((resolve) => {
    if (inTelegram && isIOS()) return resolve("unknown"); // свой способ, проверить нечем
    if (!inTelegram || !isVersion("8.0") || !tg?.checkHomeScreenStatus) return resolve("unsupported");
    const t = setTimeout(() => resolve("unknown"), 1500);
    try {
      tg.checkHomeScreenStatus((st: HomeStatus) => {
        clearTimeout(t);
        resolve(st);
      });
    } catch {
      clearTimeout(t);
      resolve("unsupported");
    }
  });
}

export function onHomeScreenAdded(fn: () => void): () => void {
  if (!tg?.onEvent) return () => {};
  tg.onEvent("homeScreenAdded", fn);
  return () => tg.offEvent?.("homeScreenAdded", fn);
}

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
  tg.expand?.();
  // Свайп вниз по колоде не должен сворачивать приложение
  if (isVersion("7.7")) tg.disableVerticalSwipes?.();
  // На телефоне — во весь экран, как «Между строк» (27.09.2026). Кнопки телеграма
  // «Закрыть» и «⋯» тогда лежат поверх приложения: отступ сверху даёт --safe-top.
  // На компьютере полный экран растянул бы окно на весь монитор — там не просим.
  if (isVersion("8.0") && (tg.platform === "ios" || tg.platform === "android")) tg.requestFullscreen?.();
}

export function tgUserPhoto(): string | null {
  return tg?.initDataUnsafe?.user?.photo_url ?? null;
}
