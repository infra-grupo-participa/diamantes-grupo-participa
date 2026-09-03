'use client';

// Aviso de drift repo×banco — renderiza em /admin quando o schema esperado pelo
// código está à frente do banco real (migration não aplicada ainda). Não comunica
// só por cor: ícone + texto + lista nominal do que falta (a11y).
//
// Falha de rede/RPC ausente não deve assustar o admin com um card de erro: some
// (ver getSchemaDriftStatus) — só aparece quando HÁ algo para agir.

import { useEffect, useState } from 'react';
import { getSchemaDriftStatus, type SchemaDriftStatus } from '@/lib/api/admin-drift';
import styles from '@/app/admin/demandas/demandas.module.css';

export default function DriftBanner() {
  const [status, setStatus] = useState<SchemaDriftStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSchemaDriftStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        /* checagem de drift é best-effort — não bloqueia a tela por isto */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || status.ok) return null;

  return (
    <div className={styles.driftBanner} role="status">
      <span className={styles.driftIcon} aria-hidden="true">⚠</span>
      <div>
        <strong>Banco atrás do repositório.</strong> Alguma migration ainda não foi aplicada.
        {status.missing_columns.length > 0 && (
          <ul className={styles.driftList}>
            {status.missing_columns.map((m) => (
              <li key={`${m.table}.${m.column}`}>
                Coluna faltando: <code>{m.table}.{m.column}</code>
              </li>
            ))}
          </ul>
        )}
        {status.missing_config_keys.length > 0 && (
          <ul className={styles.driftList}>
            {status.missing_config_keys.map((k) => (
              <li key={k}>Configuração faltando: <code>{k}</code></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
