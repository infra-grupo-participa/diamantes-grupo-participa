// Núcleo de chat de demandas — port de assets/js/demand-chat-api.js.
// Mensagens (com join em portal.users), realtime, e anexos no bucket
// 'demand-attachments'. RLS protege via portal.can_access_demand(demand_id).

import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

const BUCKET = 'demand-attachments';
const SIGNED_URL_TTL = 3600;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Anexos por mensagem (chat) ou por demanda nova (modal de criação). */
export const MAX_FILES = 5;

/** Valor do `accept` do <input type="file"> — espelha ACCEPTED_MIME/ACCEPTED_EXT. */
export const ACCEPT_ATTR = 'image/*,.heic,.heif,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip';

// Tipos aceitos (espelha o accept do <input>): imagens, PDF, docs, planilhas, txt, zip.
const ACCEPTED_MIME = /^(image\/|application\/pdf$|application\/msword$|application\/vnd\.openxmlformats|application\/vnd\.ms-excel$|text\/csv$|text\/plain$|application\/zip$|application\/x-zip-compressed$)/;
const ACCEPTED_EXT = /\.(png|jpe?g|gif|webp|svg|heic|heif|avif|pdf|docx?|xlsx?|csv|txt|zip)$/i;

export function isAcceptedFile(file: File): boolean {
  if (file.type && ACCEPTED_MIME.test(file.type)) return true;
  // Alguns navegadores não preenchem o mime: cai pra extensão.
  return ACCEPTED_EXT.test(file.name || '');
}

// O bucket valida pelo content-type declarado. Quando o navegador não informa o
// mime (acontece com .heic e alguns downloads), deduzir pela extensão evita cair
// em application/octet-stream — que o bucket recusa, e o cliente via só "falha no upload".
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif',
  avif: 'image/avif', pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
};

function contentTypeOf(file: File): string {
  if (file.type && ACCEPTED_MIME.test(file.type)) {
    // Windows manda .zip como x-zip-compressed; normaliza pro tipo canônico.
    return file.type === 'application/x-zip-compressed' ? 'application/zip' : file.type;
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

export type Attachment = {
  path: string;
  name: string;
  size: number;
  mime: string;
  signedUrl?: string | null;
  url?: string | null;
};

export type ChatMessage = {
  id: string;
  user_id: number | null;
  content: string | null;
  attachments: Attachment[];
  origin?: string | null;
  created_at: string;
  author_name: string | null;
  author_role: string | null;
  avatar_url: string | null;
  _pending?: boolean; // UI otimista: aguardando confirmação do envio
  _failed?: boolean; // UI otimista: falhou ao enviar
  _localKey?: string; // key de render estável (id do servidor troca temp→real)
};

function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot === -1 ? name : name.slice(0, dot)).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  const ext = (dot === -1 ? '' : name.slice(dot)).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return (base || 'arquivo') + ext;
}

function randomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function isImage(mime?: string | null): boolean {
  return /^image\//.test(mime || '');
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/** Lista mensagens da demanda (ordem crescente) já com nome/role/avatar do autor.
 *  Via RPC SECURITY DEFINER: o cliente não lê portal.users de outros (RLS), então
 *  o nome do operador/admin precisa vir resolvido do servidor. */
export async function listMessages(demandId: string): Promise<ChatMessage[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_demand_messages', { p_demand_id: demandId });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    content: m.content,
    attachments: Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : [],
    origin: m.origin,
    created_at: m.created_at,
    clickup_comment_id: m.clickup_comment_id,
    author_name: (m.author_name as string) || null,
    author_role: (m.author_role as string) || null,
    avatar_url: (m.avatar_url as string) || null,
  } as ChatMessage));
}

/** Busca UMA mensagem por id (com autor + anexos hidratados). Usada no append
 *  incremental do realtime, evitando re-hidratar signed URLs de todas. */
