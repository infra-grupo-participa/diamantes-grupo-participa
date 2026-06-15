// Núcleo de chat de demandas — port de assets/js/demand-chat-api.js.
// Mensagens (com join em portal.users), realtime, e anexos no bucket
// 'demand-attachments'. RLS protege via portal.can_access_demand(demand_id).

import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

const BUCKET = 'demand-attachments';
const SIGNED_URL_TTL = 3600;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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

/** Lista mensagens da demanda (ordem crescente) com info do autor (join users). */
export async function listMessages(demandId: string): Promise<ChatMessage[]> {
  const supabase = createClient();
  const { data: msgs, error } = await supabase
    .from('demand_messages')
    .select('id, user_id, content, attachments, origin, created_at')
    .eq('demand_id', demandId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!msgs || msgs.length === 0) return [];

  const ids = [...new Set(msgs.map((m) => m.user_id).filter(Boolean))] as number[];
  let usersById: Record<number, { name?: string; role?: string; metadata?: { avatar_url?: string } }> = {};
  if (ids.length) {
    const { data: users } = await supabase.from('users').select('id, name, role, metadata').in('id', ids);
    usersById = Object.fromEntries((users || []).map((u) => [u.id, u]));
  }

  return msgs.map((m) => {
    const u = usersById[m.user_id as number] || {};
    return {
      ...m,
      attachments: Array.isArray(m.attachments) ? (m.attachments as Attachment[]) : [],
      author_name: u.name || null,
      author_role: u.role || null,
      avatar_url: u.metadata?.avatar_url || null,
    } as ChatMessage;
  });
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

/** Realtime: INSERT em demand_messages + UPDATE em demands, ambos filtrados pela demanda. */
export function subscribe(
  demandId: string,
  callbacks: { onMessage?: (row: Record<string, unknown>) => void; onDemandUpdate?: (row: Record<string, unknown>) => void },
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
    .subscribe();
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
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (upErr) throw upErr;

  const { data: signed, error: sigErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (sigErr) throw sigErr;

  return {
    path,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
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
  const out: Attachment[] = [];
  for (const a of attachments) {
    if (!a) {
      out.push(a);
      continue;
    }
    if (a.signedUrl) {
      out.push(a);
      continue;
    }
    const url = await signAttachment(a.path);
    out.push({ ...a, signedUrl: url });
  }
  return out;
}

export const CHAT_CONFIG = { BUCKET, SIGNED_URL_TTL, MAX_FILE_SIZE };
