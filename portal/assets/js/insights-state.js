/**
 * insights-state.js — Shared mutable state, storage keys, and schema constants.
 *
 * All modules read/write the same `state` object — no circular deps because
 * only insights-state.js owns it; everything else imports it.
 */

export const RATINGS_KEY          = "gp_service_ratings_v1";
export const TASK_REVIEWS_KEY     = "gp_task_reviews_v1";
export const CONTRACT_REGISTRY_KEY = "gp_contract_registry_v1";
export const CONTRACT_STATUS_KEY  = "gp_contract_status_v1";
export const CLIENT_PROFILES_KEY  = "gp_client_profiles_v1";
export const CLIENT_CONTEXT_KEY   = "gp_client_context_v1";

export const SCORE_META = [
  { min: 1, max: 2, label: "Péssimo",   tone: "terrible" },
  { min: 3, max: 4, label: "Ruim",      tone: "bad"      },
  { min: 5, max: 6, label: "Razoável",  tone: "fair"     },
  { min: 7, max: 8, label: "Bom",       tone: "good"     },
  { min: 9, max: 10, label: "Excelente", tone: "great"   }
];

export const SERVICE_LABELS = {
  "AUTOMAÇÃO":        "Automação",
  "EDIÇÃO":           "Edição de vídeo",
  "EDIÇÃO DE VÍDEO":  "Edição de vídeo",
  "DESENVOLVEDOR WEB":"Webdesigner",
  "ANÚNCIOS PAGOS":   "Anúncios Pagos",
  "WEBDESIGNER":      "Webdesigner",
  "DESIGNER":         "Designer",
  "SOCIAL MEDIA":     "Social Media",
  "COPY":             "Copywriter",
  "COPYWRITER":       "Copywriter",
  "HOST":             "Host"
};

export const CLIENT_PROFILE_SCHEMA = [
  {
    title: "Canais e páginas",
    fields: [
      { key: "instagram",       label: "Qual seu Instagram?",                               type: "text", placeholder: "@seuinstagram" },
      { key: "facebook",        label: "Qual seu Facebook?",                                type: "text", placeholder: "facebook.com/seuperfil" },
      { key: "youtube",         label: "Qual seu YouTube?",                                 type: "text", placeholder: "youtube.com/@seucanal" },
      { key: "siteUrl",         label: "Qual o endereço do seu site?",                      type: "url",  placeholder: "https://seusite.com.br" },
      { key: "capturePageUrl",  label: "Qual o endereço da página de captura do seminário?",type: "url",  placeholder: "https://..." },
      { key: "thankYouPageUrl", label: "Qual o endereço da página de obrigado do seminário?",type: "url", placeholder: "https://..." },
      { key: "driveUrl",        label: "Qual o link do Drive desse cliente?",               type: "url",  placeholder: "https://drive.google.com/..." },
    ]
  },
  {
    title: "Datas do próximo seminário",
    fields: [
      { key: "seminarDay1Date",  label: "Data do dia 1 do próximo seminário",          type: "date" },
      { key: "pitchDate",        label: "Data do pitch",                                type: "date" },
      { key: "cartCloseDate",    label: "Data do fechamento de carrinho",               type: "date" },
      { key: "testsStartDate",   label: "Data do dia 1 dos testes de captação",         type: "date" },
      { key: "scaleStartDate",   label: "Data do dia 1 da escala de captação",          type: "date" },
      { key: "lastSeminarDate",  label: "Quando foi seu último seminário?",             type: "date" },
    ]
  },
  {
    title: "Captação e mídia",
    fields: [
      { key: "acquisitionChannels",           label: "Captação no Google e Meta?",                       type: "multicheck", options: [{ value: "google", label: "Google" }, { value: "meta", label: "Meta" }] },
      { key: "acquisitionInvestment",         label: "Valor a ser investido em captação",                type: "text", placeholder: "Ex.: 5000" },
      { key: "acquisitionGoogleShare",        label: "Proporção do Google na captação",                  type: "text", placeholder: "Ex.: 40%" },
      { key: "acquisitionMetaShare",          label: "Proporção da Meta na captação",                    type: "text", placeholder: "Ex.: 60%" },
      { key: "contentDistributionEnabled",    label: "Existe investimento em distribuição de conteúdo?", type: "toggle" },
      { key: "contentDistributionAmount",     label: "Se sim, quanto será investido em distribuição?",   type: "text", placeholder: "Ex.: 1500" },
      { key: "contentDistributionGoogleShare",label: "Proporção do Google na distribuição",              type: "text", placeholder: "Ex.: 30%" },
      { key: "contentDistributionMetaShare",  label: "Proporção da Meta na distribuição",                type: "text", placeholder: "Ex.: 70%" },
      { key: "targetRegion",                  label: "Sua captação será direcionada para qual região?",  type: "text", placeholder: "Cidade, estado ou região" },
    ]
  },
  {
    title: "Metas e ferramentas",
    fields: [
      { key: "lastSeminarLeads",  label: "Quantos leads captou no último seminário?",         type: "text", placeholder: "Ex.: 320" },
      { key: "targetLeads",       label: "Quantos leads pretende captar?",                     type: "text", placeholder: "Ex.: 500" },
      { key: "emailMarketingTool",label: "Qual ferramenta de e-mail marketing você usa?",      type: "text", placeholder: "Ex.: ActiveCampaign" },
      { key: "pageBuilder",       label: "Qual construtor de páginas você usa?",               type: "text", placeholder: "Ex.: Elementor" },
      { key: "whatsappApiEnabled",label: "Você usa API do WhatsApp?",                          type: "toggle" },
      { key: "whatsappApiTool",   label: "Se sim, por qual ferramenta?",                       type: "text", placeholder: "Ex.: Z-API" },
    ]
  }
];

