/**
 * wiring-contract.spec.js — garante que TODA chamada front↔back resolve no backend VIVO.
 *
 * Para cada RPC que o front chama (com os nomes de parâmetro reais) e cada tabela/view,
 * bate na Supabase de produção com a anon key (schema portal) e exige que NÃO retorne
 * PGRST202 (função inexistente) nem PGRST205 (tabela inexistente). Respostas de auth/RLS
 * (401/400/P0001/42501) provam que o objeto existe e está protegido — wiring OK.
 *
 * Read-only: chamadas autenticadas falham em "Sessão inválida"/"permission denied" ANTES
 * de qualquer escrita. Seguro rodar em loop.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cfg = readFileSync(join(ROOT, 'assets/js/supabase-config.js'), 'utf8');
const SB_URL = (cfg.match(/url:\s*'([^']+)'/) || [])[1];
const ANON = (cfg.match(/eyJ[A-Za-z0-9_.-]+/) || [])[0];
const HDR = { apikey: ANON, Authorization: 'Bearer ' + ANON };
const U = '00000000-0000-0000-0000-000000000000';

// RPCs com os args EXATOS que o front envia.
const RPC_CALLS = {
  get_my_dashboard: {},
  get_client_briefing: {},
  submit_base_briefing: {},
  save_base_briefing: { p_access: {}, p_pending: [] },
  create_project: { p_title: 'x', p_general: {}, p_services: [] },
  save_project_briefing: { p_project_id: U, p_answers: {} },
  submit_project_briefing: { p_project_id: U },
  create_demand: { p_title: 'x', p_description: 'x', p_operators: [], p_project_id: null, p_starts_at: null, p_ends_at: null },
  finalize_my_part: { p_demand_id: U },
  submit_client_rating: { p_demand_id: U, p_score: 5, p_comment: 'x' },
  delete_employee: { target_id: U },
  get_student_team: { p_slug: 'x' },
  get_student_contracted_positions: { p_slug: 'x' },
  get_client_active_services: { p_client_slug: 'x' },
};

const TABLES = [
  'client_briefing', 'client_profiles', 'clients', 'demand_members', 'demand_messages',
  'demand_operators', 'demands', 'hotmart_purchases', 'operators', 'positions', 'projects',
  'ratings', 'services', 'subscriptions', 'team_assignments', 'user_preferences', 'users',
  'v_demands', 'v_employees', 'v_operators', 'v_service_renewals', 'v_students', 'v_subscriptions',
];

test('config Supabase legível (url + anon)', () => {
  expect(SB_URL).toMatch(/supabase\.co$/);
  expect(ANON && ANON.length).toBeGreaterThan(100);
});

test.describe('Contrato front↔back — RPCs existem no backend vivo', () => {
  for (const [fn, args] of Object.entries(RPC_CALLS)) {
    test(`rpc: ${fn}`, async ({ request }) => {
      const r = await request.post(`${SB_URL}/rest/v1/rpc/${fn}`, {
        headers: { ...HDR, 'Content-Type': 'application/json', 'Content-Profile': 'portal' },
        data: args,
      });
      let body = {}; try { body = await r.json(); } catch {}
      expect(body.code, `${fn} ausente/sig errada: ${body.message || ''}`).not.toBe('PGRST202');
    });
  }
});

test.describe('Contrato front↔back — tabelas/views existem', () => {
  for (const t of TABLES) {
    test(`table: ${t}`, async ({ request }) => {
      const r = await request.get(`${SB_URL}/rest/v1/${t}?limit=1`, { headers: { ...HDR, 'Accept-Profile': 'portal' } });
      let body = {}; if (r.status() >= 400) { try { body = await r.json(); } catch {} }
      expect(body.code, `${t} ausente: ${body.message || ''}`).not.toBe('PGRST205');
      expect(r.status(), `${t} 404`).not.toBe(404);
    });
  }
});
