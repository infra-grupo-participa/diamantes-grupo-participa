-- 058_v_operator_performance
-- Performance do operador em DUAS dimensões (decisão de produto: separadas):
--   • Demandas: média das avaliações 5★ do cliente nas demandas em que atuou (efeito
--     cumulativo — já alimentado por _trg_award_points/ratings), + contagem + distribuição.
--   • Projetos: satisfação (estrelas) e NPS das avaliações de PROJETO dos projetos em que
--     o operador participou de ao menos uma demanda. Cada projeto conta uma vez (DISTINCT).
-- Mais o points_score acumulado (gamificação já existente). Consumida pelo card do
-- operador na aba Equipe do admin.
CREATE OR REPLACE VIEW portal.v_operator_performance AS
SELECT
  o.id      AS operator_id,
  o.name,
  o.email,
  o.position_id,
  p.name    AS position_name,
  p.color   AS position_color,
  o.status,
  o.contract_active,
  o.points_score,
  (SELECT count(DISTINCT dop.demand_id)
     FROM portal.demand_operators dop
    WHERE dop.operator_id = o.id)::int AS demands_count,
  (SELECT count(*)
     FROM portal.demand_operators dop
     JOIN portal.ratings r ON r.demand_id = dop.demand_id AND r.status = 'submitted'
    WHERE dop.operator_id = o.id)::int AS demand_rating_count,
  COALESCE((SELECT round(avg(r.score), 2)
     FROM portal.demand_operators dop
     JOIN portal.ratings r ON r.demand_id = dop.demand_id AND r.status = 'submitted'
    WHERE dop.operator_id = o.id), 0)::numeric AS demand_avg,
  COALESCE((SELECT jsonb_object_agg(z.score, z.cnt)
     FROM (SELECT r.score, count(*) AS cnt
             FROM portal.demand_operators dop
             JOIN portal.ratings r ON r.demand_id = dop.demand_id AND r.status = 'submitted'
            WHERE dop.operator_id = o.id
            GROUP BY r.score) z), '{}'::jsonb) AS demand_star_distribution,
  (SELECT count(*)
     FROM (SELECT DISTINCT d.project_id
             FROM portal.demand_operators dop
             JOIN portal.demands d ON d.id = dop.demand_id
            WHERE dop.operator_id = o.id AND d.project_id IS NOT NULL) op
     JOIN portal.project_ratings pr ON pr.project_id = op.project_id AND pr.status = 'submitted')::int AS project_rating_count,
  COALESCE((SELECT round(avg(pr.stars), 2)
     FROM (SELECT DISTINCT d.project_id
             FROM portal.demand_operators dop
             JOIN portal.demands d ON d.id = dop.demand_id
            WHERE dop.operator_id = o.id AND d.project_id IS NOT NULL) op
     JOIN portal.project_ratings pr ON pr.project_id = op.project_id AND pr.status = 'submitted'), 0)::numeric AS project_avg,
  COALESCE((SELECT round(avg(pr.nps), 1)
     FROM (SELECT DISTINCT d.project_id
             FROM portal.demand_operators dop
             JOIN portal.demands d ON d.id = dop.demand_id
            WHERE dop.operator_id = o.id AND d.project_id IS NOT NULL) op
     JOIN portal.project_ratings pr ON pr.project_id = op.project_id AND pr.status = 'submitted' AND pr.nps IS NOT NULL), 0)::numeric AS project_nps_avg
FROM portal.operators o
LEFT JOIN portal.positions p ON p.id = o.position_id;

GRANT SELECT ON portal.v_operator_performance TO authenticated;
