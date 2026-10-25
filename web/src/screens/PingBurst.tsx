import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { haptic } from "../tg.ts";
import { useStore } from "../store.ts";

const EMOJI: Record<string, string> = { miss: "💭", hug: "🤗", kiss: "💋", think: "✨" };
const TEXT: Record<string, string> = { miss: "скучает по тебе", hug: "обнимает тебя", kiss: "целует тебя", think: "думает о тебе" };

/** Половинка нажала «скучаю», пока ты в приложении, — большой всплеск на экране. */
export function PingBurst({ partnerName }: { partnerName: string }) {
  const ping = useStore((s) => s.ping);
  const [shown, setShown] = useState<typeof ping>(null);
  useEffect(() => {
    if (!ping) return;
    setShown(ping);
    haptic.heavy();
    const t = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(t);
  }, [ping]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.id}
          style={{ position: "fixed", inset: 0, zIndex: 85, display: "grid", placeItems: "center", pointerEvents: "none" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="center"
            initial={{ scale: 0.3, y: 40 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 14 }}
            style={{ background: "var(--glass)", backdropFilter: "blur(20px)", borderRadius: 28, padding: "26px 30px", boxShadow: "var(--shadow)" }}
          >
            <div style={{ fontSize: 76, lineHeight: 1 }}>{EMOJI[shown.kind] ?? "💌"}</div>
            <div className="title-md" style={{ marginTop: 10 }}>
              {partnerName} {TEXT[shown.kind] ?? "шлёт привет"}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
