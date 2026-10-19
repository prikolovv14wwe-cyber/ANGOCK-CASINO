// Минимальные типы для window.Telegram.WebApp
interface TgWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  openInvoice(url: string, cb?: (status: "paid" | "cancelled" | "failed" | "pending") => void): void;
  showAlert(msg: string): void;
  HapticFeedback?: { notificationOccurred(t: "success" | "error" | "warning"): void; impactOccurred(s: "light" | "medium"): void };
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}
interface Window { Telegram?: { WebApp: TgWebApp } }
