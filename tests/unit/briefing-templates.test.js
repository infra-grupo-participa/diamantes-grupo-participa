/**
 * briefing-templates.test.js — cobre a lógica nova do modelo de briefing em 2 níveis.
 * Funções puras expostas em window por portal/assets/briefing-templates.js.
 */
import '../../portal/assets/briefing-templates.js';

const W = globalThis.window || globalThis;

describe('BRIEFING — serviços ativos e templates', () => {
  test('4 serviços ativos', () => {
    expect(W.BRIEFING_ACTIVE_SERVICES).toEqual(['anuncios_pagos', 'edicao_video', 'paginas', 'automacao']);
  });
  test('todo serviço ativo tem template com sections', () => {
    for (const s of W.BRIEFING_ACTIVE_SERVICES) {
      expect(W.BRIEFING_TEMPLATES[s]).toBeTruthy();
      expect(Array.isArray(W.BRIEFING_TEMPLATES[s].sections)).toBe(true);
      expect(W.BRIEFING_TEMPLATES[s].sections.length).toBeGreaterThan(0);
    }
  });
  test('labels curtos definidos', () => {
    expect(W.BRIEFING_SERVICE_LABELS.anuncios_pagos).toBe('Tráfego');
    expect(W.BRIEFING_SERVICE_LABELS.paginas).toBe('Páginas');
  });
});

describe('scope base vs project', () => {
  test('Tráfego: acessos = base, campanha = project', () => {
    const baseIds = W.getBaseSections('anuncios_pagos').map(s => s.id);
    const projIds = W.getProjectSections('anuncios_pagos').map(s => s.id);
    expect(baseIds).toEqual(expect.arrayContaining(['meta_ads', 'google_ads', 'rastreamento', 'financeiro']));
    expect(projIds).toEqual(expect.arrayContaining(['orcamento', 'camadas']));
    // sem sobreposição
    expect(baseIds.filter(id => projIds.includes(id))).toEqual([]);
    // identificacao é project (título "do projeto")
    expect(projIds).toContain('identificacao');
    expect(baseIds).not.toContain('identificacao');
  });
  test('Páginas: acessos base + domínio project', () => {
    expect(W.getBaseSections('paginas').map(s => s.id)).toContain('acessos_plataformas');
    expect(W.getProjectSections('paginas').map(s => s.id)).toContain('dominio');
  });
  test('Automação: acessos base', () => {
    expect(W.getBaseSections('automacao').map(s => s.id)).toContain('acessos_ferramentas');
  });
  test('Edição: sem seção de acesso (tudo project)', () => {
    expect(W.getBaseSections('edicao_video').length).toBe(0);
    expect(W.getProjectSections('edicao_video').length).toBeGreaterThan(0);
  });
  test('getFieldScope respeita override de campo', () => {
    const f = { id: 'x' };
    expect(W.getFieldScope('paginas', 'dominio', f)).toBe('project');
    expect(W.getFieldScope('paginas', 'acessos_plataformas', f)).toBe('base');
    expect(W.getFieldScope('anuncios_pagos', 'secao_desconhecida', f)).toBe('project'); // default
    expect(W.getFieldScope('anuncios_pagos', 'meta_ads', { id: 'y', scope: 'project' })).toBe('project'); // field vence
  });
});

describe('bloco geral do evento', () => {
  test('campos esperados', () => {
    const ids = W.getGeneralFields().map(f => f.id);
    expect(ids).toEqual(expect.arrayContaining(['event_name', 'event_date', 'total_budget', 'traffic_goal', 'project_goal', 'audience', 'desired_domain']));
  });
});

describe('fieldIsEmpty', () => {
  test('texto vazio = vazio; preenchido = ok', () => {
    expect(W.fieldIsEmpty({ id: 'a', type: 'text', priority: 'red' }, {})).toBe(true);
    expect(W.fieldIsEmpty({ id: 'a', type: 'text', priority: 'red' }, { a: 'x' })).toBe(false);
  });
  test('boolean false é válido', () => {
    expect(W.fieldIsEmpty({ id: 'b', type: 'boolean', priority: 'red' }, { b: false })).toBe(false);
    expect(W.fieldIsEmpty({ id: 'b', type: 'boolean', priority: 'red' }, {})).toBe(true);
  });
  test('dependsOn não satisfeito = não exigido', () => {
    const f = { id: 'c', type: 'text', priority: 'red', dependsOn: { field: 'has', value: true } };
    expect(W.fieldIsEmpty(f, { has: false })).toBe(false); // oculto → não vazio
    expect(W.fieldIsEmpty(f, { has: true })).toBe(true);   // visível e vazio
  });
  test('readonly nunca é vazio', () => {
    expect(W.fieldIsEmpty({ id: 'd', type: 'text', priority: 'red', readonly: true }, {})).toBe(false);
  });
});

describe('validateBaseAccess', () => {
  test('automacao vazio → faltam reds', () => {
    const r = W.validateBaseAccess('automacao', {});
    expect(r.valid).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
  });
  test('preenchendo os reds → válido', () => {
    const reds = W.getBaseSections('automacao').flatMap(s => s.fields).filter(f => f.priority === 'red' && !f.dependsOn);
    const ans = {};
    reds.forEach(f => { ans[f.id] = f.type === 'boolean' ? true : 'ok'; });
    expect(W.validateBaseAccess('automacao', ans).valid).toBe(true);
  });
});

describe('validateProjectBriefing', () => {
  test('vazio → faltam reds do bloco geral', () => {
    const r = W.validateProjectBriefing(['anuncios_pagos'], { general: {}, services: {} });
    expect(r.valid).toBe(false);
    expect(r.missing.some(m => m.scope === 'general')).toBe(true);
  });
  test('só conta serviços do evento', () => {
    const r = W.validateProjectBriefing(['paginas'], { general: {}, services: {} });
    // não deve reclamar de campos de tráfego/edição
    expect(r.missing.every(m => m.scope === 'general' || m.scope === 'paginas')).toBe(true);
  });
  test('geral + páginas preenchidos → válido', () => {
    const general = {};
    W.getGeneralFields().filter(f => f.priority === 'red').forEach(f => { general[f.id] = f.type === 'number' ? 1 : 'x'; });
    const pag = {};
    W.getProjectSections('paginas').flatMap(s => s.fields).filter(f => f.priority === 'red' && !f.dependsOn).forEach(f => { pag[f.id] = 'x'; });
    const r = W.validateProjectBriefing(['paginas'], { general, services: { paginas: pag } });
    expect(r.valid).toBe(true);
  });
});
