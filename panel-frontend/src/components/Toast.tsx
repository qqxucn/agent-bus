import React from 'react';

/**
 * 简易 Toast 通知
 */
type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let toastId = 0;
let listeners: Array<(toasts: ToastItem[]) => void> = [];
let toasts: ToastItem[] = [];

function notify() {
  listeners.forEach((l) => l([...toasts]));
}

export function showToast(type: ToastType, message: string) {
  const id = ++toastId;
  toasts = [...toasts, { id, type, message }];
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 3000);
}

export function subscribeToast(listener: (toasts: ToastItem[]) => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function ToastContainer() {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    return subscribeToast(setItems);
  }, []);

  return (
    <div className="toast-container">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
