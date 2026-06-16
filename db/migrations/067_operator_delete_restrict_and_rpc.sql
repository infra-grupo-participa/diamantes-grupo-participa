-- B1: integridade estrutural ao excluir operador.
-- Antes: demand_operators.operator_id ON DELETE CASCADE → excluir operador apagava
-- silenciosamente os vínculos com demandas (e o histórico de avaliações junto).
-- Agora: RESTRICT (o banco recusa) + RPC com tradução de erro + audit_log.
-- Caminho primário na UI passa a ser INATIVAR (não-destrutivo).
-- (Aplicada no remoto via apply_migration.)

alter table portal.demand_operators
  drop constraint if exists demand_operators_operator_id_fkey;
alter table portal.demand_operators
  add constraint demand_operators_operator_id_fkey
  foreign key (operator_id) references portal.operators(id) on delete restrict;

create or replace function portal.delete_operator(target_id uuid)
returns void
language plpgsql
security definer
set search_path to 'portal', 'public'
as $$
declare
  v_caller  uuid;
  v_name    text;
  v_demands integer;
begin
  if not portal.is_admin() then
    raise exception 'Apenas admin pode excluir operadores.' using errcode = '42501';
  end if;

  select name into v_name from portal.operators where id = target_id;
  if not found then
    raise exception 'Operador não encontrado.' using errcode = 'P0002';
  end if;

  select count(*) into v_demands from portal.demand_operators where operator_id = target_id;
  if v_demands > 0 then
    raise exception 'Operador tem % demanda(s) vinculada(s). Inative-o em vez de excluir — isso preserva o histórico e as avaliações.', v_demands
      using errcode = '23503';
  end if;

  select id into v_caller from portal.users where auth_user_id = auth.uid();

  delete from portal.operators where id = target_id;

  insert into portal.audit_log(event, user_id, identifier, metadata)
  values ('operator.deleted', v_caller, v_name, jsonb_build_object('operator_id', target_id));
exception
  when foreign_key_violation then
    raise exception 'Não é possível excluir: o operador tem registros vinculados. Inative-o em vez de excluir.'
      using errcode = '23503';
end;
$$;

grant execute on function portal.delete_operator(uuid) to authenticated;

comment on function portal.delete_operator(uuid) is
  'B1: exclui operador com guarda admin + tradução de erro de FK (recomenda inativar) + audit_log.';
