'use client';

// Barra de progresso que preenche de 0 → pct ao montar (GSAP). Respeita reduced-motion.
// Pode usar estilo inline (color/track) OU classes existentes (fillClassName/trackClassName)
// para preservar o visual já consolidado das telas.
import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { prefersReducedMotion } from '@/lib/anim';

export default function AnimatedBar({
  pct,
  color,
  track,
  height = 8,
  rounded = true,
  delay = 0,
  fillClassName,
  trackClassName,
}: {
  pct: number;
  color?: string;
  track?: string;
  height?: number;
  rounded?: boolean;
  delay?: number;
  fillClassName?: string;
  trackClassName?: string;
}) {
  const fillRef = useRef<HTMLDivElement>(null);
  const target = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.width = `${target}%`;
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { width: '0%' }, { width: `${target}%`, duration: 0.9, ease: 'power3.out', delay });
    });
    return () => ctx.revert();
  }, [target, delay]);

  const trackStyle: React.CSSProperties = trackClassName
    ? {}
    : { width: '100%', height, background: track || 'var(--border-strong)', borderRadius: rounded ? 999 : 0, overflow: 'hidden' };
  const fillStyle: React.CSSProperties = fillClassName
    ? { width: `${target}%`, ...(color ? { background: color } : {}) }
    : { width: `${target}%`, height: '100%', background: color || 'var(--accent)', borderRadius: rounded ? 999 : 0 };

  return (
    <div className={trackClassName} style={trackStyle}>
      <div ref={fillRef} className={fillClassName} style={fillStyle} />
    </div>
  );
}
