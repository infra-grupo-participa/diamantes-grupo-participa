/**
 * briefing-templates.js
 * Templates de briefing por tipo de serviço.
 *
 * Cada template define seções e campos com prioridade (red/yellow/green).
 * O frontend usa esses templates para renderizar o wizard e validar 🔴 obrigatórios.
 */

window.BRIEFING_TEMPLATES = {

  anuncios_pagos: {
    version: 'anuncios_pagos@1.1',
    label: 'Anúncios Pagos',
    sections: [
      {
        id: 'identificacao',
        title: 'Identificação do Projeto',
        icon: 'user',
        fields: [
          { id: 'expert_name',      label: 'Nome do cliente (expert)',          type: 'text',   priority: 'red' },
          { id: 'company_name',     label: 'Nome do escritório / empresa',      type: 'text',   priority: 'red' },
          { id: 'niche',            label: 'Nicho / área de atuação',           type: 'text',   priority: 'red' },
          { id: 'seminar_code',     label: 'Nome / código interno do Seminário', type: 'text',  priority: 'red',    hint: 'Ex.: SEMJUN26 — Seminário Reforma Tributária' },
          { id: 'seminar_date',     label: 'Data prevista do próximo Seminário', type: 'date',  priority: 'red' },
          { id: 'account_manager',  label: 'Gestor da carteira',                type: 'text',   priority: 'yellow', readonly: true, auto: true, hint: 'Preenchido automaticamente com base na equipe atribuída.' },
        ],
      },
      {
        id: 'meta_ads',
        title: 'Acessos Meta Ads',
        icon: 'target',
        alert: '80% dos atrasos são causados por acessos pendentes. Resolva os itens obrigatórios antes de qualquer outra ação.',
        fields: [
          { id: 'bm_admin_email',    label: 'E-mail adicionado como admin no Meta Business Manager', type: 'email',  priority: 'red',    hint: 'Aprovação pode exigir 2º admin — prever tempo.' },
          { id: 'ad_account_id',     label: 'ID da conta de anúncios Meta',                          type: 'text',   priority: 'red',    hint: 'Confirmar se está ativa' },
          { id: 'facebook_page',     label: 'Página do Facebook vinculada à BM',                     type: 'text',   priority: 'red' },
          { id: 'instagram_account', label: 'Conta do Instagram vinculada à página do Facebook',     type: 'text',   priority: 'red' },
          { id: 'has_pixel',         label: 'Pixel / catálogo já existem na BM?',                    type: 'boolean', priority: 'yellow' },
          { id: 'pixel_id',          label: 'ID do Pixel (se já existe)',                             type: 'text',   priority: 'yellow', dependsOn: { field: 'has_pixel', value: true } },
          { id: 'campaign_history',  label: 'Histórico de campanhas anteriores na BM',               type: 'select', priority: 'yellow', options: ['Nenhuma', 'Existe — pode reaproveitar públicos e dados'] },
        ],
      },
      {
        id: 'google_ads',
        title: 'Acessos Google Ads e YouTube',
        icon: 'search',
        alert: 'Verificação Google Ads pode levar até 3 semanas. O processo começa no D-45.',
        fields: [
          { id: 'google_account_id',      label: 'ID da conta Google Ads',                     type: 'text',   priority: 'red',    hint: 'Formato XXX-XXX-XXXX' },
          { id: 'verification_status',    label: 'Status da verificação da conta',              type: 'select', priority: 'red',    options: ['Não iniciada', 'Em andamento', 'Aprovada'] },
          { id: 'google_admin_granted',   label: 'Acesso de administrador concedido ao gestor', type: 'boolean', priority: 'red' },
          { id: 'youtube_channel',        label: 'Canal do YouTube vinculado à conta Google Ads', type: 'text', priority: 'red',    hint: 'Onde os vídeos "não listados" serão carregados' },
          { id: 'has_ga4',               label: 'Conta Google Analytics 4 / Looker já configurada?', type: 'boolean', priority: 'yellow' },
          { id: 'ga4_access',            label: 'Acesso ao GA4 (se já existe)',                 type: 'text',   priority: 'yellow', dependsOn: { field: 'has_ga4', value: true } },
        ],
      },
      {
        id: 'financeiro',
        title: 'Cartões e Saúde Financeira',
        icon: 'credit-card',
        alert: 'Múltiplos casos de campanhas pausadas por cartão bloqueado. Cadastre um cartão de backup.',
        fields: [
          { id: 'meta_card_main',      label: 'Cartão principal Meta Ads',                   type: 'card',   priority: 'red',    hint: 'Selecione a bandeira, informe os 4 últimos dígitos do cartão e a validade no formato MM/AA.' },
          { id: 'meta_card_backup',    label: 'Cartão de backup no Meta Ads cadastrado?',    type: 'boolean', priority: 'red' },
          { id: 'meta_limit_ok',       label: 'Limite mensal compatível com o orçamento previsto?', type: 'boolean', priority: 'red' },
          { id: 'meta_billing_alerts', label: 'Cliente acompanha alertas de cobrança do Meta?', type: 'boolean', priority: 'yellow' },
          { id: 'google_card_main',    label: 'Cartão principal Google Ads',                 type: 'card',   priority: 'red',    hint: 'Pode ser o mesmo cartão do Meta ou diferente' },
          { id: 'google_card_backup',  label: 'Cartão de backup no Google Ads cadastrado?',  type: 'boolean', priority: 'red' },
          { id: 'google_payment_mode', label: 'Modalidade de pagamento Google Ads',          type: 'select', priority: 'yellow', options: ['Pré-pago', 'Pós-pago automático', 'Faturamento mensal'] },
        ],
      },
      {
        id: 'stape',
        title: 'Stape.io e CAPI',
        icon: 'cpu',
        hint: 'Recomendado para clientes com faturamento acima de R$50k ou contas afetadas pelo iOS Tracking.',
        fields: [
          { id: 'use_stape',       label: 'Cliente deseja usar Stape.io / CAPI?', type: 'boolean', priority: 'yellow' },
          { id: 'stape_created',   label: 'Conta Stape.io criada?',               type: 'boolean', priority: 'yellow', dependsOn: { field: 'use_stape', value: true } },
          { id: 'stape_login',     label: 'Login do Stape (se já criada)',         type: 'text',   priority: 'yellow', dependsOn: { field: 'stape_created', value: true } },
          { id: 'stape_plan',      label: 'Plano contratado no Stape',             type: 'select', priority: 'yellow', options: ['Free', 'Básico', 'Pro'], dependsOn: { field: 'use_stape', value: true } },
          { id: 'stape_payment',   label: 'Cartão de pagamento do Stape ativo?',  type: 'boolean', priority: 'yellow', dependsOn: { field: 'use_stape', value: true } },
        ],
      },
      {
        id: 'looker',
        title: 'Dashboard Looker Studio',
        icon: 'bar-chart',
        hint: 'Todo novo cliente recebe um dashboard personalizado durante o onboarding.',
        fields: [
          { id: 'expert_photo_url',      label: 'Link da foto profissional do expert (Google Drive)',  type: 'url',  priority: 'red',  hint: 'Compartilhe a foto via Google Drive e cole o link aqui. Foto em alta resolução, fundo neutro.' },
          { id: 'brand_colors',          label: 'Cores principais (códigos hex)',            type: 'text',   priority: 'red',    hint: 'Ex.: #F29725, #FFFFFF' },
          { id: 'client_google_email',   label: 'E-mail Google para acesso ao Looker',      type: 'email',  priority: 'yellow' },
          { id: 'wants_meeting',         label: 'Reunião de apresentação do dashboard?',    type: 'boolean', priority: 'yellow' },
        ],
      },
      {
        id: 'orcamento',
        title: 'Orçamento, Volume e Compromissos',
        icon: 'trending-up',
        fields: [
          { id: 'total_budget',         label: 'Orçamento total de mídia previsto (R$)',         type: 'number', priority: 'red',    hint: 'Soma de Meta + Google para o ciclo' },
          { id: 'budget_distribution',  label: 'Distribuição: captação / lembrete / RMKT',       type: 'text',   priority: 'red',    hint: 'Sugestão: 70% captação / 15% lembrete / 15% RMKT' },
          { id: 'max_cpl',             label: 'CPL máximo aceitável (R$)',                       type: 'number', priority: 'red',    hint: 'Para acionar realocação automática' },
          { id: 'lead_goal',           label: 'Meta de leads total para o ciclo',                type: 'number', priority: 'red' },
          { id: 'war_budget',          label: 'Verba reservada para "guerra" pós-evento (R$)',   type: 'number', priority: 'yellow', hint: 'Sugestão: R$1.000 para fechar carrinho' },
          { id: 'previous_seminars',   label: 'Quantos Seminários já realizou?',                 type: 'select', priority: 'yellow', options: ['Nenhum', '1–3', '4 ou mais'] },
          { id: 'best_cpl',            label: 'Melhor CPL anterior (R$)',                        type: 'number', priority: 'yellow', hint: 'Usado como benchmark interno' },
          { id: 'has_lead_list',       label: 'Possui lista de leads anteriores?',               type: 'boolean', priority: 'yellow' },
          { id: 'lead_list_count',     label: 'Quantidade de leads na lista',                    type: 'number', priority: 'yellow', dependsOn: { field: 'has_lead_list', value: true } },
          { id: 'lead_list_format',    label: 'Formato da lista de leads',                       type: 'select', priority: 'yellow', options: ['CSV', 'Excel'], dependsOn: { field: 'has_lead_list', value: true } },
        ],
      },
      {
        id: 'camadas',
        title: 'Distribuição por Camadas',
        icon: 'layers',
        hint: 'C1 (Topo 60%) · C2 (Aprofundamento 25%) · C3 (Prova Social 10%) · C4 (Venda 5%)',
        fields: [
          { id: 'organic_commitment',    label: 'Cliente compromete-se a produzir conteúdo orgânico semanal?', type: 'boolean', priority: 'red',    hint: 'Padrão: 2 Reels + 1 Carrossel por semana. Sem produção, as camadas não rodam.' },
          { id: 'has_pauta_bank',        label: 'Banco de pautas mantido pelo cliente?',                       type: 'boolean', priority: 'red' },
          { id: 'pauta_bank_link',       label: 'Link do banco de pautas',                                     type: 'url',    priority: 'yellow', dependsOn: { field: 'has_pauta_bank', value: true } },
          { id: 'reels_stock',           label: 'Estoque atual de Reels prontos para impulsionamento',         type: 'number', priority: 'yellow' },
          { id: 'carrossel_stock',       label: 'Estoque atual de Carrosséis prontos',                         type: 'number', priority: 'yellow' },
          { id: 'sends_organic_metrics', label: 'Cliente envia métricas dos posts orgânicos semanalmente?',    type: 'boolean', priority: 'yellow' },
          { id: 'custom_layer_split',    label: 'Cliente quer adaptar a proporção padrão das camadas?',        type: 'boolean', priority: 'green' },
          { id: 'custom_split_value',    label: 'Proporção personalizada (C1/C2/C3/C4)',                       type: 'text',   priority: 'green',  dependsOn: { field: 'custom_layer_split', value: true }, hint: 'Ex.: 50/30/10/10' },
        ],
      },
    ],
  },

};

