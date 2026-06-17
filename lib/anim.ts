// Helper de animação: respeita a preferência do sistema por menos movimento.
// Usado pelos componentes de UI animados (CountUp, AnimatedBar, charts) para
// não animar quando o usuário desativou animações no SO.
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
