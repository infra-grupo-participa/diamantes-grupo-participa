// Briefing obrigatório de EDIÇÃO DE VÍDEO (demanda com service_type = 'editor-video').
// Chaves ESTÁVEIS — iguais às de portal.video_briefing_missing(jsonb) (migration 095).
// Mudar uma chave aqui sem mudar no SQL quebra a criação da demanda.
//
// O prazo (data+hora) NÃO fica no jsonb: vai em p_due_at de create_demand.

export const VIDEO_SERVICE_TYPE = 'editor-video';
export const OTHER_SERVICE_TYPE = 'outro';

/** Limite por campo de texto (o card do ClickUp não pode inflar). */
export const VIDEO_TEXT_MAX = 4000;
/** Mínimo de caracteres dos textos obrigatórios ("usar o material inteiro" vale). */
export const VIDEO_TEXT_MIN = 3;

export const VIDEO_PECA_OPTIONS = [
  { value: 'criativo_anuncio', label: 'Criativo para anúncio' },
  { value: 'conteudo_organico', label: 'Conteúdo orgânico' },
  { value: 'corte', label: 'Corte' },
  { value: 'vsl_cpl', label: 'VSL / CPL' },
  { value: 'aula_completa', label: 'Aula completa' },
  { value: 'outro', label: 'Outro' },
] as const;

export const VIDEO_FORMATO_OPTIONS = [
  { value: '9x16', label: '9:16 (vertical)' },
  { value: '4x5', label: '4:5 (feed)' },
  { value: '16x9', label: '16:9 (horizontal)' },
  { value: '1x1', label: '1:1 (quadrado)' },
  { value: 'outro', label: 'Outro' },
] as const;

export const VIDEO_ARQUIVO_OPTIONS = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
] as const;

export type VideoPeca = (typeof VIDEO_PECA_OPTIONS)[number]['value'];
export type VideoFormato = (typeof VIDEO_FORMATO_OPTIONS)[number]['value'];
export type VideoArquivo = (typeof VIDEO_ARQUIVO_OPTIONS)[number]['value'];

/** Estado do formulário (tudo string/array — o que a tela edita). */
export type VideoBriefingDraft = {
  peca: VideoPeca | '';
  peca_outro: string;
  formatos: VideoFormato[];
  formato_outro: string;
  arquivo: VideoArquivo[];
  material_url: string;
  decupagem: string;
  direcao_visual: string;
  textos_tela: string;
  entrega_url: string;
  assets_url: string;
  observacoes: string;
};

/** Forma gravada em demands.briefing (jsonb). Campos opcionais vazios são omitidos. */
export type VideoBriefing = {
  peca: VideoPeca;
  peca_outro?: string;
  formatos: VideoFormato[];
  formato_outro?: string;
  arquivo: VideoArquivo[];
  material_url: string;
  decupagem: string;
  direcao_visual: string;
  textos_tela?: string;
  entrega_url?: string;
  assets_url?: string;
  observacoes?: string;
};

/** Chaves que podem vir apontadas como faltando/inválidas (cliente ou servidor). */
export type VideoBriefingField =
  | 'peca'
  | 'peca_outro'
  | 'formatos'
  | 'formato_outro'
  | 'arquivo'
  | 'material_url'
  | 'decupagem'
  | 'direcao_visual'
  | 'textos_tela'
  | 'entrega_url'
  | 'assets_url'
  | 'observacoes';

/** Ordem visual dos campos na tela — usada para focar o PRIMEIRO inválido. */
export const VIDEO_FIELD_ORDER: VideoBriefingField[] = [
  'peca',
  'peca_outro',
  'formatos',
  'formato_outro',
  'arquivo',
  'material_url',
  'decupagem',
  'direcao_visual',
  'textos_tela',
  'entrega_url',
  'assets_url',
  'observacoes',
];

export const VIDEO_FIELD_LABELS: Record<VideoBriefingField, string> = {
  peca: 'Peça',
  peca_outro: 'Qual peça',
  formatos: 'Proporções',
  formato_outro: 'Qual proporção',
  arquivo: 'Tipo de arquivo',
  material_url: 'Link do material bruto',
  decupagem: 'Decupagem / minutagem',
  direcao_visual: 'Direção visual e dinâmica',
  textos_tela: 'Textos na tela (headline e letterings)',
  entrega_url: 'Pasta de entrega (Drive)',
  assets_url: 'Assets / links específicos',
  observacoes: 'Observações extras',
};

export function emptyVideoBriefing(): VideoBriefingDraft {
  return {
    peca: '',
    peca_outro: '',
    formatos: [],
    formato_outro: '',
    arquivo: [],
    material_url: '',
    decupagem: '',
    direcao_visual: '',
    textos_tela: '',
    entrega_url: '',
    assets_url: '',
    observacoes: '',
  };
}

const HTTPS_RE = /^https:\/\/\S+$/i;

export function isHttpsUrl(v: string): boolean {
  return HTTPS_RE.test(v.trim());
}

/** Aviso NÃO bloqueante: link https que não é do Google Drive. */
export function isNonDriveUrl(v: string): boolean {
  const s = v.trim();
  if (!isHttpsUrl(s)) return false;
  try {
    const host = new URL(s).hostname.toLowerCase();
    return !(host === 'drive.google.com' || host === 'docs.google.com');
  } catch {
    return false;
  }
}

export type VideoBriefingErrors = Partial<Record<VideoBriefingField, string>>;

