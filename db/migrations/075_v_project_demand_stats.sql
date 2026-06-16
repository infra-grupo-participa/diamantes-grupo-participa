-- Agregados de demandas por projeto (andamento + SLA) para a tela admin de Projetos.
-- security_invoker: respeita a RLS do chamador (admin enxerga tudo).
-- (Aplicada no remoto via apply_migration.)
create or replace view portal.v_project_demand_stats
with (security_invoker = true) as
select
  d.project_id,
  count(*)::int                                                              as demands_total,
  count(*) filter (where d.status = 'done')::int                             as demands_done,
  count(*) filter (where d.status in ('open','in_progress','review'))::int   as demands_open,
  count(*) filter (where d.status not in ('done','canceled')
                     and d.ends_at is not null
                     and d.ends_at::date < current_date)::int                as demands_overdue,
  min(d.ends_at) filter (where d.status not in ('done','canceled')
                           and d.ends_at is not null)                        as next_due
from portal.demands d
where d.project_id is not null
group by d.project_id;

grant select on portal.v_project_demand_stats to authenticated;
