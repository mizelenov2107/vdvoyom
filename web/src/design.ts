// Оформление приложения — «мягкое» (редизайн по профилю Couple & Relationship App из
// UI UX Pro Max, с 25.09.2026 единственное). Оно живёт в soft.css под атрибутом
// data-design на <html> поверх исходных стилей styles.css; прежний облик («классика»)
// остаётся в коде и открывается только ссылкой с ?design=classic — для сравнения.
// Тема своя, не из телеграма: по умолчанию светлая, тёмная и «как в телеграме» — по выбору
// в настройках (?theme=dark|light|auto в адресе — для снимков).

import { colorScheme, paintChrome } from "./tg.ts";

export type Design = "classic" | "soft";

const THEME_KEY = "vdvoyom:theme";

export type ThemePref = "light" | "dark" | "auto";

/** Цвет шапки и фона телеграма под каждое оформление и тему. */
export const CHROME: Record<Design, Record<"light" | "dark", string>> = {
  classic: { light: "#fbf6f2", dark: "#0f0b13" },
  soft: { light: "#fbf3f1", dark: "#171113" },
};

/** Мягкое всегда; классика — только по ссылке с ?design=classic. */
export function currentDesign(): Design {
  return new URLSearchParams(location.search).get("design") === "classic" ? "classic" : "soft";
}

function validTheme(v: string | null): v is ThemePref {
  return v === "light" || v === "dark" || v === "auto";
}

export function currentThemePref(): ThemePref {
  const fromUrl = new URLSearchParams(location.search).get("theme");
  if (validTheme(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (validTheme(saved)) return saved;
  } catch {
    /* хранилище недоступно — светлая */
  }
  return "light";
}

/** Какая тема на экране сейчас: выбранная или, при «как в телеграме», тема телеграма. */
export function resolvedScheme(): "light" | "dark" {
  const pref = currentThemePref();
  return pref === "auto" ? colorScheme() : pref;
}

function dropParam(name: string): void {
  const url = new URL(location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  history.replaceState(null, "", url);
}

export function setThemePref(p: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {
    /* не запомнится, но на этот запуск включится */
  }
  dropParam("theme");
  applyTheme();
}

/** Выбранная тема и оформление — на <html> и в шапку телеграма. */
export function applyTheme(): void {
  const scheme = resolvedScheme();
  const design = currentDesign();
  document.documentElement.className = scheme;
  document.documentElement.dataset.design = design;
  paintChrome(CHROME[design][scheme]);
}