export async function getMessage(messageId: string): Promise<ChatMessage | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('get_demand_message', { p_message_id: messageId });
  if (error) throw error;
  const m = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!m) return null;

  const atts = Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : [];
  return {
    id: m.id,
    user_id: m.user_id,
    content: m.content,
    attachments: atts.length ? await hydrateAttachments(atts) : [],
    origin: m.origin,
    created_at: m.created_at,
    clickup_comment_id: m.clickup_comment_id,
    author_name: (m.author_name as string) || null,
    author_role: (m.author_role as string) || null,
    avatar_url: (m.avatar_url as string) || null,
  } as ChatMessage;
}

/**
 * Insere mensagem em demand_messages. A sincronização do comentário para o
 * ClickUp é feita NO BANCO (trigger messages_clickup_sync → Edge Function
 * clickup-comment-sync), NÃO aqui — postar daqui também duplicaria o comentário.
 * `userId` (portal.users.id) é resolvido pelo caller.
 */
export async function postMessage(
  demandId: string,
  content: string,
  attachments: Attachment[],
  userId: number,
  _clientSlug?: string,
): Promise<unknown> {
  const text = (content || '').trim();
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  if (!text && !hasAttachments) return null;
  if (!userId) throw new Error('userId obrigatório para postMessage.');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('demand_messages')
    .insert({
      demand_id: demandId,
      user_id: userId,
      content: text,
      attachments: hasAttachments ? attachments : [],
    })
    .select()
    .single();
  if (error) throw error;
  // Sem fetch pro ClickUp aqui: a trigger messages_clickup_sync no banco já
  // publica o comentário via Edge Function. Postar daqui causaria duplicidade.
  return data;
}

/** Realtime: INSERT em demand_messages + UPDATE em demands, ambos filtrados pela demanda.
 *  `onStatus(true)` quando o canal está inscrito e saudável; `false` em erro/fechamento —
 *  o caller usa isso para só acionar o poll de segurança quando o realtime está caído. */
export function subscribe(
  demandId: string,
  callbacks: {
    onMessage?: (row: Record<string, unknown>) => void;
    onDemandUpdate?: (row: Record<string, unknown>) => void;
    onStatus?: (connected: boolean) => void;
  },
): () => void {
  const supabase = createClient();
  const channel: RealtimeChannel = supabase
    .channel('demand:' + demandId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'portal', table: 'demand_messages', filter: 'demand_id=eq.' + demandId },
      (payload) => {
        callbacks.onMessage?.(payload.new as Record<string, unknown>);
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'portal', table: 'demands', filter: 'id=eq.' + demandId },
      (payload) => {
        callbacks.onDemandUpdate?.(payload.new as Record<string, unknown>);
      },
    )
    .subscribe((status) => {
      callbacks.onStatus?.(status === 'SUBSCRIBED');
    });
  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* ignora */
    }
  };
}

/** Sobe arquivo (<=10 MB) e devolve metadados + signed URL para inserir em demand_messages.attachments. */
export async function uploadAttachment(demandId: string, file: File): Promise<Attachment> {
  if (!file) throw new Error('Selecione um arquivo.');
  if (file.size > MAX_FILE_SIZE) throw new Error('Arquivo maior que 10 MB.');
  const supabase = createClient();
  const name = safeFileName(file.name || 'arquivo');
  const path = `${demandId}/${randomId()}-${name}`;
  const mime = contentTypeOf(file);
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: mime,
  });
  if (upErr) throw upErr;

  const { data: signed, error: sigErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (sigErr) throw sigErr;

  return {
    path,
    name: file.name,
    size: file.size,
    mime,
    signedUrl: signed?.signedUrl || null,
  };
}

/** Re-assina uma URL a partir do `path` salvo. */
export async function signAttachment(path: string, ttlSec = SIGNED_URL_TTL): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(path, ttlSec);
  if (error) return null;
  return data?.signedUrl || null;
}

/** Re-assina anexos que vieram só com `path` (lidos do BD). */
export async function hydrateAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  // Assina todos em paralelo — antes era um round-trip sequencial por anexo (N+1).
  return Promise.all(
    attachments.map(async (a) => {
      if (!a || a.signedUrl) return a;
      const url = await signAttachment(a.path);
      return { ...a, signedUrl: url };
    }),
  );
}

export const CHAT_CONFIG = { BUCKET, SIGNED_URL_TTL, MAX_FILE_SIZE };
