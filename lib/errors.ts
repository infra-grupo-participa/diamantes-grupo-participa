/**
 * Extrai uma mensagem legível de qualquer erro. Cobre Error nativo, PostgrestError
 * e AuthError do Supabase (objetos lisos com `.message` — NÃO são `instanceof Error`,
 * por isso `String(e)` virava "[object Object]"), strings e fallback.
 */
export function errMessage(e: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  if (!e) return fallback;
  if (typeof e === 'string') return e.trim() || fallback;
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    for (const k of ['message', 'error_description', 'msg', 'hint', 'details', 'error'] as const) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  return fallback;
}
