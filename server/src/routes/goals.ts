// Совместные цели: набрать число, пройти шаги, привычка N раз в неделю.
import { all, get, run, tx } from "../db.ts";
import { needPlus } from "../limits.ts";
import { bad, int, needPair, oneOf, optDate, optStr, router, str } from "../http.ts";
import { displayName } from "../model.ts";
import { changed } from "../realtime.ts";
import { esc, notifyPartner } from "../bot.ts";
import { addDays, mskNow, today } from "../time.ts";

export const goals = router();

const KINDS = ["count", "checklist", "habit"] as const;
const AUTO = ["ideas_done", "movies_done", "wishes_done", "dates"] as const;

interface GoalRow {
  id: number;
  pair_id: number;
  author_id: number;
  kind: (typeof KINDS)[number];
  title: string;
  emoji: string | null;
  target: number | null;
  unit: string | null;
  due: string | null;
  auto: string | null;
  archived_at: string | null;
  created_at: string;
}

/** Понедельник текущей недели по Москве. */
function weekStart(): string {
  const { date, weekday } = mskNow();
  return addDays(date, 1 - weekday);
}

/** Сколько набрано у цели, которая считается сама, с момента её создания. */
function autoProgress(g: GoalRow): number {
  const since = g.created_at.slice(0, 10);
  const n = (sql: string) => get<{ n: number }>(sql, g.pair_id, since)!.n;
  if (g.auto === "ideas_done") return n("SELECT COUNT(*) AS n FROM matches WHERE pair_id = ? AND deck = 'idea' AND status = 'done' AND done_on >= ?");
  if (g.auto === "movies_done") return n("SELECT COUNT(*) AS n FROM matches WHERE pair_id = ? AND deck = 'movie' AND status = 'done' AND done_on >= ?");
  if (g.auto === "wishes_done") return n("SELECT COUNT(*) AS n FROM wishes WHERE pair_id = ? AND done_at >= ?");
  if (g.auto === "dates") return n("SELECT COUNT(*) AS n FROM events WHERE pair_id = ? AND kind = 'date' AND COALESCE(status, 'accepted') = 'accepted' AND date >= ? AND date <= date('now')");
  return 0;
}

export function goalsOf(pairId: number) {
  const rows = all<GoalRow>("SELECT * FROM goals WHERE pair_id = ? ORDER BY archived_at IS NOT NULL, id DESC", pairId);
  const ws = weekStart();
  return rows.map((g) => {
    const marks = all<{ id: number; user_id: number; amount: number; note: string | null; date: string }>(
      "SELECT id, user_id, amount, note, date FROM goal_marks WHERE goal_id = ? ORDER BY date DESC, id DESC",
      g.id,
    );
    const steps = g.kind === "checklist" ? all("SELECT * FROM goal_steps WHERE goal_id = ? ORDER BY pos, id", g.id) : [];
    const byUser: Record<number, number> = {};
    const scope = g.kind === "habit" ? marks.filter((m) => m.date >= ws) : marks;
    for (const m of scope) byUser[m.user_id] = (byUser[m.user_id] ?? 0) + m.amount;
    let progress = scope.reduce((s, m) => s + m.amount, 0);
    if (g.auto) progress += autoProgress(g);
    if (g.kind === "checklist") progress = (steps as { done_at: string | null }[]).filter((s) => s.done_at).length;
    const target = g.kind === "checklist" ? steps.length : g.target ?? 0;
    // Серия привычки: сколько недель подряд (включая прошлую) норма выполнялась
    let streak = 0;
    if (g.kind === "habit" && g.target) {
      for (let w = 1; w < 60; w++) {
        const from = addDays(ws, -7 * w);
        const to = addDays(ws, -7 * (w - 1));
        const done = marks.filter((m) => m.date >= from && m.date < to).reduce((s, m) => s + m.amount, 0);
        if (done >= g.target) streak++;
        else break;
      }
      if (progress >= g.target) streak++;
    }
    return { ...g, marks: marks.slice(0, 30), steps, byUser, progress, target, streak, done: target > 0 && progress >= target };
  });
}

goals.get("/goals", (c) => c.json({ goals: goalsOf(needPair(c.get("user"))) }));

goals.post("/goals", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  needPlus(pairId, "goals", get<{ n: number }>("SELECT COUNT(*) n FROM goals WHERE pair_id = ? AND archived_at IS NULL", pairId)!.n);
  const b = await c.req.json<Record<string, unknown>>();
  const kind = oneOf(b.kind, KINDS, "count");
  const title = str(b.title, 120);
  const id = tx(() => {
    const { id } = run(
      "INSERT INTO goals (pair_id, author_id, kind, title, emoji, target, unit, due, auto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      pairId, u.id, kind, title, optStr(b.emoji, 8), kind === "checklist" ? null : int(b.target ?? 1, 1, 100000),
      optStr(b.unit, 30), optDate(b.due), b.auto ? oneOf(b.auto, AUTO) : null,
    );
    const steps = Array.isArray(b.steps) ? (b.steps as unknown[]).map((x) => str(x, 200, false)).filter(Boolean).slice(0, 50) : [];
    steps.forEach((t, i) => run("INSERT INTO goal_steps (goal_id, text, pos) VALUES (?, ?, ?)", id, t, i));
    return id;
  });
  changed(pairId, "goals");
  void notifyPartner(u, `🎯 ${esc(displayName(u))} ставит общую цель: <b>${esc(title)}</b>`, { button: { text: "Цели", go: "goals" }, quietIfOnline: true });
  return c.json({ id });
});

