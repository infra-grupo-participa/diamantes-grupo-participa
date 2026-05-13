/**
 * demand-chat-api.js — núcleo compartilhado de chat de demandas.
 *
 * Reaproveitado por:
 *   - portal/assets/portal-api.js (cliente)
 *   - operator/assets/operator-api.js (operador)
 *
 * Não conhece a identidade do usuário (cliente vs operador); cada caller
 * resolve `userId` antes de chamar `postMessage`. Acesso é controlado por
 * RLS via portal.can_access_demand(demand_id) — ver db/migrations/003_*.
 *
 * Expõe window.DemandChatAPI:
 *   - listMessages(demandId)              → [{ id, content, attachments, author_name, author_role, avatar_url, created_at }]
 *   - postMessage(demandId, content, attachments, userId)  → message inserida
 *   - subscribe(demandId, { onMessage, onDemandUpdate })   → unsubscribe()
 *   - uploadAttachment(demandId, file)    → { path, name, size, mime, signedUrl }
 *   - signAttachment(path, ttlSec = 3600) → signedUrl
 */
(function () {
  'use strict';

  const BUCKET = 'demand-attachments';
  const SIGNED_URL_TTL = 3600;
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  function client() {
    return window.getSupabaseClient();
  }

  function safeFileName(name) {
    const dot = name.lastIndexOf('.');
    const base = (dot === -1 ? name : name.slice(0, dot)).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    const ext = (dot === -1 ? '' : name.slice(dot)).toLowerCase().replace(/[^a-z0-9.]/g, '');
    return (base || 'arquivo') + ext;
  }

  function randomId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function listMessages(demandId) {
    const supabase = client();
    const { data: msgs, error } = await supabase
      .from('demand_messages')
      .select('id, user_id, content, attachments, origin, created_at')
      .eq('demand_id', demandId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!msgs || msgs.length === 0) return [];

    const ids = [...new Set(msgs.map(m => m.user_id).filter(Boolean))];
    let usersById = {};
    if (ids.length) {
      const { data: users } = await supabase
        .from('users').select('id, name, role, metadata').in('id', ids);
      usersById = Object.fromEntries((users || []).map(u => [u.id, u]));
    }
    return msgs.map(m => {
      const u = usersById[m.user_id] || {};
      return Object.assign({}, m, {
        author_name: u.name || null,
        author_role: u.role || null,
        avatar_url:  u.metadata?.avatar_url || null,
      });
    });
  }

  async function postMessage(demandId, content, attachments, userId) {
    const text = (content || '').trim();
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    if (!text && !hasAttachments) return null;
    if (!userId) throw new Error('userId obrigatório para postMessage.');

    const { data, error } = await client()
      .from('demand_messages')
      .insert({
        demand_id:   demandId,
        user_id:     userId,
        content:     text,
        attachments: hasAttachments ? attachments : [],
      })
      .select().single();
    if (error) throw error;
    return data;
  }

  function subscribe(demandId, callbacks) {
    const supabase = client();
    const onMessage      = callbacks?.onMessage;
    const onDemandUpdate = callbacks?.onDemandUpdate;
    const channel = supabase.channel('demand:' + demandId)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'portal', table: 'demand_messages', filter: 'demand_id=eq.' + demandId },
          (payload) => { if (onMessage) onMessage(payload.new); })
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'portal', table: 'demands', filter: 'id=eq.' + demandId },
          (payload) => { if (onDemandUpdate) onDemandUpdate(payload.new); })
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch (_) {} };
  }

  async function uploadAttachment(demandId, file) {
    if (!file) throw new Error('Selecione um arquivo.');
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('Arquivo maior que 10 MB.');
    }
    const supabase = client();
    const name = safeFileName(file.name || 'arquivo');
    const path = `${demandId}/${randomId()}-${name}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
    if (upErr) throw upErr;

    const { data: signed, error: sigErr } = await supabase.storage.from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (sigErr) throw sigErr;

    return {
      path,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      signedUrl: signed?.signedUrl || null,
    };
  }

  async function signAttachment(path, ttlSec) {
    if (!path) return null;
    const { data, error } = await client().storage.from(BUCKET)
      .createSignedUrl(path, ttlSec || SIGNED_URL_TTL);
    if (error) return null;
    return data?.signedUrl || null;
  }

  async function postMessageWithClickup(demandId, content, attachments, userId, clientSlug) {
    const saved = await postMessage(demandId, content, attachments, userId);

    // Dispara sync para o ClickUp em background — falha não bloqueia o cliente
    try {
      const supabase = client();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const body = { demand_id: demandId, client_slug: clientSlug, content, attachments: attachments || [] };
        fetch('/api/clickup-comment.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + session.access_token,
          },
          body: JSON.stringify(body),
        }).catch(() => {});
      }
    } catch (_) {}

    return saved;
  }

  window.DemandChatAPI = {
    listMessages,
    postMessage,
    postMessageWithClickup,
    subscribe,
    uploadAttachment,
    signAttachment,
    _config: { BUCKET, SIGNED_URL_TTL, MAX_FILE_SIZE },
  };
})();
