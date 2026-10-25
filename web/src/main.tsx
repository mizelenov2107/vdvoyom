import { StrictMode } from "react";
import { MotionGlobalConfig } from "motion/react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api.ts";
import { initTelegram, tg } from "./tg.ts";
import { App } from "./App.tsx";
import { applyTheme } from "./design.ts";
import "./styles.css";
import "./soft.css";

initTelegram();

// ?still=1 — без анимаций: для снимков экрана в фоновой вкладке, где кадры не идут
if (new URLSearchParams(location.search).has("still")) MotionGlobalConfig.skipAnimations = true;
// ?dev — для ручной проверки подбора: функции гардероба доступны из консоли
if (new URLSearchParams(location.search).has("dev")) void import("./style.ts").then((m) => ((window as unknown as Record<string, unknown>).__style = m));

applyTheme();
tg?.onEvent?.("themeChanged", applyTheme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
