// Отзывы закрытого теста: что не нравится, что добавить или убрать, дизайн, ошибки.

export const FEEDBACK_KINDS = {
  dislike: "😣 Не нравится",
  add: "✨ Добавить",
  remove: "🗑 Убрать",
  design: "🎨 Дизайн",
  bug: "🐞 Ошибка",
} as const;

export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

export interface FeedbackRow {
  id: number;
  user_id: number;
  pair_id: number | null;
  kind: FeedbackKind;
  text: string;
  screen: string | null;
  platform: string | null;
  photos: string | null;
  tg_message: number | null;
  reply: string | null;
  created_at: string;
  /** Отзыв учтён: когда и что сделано (ставит Claude после правки) */
  done_at?: string | null;
  done_note?: string | null;
}

/** Сколько отзывов в сутки принимаем от одного человека: защита от залипшей кнопки и спама. */
export const FEEDBACK_PER_DAY = 30;