function goalOf(pairId: number, id: number): GoalRow {
  const g = get<GoalRow>("SELECT * FROM goals WHERE id = ? AND pair_id = ?", id, pairId);
  if (!g) bad("Нет цели", 404);
  return g!;
}

async function celebrateIfDone(pairId: number, goalId: number, u: Parameters<typeof notifyPartner>[0]) {
  const g = goalsOf(pairId).find((x) => x.id === goalId);
  if (!g || !g.done || g.kind === "habit") return;
  const key = `goal-done:${goalId}`;
  if (run("INSERT OR IGNORE INTO sent (key) VALUES (?)", key).changes === 0) return;
  await notifyPartner(u, `🎉 Цель достигнута: <b>${esc(g.title)}</b>. Вы молодцы!`, { button: { text: "Цели", go: "goals" } });
}

goals.patch("/goals/:id", async (c) => {
  const pairId = needPair(c.get("user"));
  const g = goalOf(pairId, Number(c.req.param("id")));
  const b = await c.req.json<Record<string, unknown>>();
  if (b.action === "archive") run("UPDATE goals SET archived_at = ? WHERE id = ?", today(), g.id);
  else if (b.action === "unarchive") run("UPDATE goals SET archived_at = NULL WHERE id = ?", g.id);
  else {
    run(
      "UPDATE goals SET title = ?, emoji = ?, target = ?, unit = ?, due = ? WHERE id = ?",
      str(b.title ?? g.title, 120), optStr(b.emoji ?? g.emoji, 8),
      g.kind === "checklist" ? null : int(b.target ?? g.target ?? 1, 1, 100000), optStr(b.unit ?? g.unit, 30),
      "due" in b ? optDate(b.due) : g.due, g.id,
    );
  }
  changed(pairId, "goals");
  return c.json({ ok: true });
});

goals.delete("/goals/:id", (c) => {
  const pairId = needPair(c.get("user"));
  const g = goalOf(pairId, Number(c.req.param("id")));
  tx(() => {
    run("DELETE FROM goal_marks WHERE goal_id = ?", g.id);
    run("DELETE FROM goal_steps WHERE goal_id = ?", g.id);
    run("DELETE FROM goals WHERE id = ?", g.id);
  });
  changed(pairId, "goals");
  return c.json({ ok: true });
});

goals.post("/goals/:id/marks", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const g = goalOf(pairId, Number(c.req.param("id")));
  if (g.kind === "checklist") bad("У чек-листа отмечаются шаги");
  const b = await c.req.json<Record<string, unknown>>();
  const amount = int(b.amount ?? 1, -100000, 100000);
  if (!amount) bad("Ноль не считается");
  run("INSERT INTO goal_marks (goal_id, user_id, amount, note, date) VALUES (?, ?, ?, ?, ?)", g.id, u.id, amount, optStr(b.note, 200), today());
  changed(pairId, "goals");
  if (amount > 0) {
    void notifyPartner(u, `🎯 ${esc(displayName(u))}: +${amount} к цели «${esc(g.title)}»`, { quietIfOnline: true });
    void celebrateIfDone(pairId, g.id, u);
  }
  return c.json({ ok: true });
});

goals.delete("/goals/:id/marks/:mark", (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const g = goalOf(pairId, Number(c.req.param("id")));
  run("DELETE FROM goal_marks WHERE id = ? AND goal_id = ?", Number(c.req.param("mark")), g.id);
  changed(pairId, "goals");
  return c.json({ ok: true });
});

goals.post("/goals/:id/steps", async (c) => {
  const pairId = needPair(c.get("user"));
  const g = goalOf(pairId, Number(c.req.param("id")));
  const { text } = await c.req.json<{ text: string }>();
  const pos = get<{ n: number }>("SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM goal_steps WHERE goal_id = ?", g.id)!.n;
  run("INSERT INTO goal_steps (goal_id, text, pos) VALUES (?, ?, ?)", g.id, str(text, 200), pos);
  changed(pairId, "goals");
  return c.json({ ok: true });
});

goals.patch("/goals/:id/steps/:step", async (c) => {
  const u = c.get("user");
  const pairId = needPair(u);
  const g = goalOf(pairId, Number(c.req.param("id")));
  const { done } = await c.req.json<{ done: boolean }>();
  run(
    "UPDATE goal_steps SET done_by = ?, done_at = ? WHERE id = ? AND goal_id = ?",
    done ? u.id : null, done ? new Date().toISOString() : null, Number(c.req.param("step")), g.id,
  );
  changed(pairId, "goals");
  if (done) void celebrateIfDone(pairId, g.id, u);
  return c.json({ ok: true });
});

goals.delete("/goals/:id/steps/:step", (c) => {
  const pairId = needPair(c.get("user"));
  const g = goalOf(pairId, Number(c.req.param("id")));
  run("DELETE FROM goal_steps WHERE id = ? AND goal_id = ?", Number(c.req.param("step")), g.id);
  changed(pairId, "goals");
  return c.json({ ok: true });
});