export const GLOBAL_ASSIGNEE_IDS = {
  "ALEXANDRE MAGNO":    81934453,
  "MATEUS CASTRO":      81934455,
  "JADSON":             81934456,
  "VINÍCIUS PEREIRA":   81934459,
  "LUIS FERNANDO":      81934454,
  "MANUELA RIOS":       84099161,
  "CAIO MARCONDES":     84118999,
  "MARCOS PAULO":       118013882,
  "GABRIEL MENEZES":    84782862,
  "ELAINE MONTENEGRO":  90616609,
  "RENAN SCHWARZ":      106071076,
  "JUNIOR":             111931366,
  "GABRIEL ALVES":      230453991
};

export const LEGACY_TIPO_OPTION_ALIASES = {
  "AUTOMAÇÃO":      ["AUTOMAÇÃO", "AUTOMACAO"],
  "WEBDESIGNER":    ["WEBDESIGNER", "WEB DESIGNER", "PÁGINA", "PAGINA"],
  "EDIÇÃO DE VÍDEO":["EDIÇÃO DE VÍDEO", "EDICAO DE VIDEO", "EDIÇÃO", "EDICAO", "VÍDEO", "VIDEO"],
  "ANÚNCIOS PAGOS": ["ANÚNCIOS PAGOS", "ANUNCIOS PAGOS", "TRÁFEGO", "TRAFEGO"],
  "DESIGNER":       ["DESIGNER"],
  "SOCIAL MEDIA":   ["SOCIAL MEDIA"],
  "COPYWRITER":     ["COPYWRITER", "COPY"],
  "HOST":           ["HOST"],
};

/** Runtime mutable state shared across all modules. */
export const state = {
  modalReady:            false,
  reviewModalReady:      false,
  activeTaskId:          null,
  activeReviewTaskId:    null,
  reviewTask:            null,
  pendingQueue:          [],
  context:               null,
  initialized:           false,
  initPromise:           null,
  currentAreaFilter:     "all",
  openingTaskFiles:      [],
  chatMentionReady:      false,
  chatMention:           null,
  store: {
    [RATINGS_KEY]:           [],
    [TASK_REVIEWS_KEY]:      [],
    [CONTRACT_REGISTRY_KEY]: null,
    [CONTRACT_STATUS_KEY]:   {},
    [CLIENT_PROFILES_KEY]:   {},
    [CLIENT_CONTEXT_KEY]:    {}
  },
  tipoOptionsHydrated:   false,
  tipoOptionsPromise:    null,
  portalRefreshTimer:    null,
  portalRefreshBusy:     false,
  portalRefreshBound:    false,
  /** Dependency-injection config set via PortalInsights.configure(). */
  config: {
    apiKey:            null,
    assigneeIds:       null,
    assigneeTypeById:  null,
    autoMap:           null,
  }
};
