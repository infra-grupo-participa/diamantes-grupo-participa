'use client';

import { useEffect, useState } from 'react';
import type { ToastKind } from '@/lib/toast';

type Item = { id: number; message: string; kind: ToastKind };

export default function Toaster() {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let seq = 0;
    function onToast(e: Event) {
      const detail = (e as CustomEvent).detail as { message: string; kind: ToastKind };
      const id = ++seq;
      setItems((prev) => [...prev, { id, message: detail.message, kind: detail.kind || 'success' }]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3800);
    }
    window.addEventListener('gp:toast', onToast);
    return () => window.removeEventListener('gp:toast', onToast);
  }, []);

  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={`toast toast-${i.kind}`}>
          {i.message}
        </div>
      ))}
    </div>
  );
}
