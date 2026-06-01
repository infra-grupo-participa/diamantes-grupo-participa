/**
 * briefing-templates.js
 * Templates de briefing por tipo de serviço.
 *
 * Cada campo pode ter:
 *   hint        — texto explicativo exibido ACIMA do campo
 *   placeholder — texto exibido DENTRO do campo (formato esperado)
 *   priority    — red = obrigatório | yellow = importante | green = recomendado
 *   readonly    — preenchido automaticamente (não editável pelo aluno)
 *   auto        — sinalizador para autoFill no front
 *   dependsOn   — { field, value } para exibição condicional
 */

window.BRIEFING_TEMPLATES = {

  // ═══════════════════════════════════════════════════════════
  // ANÚNCIOS PAGOS
  // ═══════════════════════════════════════════════════════════
  anuncios_pagos: {
    version: 'anuncios_pagos@2.0',
    label: 'Anúncios Pagos',
    sections: [

      // ── 1. Identificação ───────────────────────────────────
      {
        id: 'identificacao',
        title: 'Identificação do Projeto',
        icon: 'user',
        hint: 'Dados básicos do cliente e do ciclo de anúncios. Preencha exatamente como deve aparecer nos criativos e relatórios.',
        fields: [
          {
            id: 'expert_name',
            label: 'Nome completo do expert (como aparece nos criativos)',
            type: 'text',
            priority: 'red',
            hint: 'Nome exato que será exibido nos anúncios e landing pages.',
            placeholder: 'Ex.: Dr. João Silva',
          },
          {
            id: 'company_name',
            label: 'Nome do escritório / empresa',
            type: 'text',
            priority: 'red',
            hint: 'Razão social ou nome fantasia da empresa do cliente.',
            placeholder: 'Ex.: Silva Consultoria Tributária Ltda.',
          },
          {
            id: 'niche',
            label: 'Nicho e área de atuação',
            type: 'text',
            priority: 'red',
            hint: 'Seja específico. Quanto mais detalhado, melhor a segmentação dos anúncios.',
            placeholder: 'Ex.: Direito Tributário para MEIs e pequenas empresas',
          },
          {
            id: 'seminar_code',
            label: 'Nome / código interno do Seminário',
            type: 'text',
            priority: 'red',
            hint: 'Código que a equipe usará para identificar este ciclo internamente.',
            placeholder: 'Ex.: SEMJUN26 — Seminário Reforma Tributária',
          },
          {
            id: 'seminar_date',
            label: 'Data prevista do próximo Seminário',
            type: 'date',
            priority: 'red',
            hint: 'Data exata do evento. Usada para calcular cronograma de campanhas (D-45, D-15, etc.).',
          },
          {
            id: 'account_manager',
            label: 'Gestor da carteira',
            type: 'text',
            priority: 'yellow',
            readonly: true,
            auto: true,
            hint: 'Preenchido automaticamente com o gestor de tráfego atribuído a este cliente.',
          },
        ],
      },

      // ── 2. Meta Ads ────────────────────────────────────────
      {
        id: 'meta_ads',
        title: 'Acessos Meta Ads (Facebook / Instagram)',
        icon: 'target',
        alert: '⚠️ 80% dos atrasos nos lançamentos são causados por acessos pendentes. Resolva os itens obrigatórios antes de qualquer outra ação.',
        fields: [
          {
            id: 'bm_admin_email',
            label: 'E-mail adicionado como Administrador no Meta Business Manager',
            type: 'email',
            priority: 'red',
            hint: 'Acesse business.facebook.com → Configurações → Pessoas → Adicionar pessoas. Cole o e-mail exato que deve receber acesso de ADMIN.',
            placeholder: 'gestor@grupoparticipa.com.br',
          },
          {
            id: 'ad_account_id',
            label: 'ID da conta de anúncios Meta',
            type: 'text',
            priority: 'red',
            hint: 'Encontre em: business.facebook.com → Contas → Contas de Anúncios. O ID começa com "act_" ou é um número longo.',
            placeholder: 'Ex.: 1234567890123456',
          },
          {
            id: 'facebook_page',
            label: 'URL ou nome da Página do Facebook vinculada ao BM',
            type: 'text',
            priority: 'red',
            hint: 'Informe o link completo da página ou o nome exato. Confirme que está vinculada ao Business Manager.',
            placeholder: 'Ex.: facebook.com/drjoaosilva ou "Dr. João Silva - Tributarista"',
          },
          {
            id: 'instagram_account',
            label: 'Perfil do Instagram (@) vinculado à Página do Facebook',
            type: 'text',
            priority: 'red',
            hint: 'O Instagram precisa estar conectado à Página do Facebook no BM para veicular anúncios no Instagram.',
            placeholder: 'Ex.: @drjoaosilva.tributario',
          },
          {
            id: 'has_pixel',
            label: 'Já existe Pixel / conjunto de eventos configurado no BM?',
            type: 'boolean',
            priority: 'yellow',
          },
          {
            id: 'pixel_id',
            label: 'ID do Pixel Meta (se já existe)',
            type: 'text',
            priority: 'yellow',
            hint: 'Encontre em: BM → Fontes de Dados → Pixels.',
            placeholder: 'Ex.: 1234567890',
            dependsOn: { field: 'has_pixel', value: true },
          },
          {
            id: 'campaign_history',
            label: 'Histórico de campanhas anteriores nesta conta',
            type: 'select',
            priority: 'yellow',
            options: [
              'Nenhuma campanha anterior',
              'Tem histórico — pode reaproveitar públicos e dados',
            ],
          },
        ],
      },

      // ── 3. Google Ads ──────────────────────────────────────
      {
        id: 'google_ads',
        title: 'Acessos Google Ads e YouTube',
        icon: 'search',
        alert: '⚠️ A verificação do anunciante no Google pode levar até 3 semanas. O processo começa no D-45 do seminário — não deixe para a última hora.',
        fields: [
          {
            id: 'google_account_id',
            label: 'ID da conta Google Ads',
            type: 'text',
            priority: 'red',
            hint: 'Encontre no canto superior direito do Google Ads, abaixo do e-mail. Formato: XXX-XXX-XXXX.',
            placeholder: 'Ex.: 123-456-7890',
          },
          {
            id: 'verification_status',
            label: 'Status atual da verificação de anunciante',
            type: 'select',
            priority: 'red',
            hint: 'Acesse Google Ads → Ferramentas → Verificação do anunciante.',
            options: ['Não iniciada', 'Em andamento', 'Aprovada'],
          },
          {
            id: 'google_admin_granted',
            label: 'Acesso de administrador concedido ao gestor?',
            type: 'boolean',
            priority: 'red',
            hint: 'O gestor de tráfego precisa de acesso de ADMIN para criar campanhas. Acesse Google Ads → Ferramentas → Gerenciamento de acesso e contas.',
          },
          {
            id: 'youtube_channel',
            label: 'Link do Canal do YouTube vinculado à conta Google Ads',
            type: 'url',
            priority: 'red',
            hint: 'Os vídeos "não listados" dos anúncios serão carregados neste canal. Confirme que está vinculado ao Google Ads.',
            placeholder: 'Ex.: https://www.youtube.com/@drjoaosilva',
          },
          {
            id: 'has_ga4',
            label: 'Conta Google Analytics 4 (GA4) / Looker Studio já configurada?',
            type: 'boolean',
            priority: 'yellow',
          },
          {
            id: 'ga4_access',
            label: 'E-mail com acesso ao GA4',
            type: 'email',
            priority: 'yellow',
            hint: 'Adicione o e-mail do gestor com permissão de Editor no GA4.',
            placeholder: 'gestor@grupoparticipa.com.br',
            dependsOn: { field: 'has_ga4', value: true },
          },
        ],
      },

      // ── 4. Financeiro (Cartões) ────────────────────────────
      {
        id: 'financeiro',
        title: 'Cartões e Saúde Financeira',
        icon: 'credit-card',
        alert: '⚠️ Campanhas pausadas por cartão bloqueado são um dos problemas mais comuns. Tenha SEMPRE um cartão de backup cadastrado.',
        fields: [
          {
            id: 'meta_card_main',
            label: 'Cartão principal do Meta Ads',
            type: 'card',
            priority: 'red',
            hint: 'Selecione a bandeira, informe os 4 últimos dígitos do número do cartão e a validade no formato MM/AA (mês e os 2 últimos dígitos do ano).',
          },
          {
            id: 'meta_card_backup',
            label: 'Cartão de backup cadastrado no Meta Ads?',
            type: 'boolean',
            priority: 'red',
            hint: 'Um segundo cartão evita campanhas pausadas por recusa do cartão principal.',
          },
          {
            id: 'meta_limit_ok',
            label: 'Limite do cartão Meta compatível com o orçamento previsto?',
            type: 'boolean',
            priority: 'red',
            hint: 'Verifique o limite de crédito disponível. O Meta pode cobrar a qualquer momento conforme o limiar de cobrança.',
          },
          {
            id: 'meta_billing_alerts',
            label: 'Cliente está ativo para receber alertas de cobrança do Meta?',
            type: 'boolean',
            priority: 'yellow',
            hint: 'Ative em: Meta BM → Configurações de cobrança → Notificações.',
          },
          {
            id: 'google_card_main',
            label: 'Cartão principal do Google Ads',
            type: 'card',
            priority: 'red',
            hint: 'Pode ser o mesmo cartão do Meta ou um diferente. Informe bandeira, 4 últimos dígitos e validade.',
          },
          {
            id: 'google_card_backup',
            label: 'Cartão de backup cadastrado no Google Ads?',
            type: 'boolean',
            priority: 'red',
          },
          {
            id: 'google_payment_mode',
            label: 'Modalidade de pagamento atual no Google Ads',
            type: 'select',
            priority: 'yellow',
            options: ['Pré-pago (crédito manual)', 'Pós-pago automático', 'Faturamento mensal'],
          },
        ],
      },

      // ── 5. Stape ──────────────────────────────────────────
      {
        id: 'stape',
        title: 'Stape.io e Conversions API (CAPI)',
        icon: 'cpu',
        hint: 'O Stape.io aumenta a precisão do rastreamento, especialmente para clientes afetados pelo bloqueio de cookies do iOS. Recomendado para contas com faturamento acima de R$50 mil/mês.',
        fields: [
          {
            id: 'use_stape',
            label: 'Cliente deseja implementar Stape.io / CAPI?',
            type: 'boolean',
            priority: 'yellow',
          },
          {
            id: 'stape_created',
            label: 'Conta Stape.io já criada?',
            type: 'boolean',
            priority: 'yellow',
            dependsOn: { field: 'use_stape', value: true },
          },
          {
            id: 'stape_login',
            label: 'E-mail de acesso ao Stape.io',
            type: 'email',
            priority: 'yellow',
            hint: 'E-mail cadastrado na conta do Stape.io para o gestor acessar.',
            placeholder: 'email@exemplo.com',
            dependsOn: { field: 'stape_created', value: true },
          },
          {
            id: 'stape_plan',
            label: 'Plano contratado no Stape',
            type: 'select',
            priority: 'yellow',
            options: ['Free', 'Básico', 'Pro'],
            dependsOn: { field: 'use_stape', value: true },
          },
          {
            id: 'stape_payment',
            label: 'Cartão de pagamento do Stape ativo?',
            type: 'boolean',
            priority: 'yellow',
            dependsOn: { field: 'use_stape', value: true },
          },
        ],
      },

      // ── 6. Looker / Dashboard ─────────────────────────────
      {
        id: 'looker',
        title: 'Dashboard Looker Studio',
        icon: 'bar-chart',
        hint: 'Todo cliente novo recebe um dashboard personalizado durante o onboarding. Precisamos da foto e das cores da marca para personalizar o painel.',
        fields: [
          {
            id: 'expert_photo_url',
            label: 'Link da foto profissional do expert (Google Drive)',
            type: 'url',
            priority: 'red',
            hint: 'Compartilhe a foto via Google Drive (qualidade mínima: 500×500 px, fundo neutro, sem texto). Clique com botão direito → "Compartilhar" → "Qualquer pessoa com o link". Cole o link aqui.',
            placeholder: 'https://drive.google.com/file/d/...',
          },
          {
            id: 'brand_colors',
            label: 'Cores principais da marca (códigos hexadecimais)',
            type: 'text',
            priority: 'red',
            hint: 'Informe os códigos hex separados por vírgula. Você encontra o código hex na identidade visual da marca (arquivo do designer) ou usando o site htmlcolorcodes.com.',
            placeholder: 'Ex.: #F29725, #1A1410, #FFFFFF',
          },
          {
            id: 'client_google_email',
            label: 'E-mail Google do cliente para compartilhar o Looker',
            type: 'email',
            priority: 'yellow',
            hint: 'Precisa ser um e-mail Google (Gmail ou G Suite) para que o cliente possa ver e filtrar o dashboard.',
            placeholder: 'cliente@gmail.com',
          },
          {
            id: 'wants_meeting',
            label: 'Deseja agendar uma reunião de apresentação do dashboard?',
            type: 'boolean',
            priority: 'yellow',
          },
        ],
      },

      // ── 7. Orçamento ──────────────────────────────────────
      {
        id: 'orcamento',
        title: 'Orçamento, Metas e Compromissos',
        icon: 'trending-up',
        hint: 'Defina números realistas. Metas muito agressivas sem orçamento compatível geram frustração. Em caso de dúvida, converse com seu gestor antes de preencher.',
        fields: [
          {
            id: 'total_budget',
            label: 'Orçamento total de mídia previsto (R$)',
            type: 'number',
            priority: 'red',
            hint: 'Soma de Meta Ads + Google Ads para o ciclo completo. Não inclui taxa de gestão.',
            placeholder: '5000',
          },
          {
            id: 'budget_distribution',
            label: 'Distribuição prevista entre captação, lembrete e remarketing',
            type: 'text',
            priority: 'red',
            hint: 'Sugestão para iniciantes: 70% captação / 15% lembrete / 15% remarketing. Altere somente se tiver base de leads robusta.',
            placeholder: '70% captação / 15% lembrete / 15% RMKT',
          },
          {
            id: 'max_cpl',
            label: 'CPL máximo aceitável (R$)',
            type: 'number',
            priority: 'red',
            hint: 'Custo por Lead máximo. Acima desse valor o gestor realoca o orçamento automaticamente. Exemplo: se quer 100 leads com R$1.000, o CPL máximo é R$10.',
            placeholder: '15',
          },
          {
            id: 'lead_goal',
            label: 'Meta de leads total para este ciclo',
            type: 'number',
            priority: 'red',
            hint: 'Número mínimo de leads para o seminário ser considerado um sucesso.',
            placeholder: '300',
          },
          {
            id: 'war_budget',
            label: 'Verba reservada para "guerra" pós-abertura do carrinho (R$)',
            type: 'number',
            priority: 'yellow',
            hint: 'Investimento extra nos últimos 2-3 dias para fechar carrinho. Sugestão: R$1.000 – R$3.000.',
            placeholder: '1000',
          },
          {
            id: 'previous_seminars',
            label: 'Quantos Seminários já realizou?',
            type: 'select',
            priority: 'yellow',
            options: ['Nenhum — este é o primeiro', '1–3 seminários', '4 ou mais seminários'],
          },
          {
            id: 'best_cpl',
            label: 'Melhor CPL obtido em ciclos anteriores (R$)',
            type: 'number',
            priority: 'yellow',
            hint: 'Benchmark interno para avaliar o desempenho das campanhas atuais.',
            placeholder: '12',
          },
          {
            id: 'has_lead_list',
            label: 'Possui lista de leads de seminários anteriores?',
            type: 'boolean',
            priority: 'yellow',
          },
          {
            id: 'lead_list_count',
            label: 'Quantidade de leads na lista',
            type: 'number',
            priority: 'yellow',
            placeholder: '500',
            dependsOn: { field: 'has_lead_list', value: true },
          },
          {
            id: 'lead_list_format',
            label: 'Formato do arquivo da lista',
            type: 'select',
            priority: 'yellow',
            options: ['CSV', 'Excel (.xlsx)'],
            dependsOn: { field: 'has_lead_list', value: true },
          },
        ],
      },

      // ── 8. Camadas de Conteúdo ────────────────────────────
      {
        id: 'camadas',
        title: 'Conteúdo Orgânico e Distribuição por Camadas',
        icon: 'layers',
        hint: 'As campanhas pagas funcionam em conjunto com o conteúdo orgânico. Sem postagens regulares, as camadas de remarketing (C2–C4) não têm base para rodar.',
        fields: [
          {
            id: 'organic_commitment',
            label: 'Cliente se compromete a produzir e postar conteúdo orgânico semanal?',
            type: 'boolean',
            priority: 'red',
            hint: 'Padrão mínimo: 2 Reels + 1 Carrossel por semana. Sem conteúdo orgânico constante, as camadas de aprofundamento (C2) e prova social (C3) não entregam resultado.',
          },
          {
            id: 'has_pauta_bank',
            label: 'Mantém banco de pautas (lista de temas a gravar)?',
            type: 'boolean',
            priority: 'red',
          },
          {
            id: 'pauta_bank_link',
            label: 'Link do banco de pautas',
            type: 'url',
            priority: 'yellow',
            hint: 'Link do Google Docs, Notion ou planilha com os temas planejados.',
            placeholder: 'https://docs.google.com/...',
            dependsOn: { field: 'has_pauta_bank', value: true },
          },
          {
            id: 'reels_stock',
            label: 'Estoque atual de Reels prontos para impulsionamento',
            type: 'number',
            priority: 'yellow',
            hint: 'Quantidade de Reels já gravados, editados e prontos para subir.',
            placeholder: '0',
          },
          {
            id: 'carrossel_stock',
            label: 'Estoque atual de Carrosséis prontos',
            type: 'number',
            priority: 'yellow',
            placeholder: '0',
          },
          {
            id: 'sends_organic_metrics',
            label: 'Cliente envia métricas dos posts orgânicos semanalmente?',
            type: 'boolean',
            priority: 'yellow',
            hint: 'Print do Instagram Insights toda segunda-feira. Sem dados orgânicos, fica impossível cruzar com a performance paga.',
          },
          {
            id: 'custom_layer_split',
            label: 'Quer adaptar a proporção padrão das camadas (C1/C2/C3/C4)?',
            type: 'boolean',
            priority: 'green',
          },
          {
            id: 'custom_split_value',
            label: 'Proporção personalizada das camadas',
            type: 'text',
            priority: 'green',
            hint: 'Padrão: C1=60% / C2=25% / C3=10% / C4=5%. Informe a proporção desejada.',
            placeholder: 'Ex.: 50/30/10/10',
            dependsOn: { field: 'custom_layer_split', value: true },
          },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // DESIGN GRÁFICO
  // ═══════════════════════════════════════════════════════════
  design_grafico: {
    version: 'design_grafico@1.0',
    label: 'Design Gráfico',
    sections: [

      {
        id: 'identificacao',
        title: 'Identificação do Projeto',
        icon: 'user',
        fields: [
          { id: 'expert_name',  label: 'Nome do cliente / expert', type: 'text', priority: 'red', placeholder: 'Ex.: Dr. João Silva' },
          { id: 'company_name', label: 'Nome do escritório / empresa', type: 'text', priority: 'red', placeholder: 'Ex.: Silva Consultoria' },
          { id: 'niche',        label: 'Nicho / área de atuação', type: 'text', priority: 'red', placeholder: 'Ex.: Direito Tributário' },
          { id: 'account_manager', label: 'Gestor responsável', type: 'text', priority: 'yellow', readonly: true, auto: true },
        ],
      },

      {
        id: 'identidade_visual',
        title: 'Identidade Visual',
        icon: 'layers',
        hint: 'Forneça os arquivos de marca. Quanto mais detalhado, menos retrabalho.',
        fields: [
          {
            id: 'has_brand_guide',
            label: 'Possui manual de identidade visual (brand guide)?',
            type: 'boolean',
            priority: 'red',
          },
          {
            id: 'brand_guide_url',
            label: 'Link do manual de identidade visual',
            type: 'url',
            priority: 'red',
            hint: 'Compartilhe via Google Drive ou Dropbox. O arquivo precisa estar acessível pelo link.',
            placeholder: 'https://drive.google.com/...',
            dependsOn: { field: 'has_brand_guide', value: true },
          },
          {
            id: 'logo_url',
            label: 'Link do logo em alta resolução (.ai, .svg ou .png fundo transparente)',
            type: 'url',
            priority: 'red',
            hint: 'O logo precisa estar em arquivo vetorial (.ai, .eps ou .svg) ou PNG com fundo transparente (mínimo 1000 px de largura).',
            placeholder: 'https://drive.google.com/...',
          },
          {
            id: 'brand_colors',
            label: 'Cores principais da marca (códigos hex)',
            type: 'text',
            priority: 'red',
            hint: 'Informe os códigos hex separados por vírgula. Se não souber, consulte o designer que criou a marca ou peça ao cliente.',
            placeholder: 'Ex.: #F29725, #1A1410, #FFFFFF',
          },
          {
            id: 'brand_fonts',
            label: 'Fontes utilizadas na marca',
            type: 'text',
            priority: 'yellow',
            hint: 'Nome exato das fontes. Exemplos: "Montserrat Bold" para títulos, "Inter Regular" para texto.',
            placeholder: 'Ex.: Montserrat (títulos), Inter (corpo)',
          },
        ],
      },

      {
        id: 'escopo',
        title: 'Escopo e Formatos',
        icon: 'cpu',
        hint: 'Quais peças precisam ser criadas? Marque todos os formatos necessários.',
        fields: [
          {
            id: 'formats_needed',
            label: 'Formatos necessários',
            type: 'text',
            priority: 'red',
            hint: 'Liste os formatos: Stories (9:16), Feed (1:1 ou 4:5), Carrossel, Banner web (1200×628), Apresentação PPT, etc.',
            placeholder: 'Ex.: 5 Stories + 3 Posts Feed + 2 Capas YouTube',
          },
          {
            id: 'quantity',
            label: 'Quantidade total de peças',
            type: 'number',
            priority: 'red',
            placeholder: '10',
          },
          {
            id: 'delivery_format',
            label: 'Formato de entrega dos arquivos',
            type: 'select',
            priority: 'red',
            options: ['PNG/JPG (prontos para uso)', 'PDF', 'Arquivo editável (.ai, .psd, .fig)', 'Todos os formatos acima'],
          },
          {
            id: 'deadline',
            label: 'Prazo de entrega desejado',
            type: 'date',
            priority: 'red',
          },
        ],
      },

      {
        id: 'referencias',
        title: 'Referências e Estilo',
        icon: 'search',
        hint: 'Referências visuais ajudam o designer a entender seu gosto. Sem referências, a equipe trabalhará com base nos padrões internos.',
        fields: [
          {
            id: 'style',
            label: 'Estilo visual desejado',
            type: 'select',
            priority: 'red',
            options: ['Minimalista / clean', 'Corporativo / sóbrio', 'Vibrante / chamativo', 'Elegante / premium', 'Jovem / moderno'],
          },
          {
            id: 'references_url',
            label: 'Link de referências visuais (Pinterest, Behance, Drive)',
            type: 'url',
            priority: 'yellow',
            hint: 'Crie um álbum no Pinterest ou pasta no Drive com exemplos de designs que você gosta.',
            placeholder: 'https://pinterest.com/... ou https://drive.google.com/...',
          },
          {
            id: 'competitors',
            label: 'Perfis de concorrentes para NÃO se parecer',
            type: 'text',
            priority: 'yellow',
            hint: 'Perfis do Instagram ou sites que devem ser evitados como referência.',
            placeholder: 'Ex.: @concorrente1, @concorrente2',
          },
          {
            id: 'text_content',
            label: 'Textos e copys já definidos para as peças?',
            type: 'boolean',
            priority: 'yellow',
          },
          {
            id: 'text_url',
            label: 'Link do documento com os textos',
            type: 'url',
            priority: 'yellow',
            hint: 'Google Docs ou Word com todos os textos prontos para incluir nas peças.',
            placeholder: 'https://docs.google.com/...',
            dependsOn: { field: 'text_content', value: true },
          },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // EDIÇÃO DE VÍDEO
  // ═══════════════════════════════════════════════════════════
  edicao_video: {
    version: 'edicao_video@1.0',
    label: 'Edição de Vídeo',
    sections: [

      {
        id: 'identificacao',
        title: 'Identificação do Projeto',
        icon: 'user',
        fields: [
          { id: 'expert_name',  label: 'Nome do cliente / expert', type: 'text', priority: 'red', placeholder: 'Ex.: Dr. João Silva' },
          { id: 'company_name', label: 'Nome do escritório / empresa', type: 'text', priority: 'red', placeholder: 'Ex.: Silva Consultoria' },
          { id: 'niche',        label: 'Nicho / área de atuação', type: 'text', priority: 'red', placeholder: 'Ex.: Direito Tributário' },
          { id: 'account_manager', label: 'Responsável', type: 'text', priority: 'yellow', readonly: true, auto: true },
        ],
      },

      {
        id: 'materiais',
        title: 'Materiais Brutos',
        icon: 'cpu',
        hint: 'Compartilhe os materiais brutos via Google Drive. Organize por pasta e nomeie os arquivos claramente.',
        fields: [
          {
            id: 'raw_footage_url',
            label: 'Link da pasta com os vídeos brutos (Google Drive)',
            type: 'url',
            priority: 'red',
            hint: 'Crie uma pasta no Google Drive com os arquivos de vídeo brutos. Dê acesso "Qualquer pessoa com o link pode visualizar". Nomeie os arquivos com sequência numérica (ex.: cena_01.mp4, cena_02.mp4).',
            placeholder: 'https://drive.google.com/drive/folders/...',
          },
          {
            id: 'has_script',
            label: 'Possui roteiro / script para guiar a edição?',
            type: 'boolean',
            priority: 'red',
          },
          {
            id: 'script_url',
            label: 'Link do roteiro / script',
            type: 'url',
            priority: 'red',
            hint: 'Google Docs com o roteiro completo. Inclua os pontos de corte e transições desejadas se souber.',
            placeholder: 'https://docs.google.com/...',
            dependsOn: { field: 'has_script', value: true },
          },
          {
            id: 'total_raw_duration',
            label: 'Duração total aproximada dos vídeos brutos (minutos)',
            type: 'number',
            priority: 'yellow',
            hint: 'Soma de todos os arquivos brutos. Ajuda o editor a estimar o tempo de edição.',
            placeholder: '30',
          },
        ],
      },

      {
        id: 'especificacoes',
        title: 'Especificações Técnicas',
        icon: 'layers',
        hint: 'Defina o formato de saída dos vídeos para evitar retrabalho de exportação.',
        fields: [
          {
            id: 'output_format',
            label: 'Plataforma de destino do vídeo',
            type: 'select',
            priority: 'red',
            options: ['Instagram Reels (9:16)', 'YouTube (16:9)', 'TikTok (9:16)', 'YouTube Shorts (9:16)', 'Múltiplos formatos'],
          },
          {
            id: 'target_duration',
            label: 'Duração alvo do vídeo editado (segundos ou minutos)',
            type: 'text',
            priority: 'red',
            hint: 'Exemplos: "30–60 seg" para Reels, "8–12 min" para YouTube.',
            placeholder: 'Ex.: 30–60 seg (Reels) ou 10 min (YouTube)',
          },
          {
            id: 'quantity',
            label: 'Quantidade de vídeos a editar',
            type: 'number',
            priority: 'red',
            placeholder: '5',
          },
          {
            id: 'needs_captions',
            label: 'Precisa de legendas?',
            type: 'boolean',
            priority: 'red',
          },
          {
            id: 'caption_style',
            label: 'Estilo das legendas',
            type: 'select',
            priority: 'red',
            options: ['Legenda padrão (branca com contorno)', 'Palavra por palavra (estilo TikTok)', 'Legenda nas cores da marca'],
            dependsOn: { field: 'needs_captions', value: true },
          },
        ],
      },

      {
        id: 'estilo',
        title: 'Estilo, Trilha e Referências',
        icon: 'bar-chart',
        fields: [
          {
            id: 'has_brand_kit',
            label: 'Possui kit de marca (vinheta, logo animado, template)?',
            type: 'boolean',
            priority: 'yellow',
          },
          {
            id: 'brand_kit_url',
            label: 'Link do kit de marca',
            type: 'url',
            priority: 'yellow',
            hint: 'Pasta com vinheta de abertura/fechamento, logo em PNG, fontes e eventuais templates de motion.',
            placeholder: 'https://drive.google.com/...',
            dependsOn: { field: 'has_brand_kit', value: true },
          },
          {
            id: 'music_preference',
            label: 'Preferência de trilha sonora',
            type: 'select',
            priority: 'yellow',
            options: ['Sem trilha (voz limpa)', 'Trilha instrumental suave', 'Trilha dinâmica / energética', 'Música indicada pelo cliente'],
          },
          {
            id: 'music_url',
            label: 'Link da música indicada',
            type: 'url',
            priority: 'yellow',
            hint: 'YouTube, Spotify ou arquivo no Drive. Atenção: use músicas sem direitos autorais (YouTube Audio Library ou Epidemic Sound).',
            placeholder: 'https://...',
            dependsOn: { field: 'music_preference', value: 'Música indicada pelo cliente' },
          },
          {
            id: 'reference_videos',
            label: 'Links de vídeos de referência (estilo desejado)',
            type: 'text',
            priority: 'yellow',
            hint: 'Cole links do YouTube ou Instagram de vídeos com o estilo de edição desejado.',
            placeholder: 'https://youtube.com/... , https://instagram.com/reel/...',
          },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SOCIAL MEDIA / COPY
  // ═══════════════════════════════════════════════════════════
  social_media: {
    version: 'social_media@1.0',
    label: 'Social Media / Copy',
    sections: [

      {
        id: 'identificacao',
        title: 'Identificação do Projeto',
        icon: 'user',
        fields: [
          { id: 'expert_name',  label: 'Nome do cliente / expert', type: 'text', priority: 'red', placeholder: 'Ex.: Dr. João Silva' },
          { id: 'company_name', label: 'Nome do escritório / empresa', type: 'text', priority: 'red', placeholder: 'Ex.: Silva Consultoria' },
          { id: 'niche',        label: 'Nicho / área de atuação', type: 'text', priority: 'red', placeholder: 'Ex.: Direito Tributário para MEIs' },
          { id: 'account_manager', label: 'Responsável', type: 'text', priority: 'yellow', readonly: true, auto: true },
        ],
      },

      {
        id: 'perfis',
        title: 'Perfis nas Redes Sociais',
        icon: 'target',
        hint: 'Forneça os links dos perfis onde o conteúdo será publicado.',
        fields: [
          {
            id: 'instagram_url',
            label: 'Link do perfil do Instagram',
            type: 'url',
            priority: 'red',
            placeholder: 'https://instagram.com/seuusuario',
          },
          {
            id: 'instagram_followers',
            label: 'Número atual de seguidores no Instagram',
            type: 'number',
            priority: 'yellow',
            placeholder: '1500',
          },
          {
            id: 'facebook_url',
            label: 'Link da Página do Facebook',
            type: 'url',
            priority: 'yellow',
            placeholder: 'https://facebook.com/suapagina',
          },
          {
            id: 'linkedin_url',
            label: 'Link do perfil do LinkedIn',
            type: 'url',
            priority: 'green',
            placeholder: 'https://linkedin.com/in/seuusuario',
          },
          {
            id: 'has_tiktok',
            label: 'Utiliza TikTok?',
            type: 'boolean',
            priority: 'green',
          },
          {
            id: 'tiktok_url',
            label: 'Link do TikTok',
            type: 'url',
            priority: 'green',
            placeholder: 'https://tiktok.com/@seuusuario',
            dependsOn: { field: 'has_tiktok', value: true },
          },
        ],
      },

      {
        id: 'voz_marca',
        title: 'Tom de Voz e Persona',
        icon: 'user',
        hint: 'O tom de voz define como a marca se comunica. Um tom inconsistente confunde o público.',
        fields: [
          {
            id: 'tone',
            label: 'Tom de voz principal',
            type: 'select',
            priority: 'red',
            options: ['Formal / técnico', 'Informal / próximo', 'Inspiracional / motivacional', 'Educativo / didático', 'Humorístico / leve'],
          },
          {
            id: 'target_audience',
            label: 'Público-alvo principal',
            type: 'text',
            priority: 'red',
            hint: 'Descreva o cliente ideal: profissão, faixa etária, dores e objetivos.',
            placeholder: 'Ex.: Advogados autônomos entre 30–50 anos que querem estruturar o escritório',
          },
          {
            id: 'keywords',
            label: 'Palavras-chave e expressões que DEVEM aparecer',
            type: 'text',
            priority: 'yellow',
            hint: 'Termos que o cliente usa com frequência e que identificam sua marca. Separe por vírgula.',
            placeholder: 'Ex.: compliance, planejamento tributário, segurança jurídica',
          },
          {
            id: 'forbidden_words',
            label: 'Palavras e expressões que NÃO devem ser usadas',
            type: 'text',
            priority: 'yellow',
            hint: 'Termos que o cliente não quer ver nos textos, por questão de posicionamento ou preferência.',
            placeholder: 'Ex.: "barato", "promoção", gírias informais',
          },
        ],
      },

      {
        id: 'calendario',
        title: 'Calendário e Frequência',
        icon: 'trending-up',
        fields: [
          {
            id: 'posts_per_week',
            label: 'Frequência de publicações por semana',
            type: 'select',
            priority: 'red',
            options: ['3 posts/semana', '5 posts/semana', '7 posts/semana (1 por dia)', 'Outro (especificar)'],
          },
          {
            id: 'content_mix',
            label: 'Mix de formatos de conteúdo',
            type: 'text',
            priority: 'red',
            hint: 'Proporção de cada formato. Recomendação: 40% educativo, 30% bastidores, 20% prova social, 10% venda.',
            placeholder: 'Ex.: 3 Reels + 2 Carrosséis + 2 Stories por semana',
          },
          {
            id: 'special_dates',
            label: 'Datas comemorativas relevantes para o nicho',
            type: 'text',
            priority: 'yellow',
            hint: 'Ex.: Dia do Advogado (11/08), Dia do Empreendedor (5/10), datas de eventos do setor.',
            placeholder: 'Ex.: Dia do Advogado (11/08), Semana Nacional do MEI',
          },
          {
            id: 'content_pauta',
            label: 'Já possui lista de temas / pautas definidos?',
            type: 'boolean',
            priority: 'yellow',
          },
          {
            id: 'pauta_url',
            label: 'Link da lista de pautas',
            type: 'url',
            priority: 'yellow',
            placeholder: 'https://docs.google.com/...',
            dependsOn: { field: 'content_pauta', value: true },
          },
        ],
      },

      {
        id: 'referencias',
        title: 'Referências Visuais e de Conteúdo',
        icon: 'search',
        fields: [
          {
            id: 'reference_accounts',
            label: 'Perfis de referência (estilo que admira)',
            type: 'text',
            priority: 'yellow',
            hint: 'Perfis do Instagram ou YouTube que o cliente acha que comunicam bem.',
            placeholder: 'Ex.: @leandokarnal, @caioporfirio',
          },
          {
            id: 'anti_reference_accounts',
            label: 'Perfis de concorrentes para NÃO se parecer',
            type: 'text',
            priority: 'yellow',
            placeholder: 'Ex.: @concorrente1, @concorrente2',
          },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // WEB DESIGN / AUTOMAÇÃO
  // ═══════════════════════════════════════════════════════════
  web_design_automacao: {
    version: 'web_design_automacao@1.0',
    label: 'Web Design / Automação',
    sections: [

      {
        id: 'identificacao',
        title: 'Identificação do Projeto',
        icon: 'user',
        fields: [
          { id: 'expert_name',  label: 'Nome do cliente / expert', type: 'text', priority: 'red', placeholder: 'Ex.: Dr. João Silva' },
          { id: 'company_name', label: 'Nome do escritório / empresa', type: 'text', priority: 'red', placeholder: 'Ex.: Silva Consultoria' },
          { id: 'niche',        label: 'Nicho / área de atuação', type: 'text', priority: 'red', placeholder: 'Ex.: Direito Tributário' },
          { id: 'account_manager', label: 'Responsável', type: 'text', priority: 'yellow', readonly: true, auto: true },
        ],
      },

      {
        id: 'objetivo',
        title: 'Objetivo e Escopo do Projeto',
        icon: 'target',
        hint: 'Descreva exatamente o que precisa ser criado ou modificado.',
        fields: [
          {
            id: 'project_type',
            label: 'Tipo de projeto',
            type: 'select',
            priority: 'red',
            options: [
              'Landing Page (página de captura)',
              'Landing Page de vendas',
              'Site institucional',
              'Automação de e-mail / CRM',
              'Integração entre plataformas',
              'Chatbot / WhatsApp',
              'Área de membros',
              'Outro',
            ],
          },
          {
            id: 'main_goal',
            label: 'Objetivo principal desta página / automação',
            type: 'text',
            priority: 'red',
            hint: 'Ex.: "Capturar leads para o seminário", "Vender o curso X", "Automatizar boas-vindas por e-mail".',
            placeholder: 'Ex.: Capturar leads para o Seminário Tributário de Junho',
          },
          {
            id: 'reference_pages',
            label: 'Links de páginas de referência (estilo desejado)',
            type: 'text',
            priority: 'yellow',
            hint: 'Cole links de landing pages ou sites que você gosta. Serve de guia para o designer.',
            placeholder: 'https://exemplo1.com , https://exemplo2.com',
          },
          {
            id: 'deadline',
            label: 'Prazo de entrega desejado',
            type: 'date',
            priority: 'red',
          },
        ],
      },

      {
        id: 'conteudo',
        title: 'Conteúdo e Textos',
        icon: 'layers',
        hint: 'A equipe pode criar os textos (copy) ou utilizar textos fornecidos pelo cliente.',
        fields: [
          {
            id: 'has_copy',
            label: 'Já possui os textos (copy) prontos?',
            type: 'boolean',
            priority: 'red',
            hint: 'Se sim, compartilhe o arquivo. Se não, inclua em escopo a produção de copy.',
          },
          {
            id: 'copy_url',
            label: 'Link do arquivo com os textos',
            type: 'url',
            priority: 'red',
            hint: 'Google Docs com headline, subtítulo, benefícios, depoimentos, FAQ e CTA.',
            placeholder: 'https://docs.google.com/...',
            dependsOn: { field: 'has_copy', value: true },
          },
          {
            id: 'media_url',
            label: 'Link de fotos e vídeos para usar na página',
            type: 'url',
            priority: 'red',
            hint: 'Pasta no Google Drive com foto do expert em alta resolução, vídeo de apresentação e demais imagens.',
            placeholder: 'https://drive.google.com/...',
          },
        ],
      },

      {
        id: 'tecnico',
        title: 'Aspectos Técnicos',
        icon: 'cpu',
        hint: 'Informações sobre hospedagem, domínio e plataformas utilizadas.',
        fields: [
          {
            id: 'domain',
            label: 'Domínio onde a página será publicada',
            type: 'text',
            priority: 'red',
            hint: 'Ex.: seminario.drjoaosilva.com.br. Se ainda não tem domínio, informe o domínio principal do site.',
            placeholder: 'Ex.: seminario.seusite.com.br',
          },
          {
            id: 'hosting_platform',
            label: 'Plataforma de hospedagem / construtora',
            type: 'select',
            priority: 'red',
            options: ['WordPress', 'Elementor (WordPress)', 'ClickFunnels', 'Hotmart Pages', 'Wix', 'Webflow', 'HTML puro', 'Outro'],
          },
          {
            id: 'has_hosting_access',
            label: 'Acesso ao painel de hospedagem / plataforma disponível?',
            type: 'boolean',
            priority: 'red',
            hint: 'A equipe precisa de acesso de administrador para publicar a página.',
          },
          {
            id: 'integrations',
            label: 'Integrações necessárias',
            type: 'text',
            priority: 'yellow',
            hint: 'Liste as ferramentas que precisam ser integradas. Ex.: Mailchimp, RD Station, ActiveCampaign, Hotmart, Stripe, WhatsApp.',
            placeholder: 'Ex.: RD Station + Hotmart + WhatsApp',
          },
          {
            id: 'pixel_meta',
            label: 'ID do Pixel Meta para instalação',
            type: 'text',
            priority: 'yellow',
            hint: 'Necessário para rastreamento de conversões nas campanhas de anúncios.',
            placeholder: 'Ex.: 1234567890',
          },
          {
            id: 'ga4_id',
            label: 'ID do Google Analytics 4 (GA4) para instalação',
            type: 'text',
            priority: 'yellow',
            hint: 'Formato: G-XXXXXXXXXX. Encontre em GA4 → Admin → Propriedade → Fluxos de dados.',
            placeholder: 'G-XXXXXXXXXX',
          },
        ],
      },
    ],
  },

};

// ─────────────────────────────────────────────────────────────
// Helpers exportados
// ─────────────────────────────────────────────────────────────

window.getBriefingRequiredFields = function (serviceType) {
  const tpl = window.BRIEFING_TEMPLATES[serviceType];
  if (!tpl) return [];
  return tpl.sections.flatMap(s => s.fields.filter(f => f.priority === 'red'));
};

window.validateBriefing = function (serviceType, answers) {
  const required = window.getBriefingRequiredFields(serviceType);
  const missing = [];

  for (const field of required) {
    if (field.readonly) continue;
    if (field.dependsOn) {
      const dep = answers[field.dependsOn.field];
      if (dep !== field.dependsOn.value) continue;
    }
    const val = answers[field.id];
    if (field.type === 'card') {
      if (!val || !val.brand || !val.last4 || val.last4.length < 4 || !val.expiry) {
        missing.push(field.id);
      }
    } else if (field.type === 'boolean') {
      // false é uma resposta válida para boolean — só inválido se null/undefined
      if (val === null || val === undefined) missing.push(field.id);
    } else if (val === null || val === undefined || val === '') {
      missing.push(field.id);
    }
  }

  return { valid: missing.length === 0, missing };
};
