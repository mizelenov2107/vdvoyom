import { Component, type ReactNode } from "react";

/** Ошибка в одном экране не гасит всё приложение: показываем заглушку с перезапуском. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("экран упал", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" style={{ paddingTop: 80 }}>
        <div className="emoji" style={{ fontSize: 44 }}>🫠</div>
        <div className="title-md" style={{ color: "var(--text)" }}>Что-то пошло не так</div>
        <p className="small" style={{ margin: "6px auto 16px", maxWidth: 280 }}>
          Экран не открылся. Обычно помогает перезапуск — данные никуда не денутся.
        </p>
        <button className="btn inline" onClick={() => location.reload()}>Перезапустить</button>
      </div>
    );
  }
}
