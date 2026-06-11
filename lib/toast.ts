export type ToastKind = 'success' | 'error' | 'warning';

/** Dispara um toast global (ouvido pelo <Toaster/>). Porta do toast() do legado. */
export function toast(message: string, kind: ToastKind = 'success') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('gp:toast', { detail: { message, kind } }));
}
