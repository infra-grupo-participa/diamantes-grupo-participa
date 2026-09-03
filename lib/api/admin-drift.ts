// API de Drift repo×banco (admin) — B2 da migration 087_operator_notifiable_and_drift_status.
//
// Motivo: a correção de 01/09 ficou 2 dias parada porque o repo dizia "pronto" e o
// banco dizia "não existe" (coluna/migration não aplicada), e nada media isso. Este
// módulo só LÊ o estado (RPC SECURITY DEFINER, cacheada 5 min no banco) — nunca aplica
// migration a partir do app.
//
// Contrato real da RPC (087, mais rico que o {ok, missing} genérico do plano original):
//   { ok, missing_columns: [{table, column}], missing_config_keys: string[], checked_at }
// Se a RPC ainda não existir quando esta tela carregar (deploy do backend atrasado —
// exatamente o cenário que esta tela existe para detectar), falha SILENCIOSA: não
// mostra banner de erro sobre a checagem de drift, só não mostra nada (evita alarme
// falso "banco quebrado" quando na verdade é só a própria RPC de drift que falta).

import { createClient } from '@/lib/supabase/client';

export type MissingColumn = { table: string; column: string };

export type SchemaDriftStatus = {
  ok: boolean;
  missing_columns: MissingColumn[];
  missing_config_keys: string[];
  checked_at: string | null;
};

const EMPTY_OK: SchemaDriftStatus = { ok: true, missing_columns: [], missing_config_keys: [], checked_at: null };

/**
 * Consulta o status de drift repo×banco. Retorna `null` quando a checagem em si
 * não está disponível ainda (RPC ausente — 42883/PGRST202) para o chamador
 * decidir não renderizar nada, em vez de tratar como "drift detectado".
 */
export async function getSchemaDriftStatus(forceRefresh = false): Promise<SchemaDriftStatus | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_schema_drift_status', { p_force_refresh: forceRefresh });
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') return null; // RPC não existe ainda
    throw error;
  }
  if (!data) return EMPTY_OK;
  return data as SchemaDriftStatus;
}
