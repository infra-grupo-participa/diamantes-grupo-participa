// API de Panorama do Projeto (admin) — B4.
// SEM backend novo: queries diretas indexadas via supabase-js (admin lê tudo
// via RLS). Espelha o padrão de getDemandFullDetails (Promise.all + index por id).
//
// NÃO há "chat de projeto" no modelo de dados — o chat é por demanda. Este
// módulo agrega as demandas do projeto; o chat é delegado ao DemandDetailModal.

import { createClient } from '@/lib/supabase/client';
import type { Demand, DemandOperator } from '@/lib/api/admin-demandas';

export interface ProjectPanorama {
  /** Acessos do Briefing Básico do cliente ({ serviço: { campo: valor } }). */
  access: Record<string, Record<string, unknown>>;
  /** Demandas do projeto (v_demands filtrada por project_id). */
  demands: Demand[];
  /** Operadores escalados no projeto (dedup por operator_id, via demandas). */
  operators: DemandOperator[];
}

/**
 * Carrega o panorama de um projeto em ~3 idas ao banco:
 *   1) client_briefing.access (1 query)
 *   2) v_demands do projeto (1 query)
 *   3) demand_operators + operators + positions (em lote, .in) — só se houver demandas
 */
export async function getProjectPanorama(
  projectId: string,
  clientSlug: string,
): Promise<ProjectPanorama> {
  const supabase = createClient();

  const [accessRes, demandsRes] = await Promise.all([
    supabase.from('client_briefing').select('access').eq('client_slug', clientSlug).maybeSingle(),
    supabase.from('v_demands').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
  ]);

  const access = ((accessRes.data?.access as Record<string, Record<string, unknown>>) ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  if (demandsRes.error) throw demandsRes.error;
  const demands = (demandsRes.data ?? []) as Demand[];

  // Operadores escalados no projeto = união dos operadores de todas as demandas.
  const demandIds = [...new Set(demands.map((d) => d.id).filter(Boolean))];
  let operators: DemandOperator[] = [];
  if (demandIds.length) {
    const { data: dops, error: dopsErr } = await supabase
      .from('demand_operators')
      .select('operator_id')
      .in('demand_id', demandIds);
    if (dopsErr) throw dopsErr;
    const opIds = [...new Set(((dops ?? []) as Array<{ operator_id: string }>).map((d) => d.operator_id))];
    if (opIds.length) {
      const { data: ops, error: opsErr } = await supabase
        .from('operators')
        .select('id, name, email, clickup_user_id, position_id')
        .in('id', opIds);
      if (opsErr) throw opsErr;
      const rows = (ops ?? []) as Array<Record<string, unknown>>;
      const pids = [...new Set(rows.map((o) => o.position_id).filter(Boolean))] as Array<string | number>;
      let posById: Record<string, { name?: string; color?: string }> = {};
      if (pids.length) {
        const { data: positions } = await supabase.from('positions').select('id, name, color').in('id', pids);
        posById = Object.fromEntries(
          ((positions ?? []) as Array<{ id: string | number; name?: string; color?: string }>).map((p) => [
            String(p.id),
            { name: p.name, color: p.color },
          ]),
        );
      }
      operators = rows.map((o) => {
        const pos = posById[String(o.position_id)] ?? {};
        return {
          operator_id: o.id as string,
          name: (o.name as string) ?? null,
          email: (o.email as string) ?? null,
          clickup_user_id: (o.clickup_user_id as string) ?? null,
          position_name: pos.name ?? null,
          position_color: pos.color ?? null,
        };
      });
    }
  }

  return { access, demands, operators };
}