/**
 * Retorna todos os campos 🔴 de um template.
 */
window.getBriefingRequiredFields = function (serviceType) {
  const tpl = window.BRIEFING_TEMPLATES[serviceType];
  if (!tpl) return [];
  return tpl.sections.flatMap(s => s.fields.filter(f => f.priority === 'red'));
};

/**
 * Verifica se um briefing (objeto de respostas) satisfaz todos os 🔴 do template.
 * Campos com `dependsOn` só são obrigatórios se a condição for verdadeira.
 * Retorna { valid: boolean, missing: string[] }
 */
window.validateBriefing = function (serviceType, answers) {
  const required = window.getBriefingRequiredFields(serviceType);
  const missing = [];

  for (const field of required) {
    if (field.readonly) continue; // auto-preenchido, não valida
    if (field.dependsOn) {
      const dep = answers[field.dependsOn.field];
      if (dep !== field.dependsOn.value) continue;
    }
    const val = answers[field.id];
    if (field.type === 'card') {
      // Valida campos do cartão
      if (!val || !val.brand || !val.last4 || val.last4.length < 4 || !val.expiry) {
        missing.push(field.id);
      }
    } else if (val === null || val === undefined || val === '') {
      missing.push(field.id);
    }
  }

  return { valid: missing.length === 0, missing };
};
