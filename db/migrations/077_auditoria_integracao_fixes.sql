-- 077: correções da auditoria de integração (jun/2026) — lote DB.
-- Guard de conclusão de projeto, limpeza de view/overload/trigger e pausa do cron
-- de retry de e-mail. Tudo reversível. (Aplicada no remoto via apply_migration.)

-- ── #10: remove overload órfão de create_demand (sem p_project_id) ──
-- O app sempre envia p_project_id (resolve a versão nova, com autofill). O overload
-- antigo (p_*_at date, sem p_project_id) é landmine de resolução de função.
drop function if exists portal.create_demand(text, text, uuid[], date, date);

-- ── #4/#5: complete_project bloqueia conclusão com demandas em aberto ──
-- Espelha o guard que create_demand já aplica (proíbe nova demanda em projeto
-- concluído). Mantém a conclusão manual do admin, mas exige reconciliar as demandas
-- antes — fechando a incoerência "projeto concluído com demandas penduradas".
create or replace function portal.complete_project(p_project_id uuid)
 returns portal.projects
 language plpgsql
 security definer
 set search_path to 'portal','public'
as $function$
declare v_caller portal.users; v_project portal.projects; v_open int;
begin
  select * into v_caller from portal.users where auth_user_id = auth.uid() limit 1;
  if v_caller.id is null then raise exception 'Sessão inválida.'; end if;
  if not portal.is_admin() then raise exception 'Apenas admin pode concluir projetos.'; end if;
  select * into v_project from portal.projects where id = p_project_id limit 1;
  if v_project.id is null then raise exception 'Projeto não encontrado.'; end if;
  if v_project.status = 'completed' then raise exception 'Projeto já está concluído.'; end if;

  select count(*) into v_open from portal.demands
   where project_id = p_project_id and status in ('open','in_progress','review');
  if v_open > 0 then
    raise exception 'Existem % demanda(s) em aberto neste projeto. Conclua ou cancele antes de concluir o projeto.', v_open;
  end if;

  update portal.projects set status='completed', completed_at=now(), updated_at=now()
   where id = p_project_id returning * into v_project;
  insert into portal.audit_log (event, user_id, identifier, metadata)
  values ('project_completed', v_caller.id, v_project.id::text,
          jsonb_build_object('entity_type','project','title', v_project.title));
  return v_project;
end; $function$;

-- ── #11: remove métrica morta operators_approved de v_demands ──
-- Cruzava demand_members.role='operator' (nunca existe — operadores vivem em
-- demand_operators) com approved_finish → sempre 0, sem consumidor no app.
-- Sem dependentes (verificado). Owner/grants preservados.
drop view if exists portal.v_demands;
create view portal.v_demands as
 select d.id, d.client_slug, c.display_name as client_name, d.title, d.description,
    d.status, d.starts_at, d.ends_at, d.clickup_task_id, d.finalized_at, d.created_at,
    d.updated_at, d.service_type, d.briefing_status,
    (select u.name from portal.users u where u.id = d.created_by) as created_by_name,
    (select count(*) from portal.demand_operators dop where dop.demand_id = d.id) as operators_total,
    (select count(*) from portal.demand_messages dmsg where dmsg.demand_id = d.id) as messages_count,
    (select max(dmsg2.created_at) from portal.demand_messages dmsg2 where dmsg2.demand_id = d.id) as last_message_at,
    d.project_id,
    (select p.title from portal.projects p where p.id = d.project_id) as project_title,
    (select dmsg3.content from portal.demand_messages dmsg3 where dmsg3.demand_id = d.id order by dmsg3.created_at desc limit 1) as last_message_preview,
    (select case when u3.role is null or u3.role <> 'user' then 'team' else 'client' end
       from portal.demand_messages dmsg4 left join portal.users u3 on u3.id = dmsg4.user_id
      where dmsg4.demand_id = d.id order by dmsg4.created_at desc limit 1) as last_message_from
   from portal.demands d
   join portal.clients c on c.slug = d.client_slug;
grant select on portal.v_demands to authenticated, service_role;

-- ── #11: desliga trigger de pontos (resíduo do sistema de notas removido) ──
-- Único caminho que ainda reagiria a uma nota; reversível com ENABLE TRIGGER.
alter table portal.ratings disable trigger trg_award_points;

-- ── #12: pausa o cron de retry de e-mail enquanto e-mails ao cliente estão pausados ──
-- Não respeitava a decisão de pausa. Reversível: cron.alter_job(9, active := true) ao relançar.
select cron.alter_job(9, active := false);
