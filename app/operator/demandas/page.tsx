import { Suspense } from 'react';
import OperatorDemandas from '@/components/operator/OperatorDemandas';

export const metadata = { title: 'Demandas — Operador Diamantes' };

export default function OperatorDemandasPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--muted)' }}>Carregando…</div>}>
      <OperatorDemandas />
    </Suspense>
  );
}