/** Validação client-side, espelho da tabela do plano (o servidor revalida). */
export function validateVideoBriefing(d: VideoBriefingDraft): VideoBriefingErrors {
  const e: VideoBriefingErrors = {};
  const tooLong = (s: string) => s.trim().length > VIDEO_TEXT_MAX;
  const tooLongMsg = `Máximo de ${VIDEO_TEXT_MAX} caracteres.`;

  if (!d.peca || !VIDEO_PECA_OPTIONS.some((o) => o.value === d.peca)) e.peca = 'Escolha a peça.';
  if (d.peca === 'outro') {
    if (!d.peca_outro.trim()) e.peca_outro = 'Descreva a peça.';
    else if (tooLong(d.peca_outro)) e.peca_outro = tooLongMsg;
  }

  const formatos = d.formatos.filter((f) => VIDEO_FORMATO_OPTIONS.some((o) => o.value === f));
  if (formatos.length === 0) e.formatos = 'Marque pelo menos uma proporção.';
  if (formatos.includes('outro')) {
    if (!d.formato_outro.trim()) e.formato_outro = 'Informe a proporção.';
    else if (tooLong(d.formato_outro)) e.formato_outro = tooLongMsg;
  }

  const arquivo = d.arquivo.filter((f) => VIDEO_ARQUIVO_OPTIONS.some((o) => o.value === f));
  if (arquivo.length === 0) e.arquivo = 'Marque pelo menos um tipo de arquivo.';

  if (!d.material_url.trim()) e.material_url = 'Informe o link do material bruto.';
  else if (!isHttpsUrl(d.material_url)) e.material_url = 'O link precisa começar com https://';
  else if (tooLong(d.material_url)) e.material_url = tooLongMsg;

  if (d.decupagem.trim().length < VIDEO_TEXT_MIN)
    e.decupagem = 'Descreva a decupagem (ou escreva "usar o material inteiro").';
  else if (tooLong(d.decupagem)) e.decupagem = tooLongMsg;

  if (d.direcao_visual.trim().length < VIDEO_TEXT_MIN) e.direcao_visual = 'Descreva a direção visual e a dinâmica.';
  else if (tooLong(d.direcao_visual)) e.direcao_visual = tooLongMsg;

  if (d.entrega_url.trim()) {
    if (!isHttpsUrl(d.entrega_url)) e.entrega_url = 'O link precisa começar com https://';
    else if (tooLong(d.entrega_url)) e.entrega_url = tooLongMsg;
  }
  if (tooLong(d.textos_tela)) e.textos_tela = tooLongMsg;
  if (tooLong(d.assets_url)) e.assets_url = tooLongMsg;
  if (tooLong(d.observacoes)) e.observacoes = tooLongMsg;

  return e;
}

/** Monta o jsonb de demands.briefing a partir do rascunho (trim, omite opcionais vazios). */
export function buildVideoBriefing(d: VideoBriefingDraft): VideoBriefing {
  const opt = (s: string) => {
    const t = s.trim();
    return t ? t : undefined;
  };
  const formatos = VIDEO_FORMATO_OPTIONS.map((o) => o.value).filter((v) => d.formatos.includes(v));
  const arquivo = VIDEO_ARQUIVO_OPTIONS.map((o) => o.value).filter((v) => d.arquivo.includes(v));
  const out: VideoBriefing = {
    peca: d.peca as VideoPeca,
    formatos,
    arquivo,
    material_url: d.material_url.trim(),
    decupagem: d.decupagem.trim(),
    direcao_visual: d.direcao_visual.trim(),
  };
  if (d.peca === 'outro') out.peca_outro = opt(d.peca_outro);
  if (formatos.includes('outro')) out.formato_outro = opt(d.formato_outro);
  out.textos_tela = opt(d.textos_tela);
  out.entrega_url = opt(d.entrega_url);
  out.assets_url = opt(d.assets_url);
  out.observacoes = opt(d.observacoes);
  // JSON.stringify já descarta undefined, mas o objeto fica limpo para quem o inspecionar.
  (Object.keys(out) as Array<keyof VideoBriefing>).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

/**
 * Lê a mensagem de erro do servidor e devolve as chaves do briefing citadas nela.
 * Tolerante ao formato: procura cada chave conhecida como palavra inteira
 * (ex.: "briefing_incompleto: material_url,peca" → ['peca', 'material_url']).
 * `peca` não casa dentro de `peca_outro` (fronteira inclui "_").
 */
export function parseBriefingErrorKeys(message: string | null | undefined): VideoBriefingField[] {
  if (!message) return [];
  const msg = message.toLowerCase();
  return VIDEO_FIELD_ORDER.filter((k) => new RegExp(`(^|[^a-z0-9_])${k}([^a-z0-9_]|$)`).test(msg));
}

/** O erro do servidor fala do prazo (p_due_at / dias úteis)? */
export function isDueError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /due_at|prazo|dias?\s+[úu]te(is|l)|business/i.test(message);
}

/** Rótulo pt-BR de um valor do briefing (para exibição em leitura). */
export function videoOptionLabel(field: 'peca' | 'formatos' | 'arquivo', value: string): string {
  const list =
    field === 'peca' ? VIDEO_PECA_OPTIONS : field === 'formatos' ? VIDEO_FORMATO_OPTIONS : VIDEO_ARQUIVO_OPTIONS;
  return (list as ReadonlyArray<{ value: string; label: string }>).find((o) => o.value === value)?.label ?? value;
}

// ── Prazo (fuso de São Paulo, UTC-3 fixo desde o fim do horário de verão em 2019) ──

/** "YYYY-MM-DD" + "HH:MM" (hora de Brasília) → ISO timestamptz. */
export function spDateTimeToIso(ymd: string, hm: string): string {
  return `${ymd}T${hm}:00-03:00`;
}
