'use client';

// Número que "conta" de 0 até o valor ao montar (GSAP). Respeita reduced-motion.
// Uso: <CountUp value={42} /> ou <CountUp value={59900} format={fmtBRL} />
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { prefersReducedMotion } from '@/lib/anim';

export default function CountUp({
  value,
  format,
  duration = 1,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString('pt-BR'));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = fmt(value);
      return;
    }
    const obj = { v: 0 };
    const ctx = gsap.context(() => {
      gsap.to(obj, {
        v: value,
        duration,
        ease: 'power2.out',
        onUpdate: () => {
          el.textContent = fmt(obj.v);
        },
      });
    });
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Render inicial (SSR/primeiro paint) já com o valor final — a animação assume no cliente.
  return (
    <span ref={ref} className={className}>
      {fmt(value)}
    </span>
  );
}
