/**
 * operator/assets/demandas.js — controlador da página Demandas do operador.
 *
 * Responsabilidades:
 *   - Auth: OperatorAPI.requireOperator()
 *   - Lista de demandas via v_my_assigned_demands com filtros por status
 *   - Painel direito com chat (via DemandChatAPI + ChatComposer) e detalhes
 *   - Mudança de status (sync ClickUp via trigger SQL existente)
 *   - Realtime: subscribe na demanda atual + recarrega lista quando uma
 *     demanda da minha lista é atualizada
 */
(function () {
  'use strict';

  const STATUS_LABEL = {
    open:        'Nova',
    in_progress: 'Em andamento',
    review:      'Em revisão',
    done:        'Concluída',
    canceled:    'Cancelada',
  };
  const STATUS_TAG = {
    open:        'new',
    in_progress: 'in_progress',
    review:      'review',
    done:        'done',
    canceled:    'done',
  };
  const STATUS_TABS = ['all', 'open', 'in_progress', 'review', 'done'];
  const STATUS_TAB_LABEL = {
    all:         'Todas',
    open:        'Novas',
    in_progress: 'Em andamento',
    review:      'Em revisão',
    done:        'Concluídas',
  };

  const state = {
    me:         null,
    demands:    [],
    currentId:  null,
    filter:     'all',
    search:     '',
    messages:   {},
    unsubscribe: null,
  };

  function $(sel) { return document.querySelector(sel); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function initials(name) {
    return String(name || 'OP').split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'OP';
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)      return 'agora';
    if (diff < 3600)    return Math.floor(diff / 60) + ' min';
    if (diff < 86400)   return Math.floor(diff / 3600) + 'h';
    if (diff < 604800)  return Math.floor(diff / 86400) + 'd';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function daysUntil(date) {
    if (!date) return null;
    return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
  }

  function inferIconClass(title) {
    const t = String(title || '').toLowerCase();
    if (/v[ií]deo|edi[cç]?[aã]?o|reels?|youtube|live/.test(t)) return 'video';
    if (/site|web|landing|p[aá]gina|html|wordpress/.test(t))   return 'web';
    if (/tr[áa]fego|ads|meta|google|campanha/.test(t))         return 'traf';
    if (/automa[çc][aã]o|email|fluxo|crm/.test(t))             return 'auto';
    if (/social|instagram|tiktok|post/.test(t))                return 'social';
    return 'design';
  }
  function iconSvg(cls) {
    const m = {
      design: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>',
      video:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
      web:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
      traf:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
      auto:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
      social: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    };
    return m[cls] || m.design;
  }

  function dueMeta(d) {
    if (d.status === 'done') return 'Concluída';
    if (!d.ends_at) return 'Sem prazo';
    const dd = daysUntil(d.ends_at);
    if (dd == null) return 'Sem prazo';
    if (dd < 0)  return Math.abs(dd) + ' dia(s) atrasada';
    if (dd === 0) return 'Prazo hoje';
    if (dd === 1) return 'Prazo amanhã';
    return dd + ' dias restantes';
  }

  function applyFilters(list) {
    const search = state.search.trim().toLowerCase();
    return list.filter(d => {
      if (state.filter !== 'all' && d.status !== state.filter) return false;
      if (search) {
        const hay = (d.title + ' ' + (d.client_display_name || '')).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  function renderHeader() {
    const me = state.me;
    if (!me) return;
    const av = $('#navAvatar');
    const nm = $('#navName');
    if (av) av.textContent = initials(me.name);
    if (nm) nm.textContent = me.name || me.email || 'Operador';
  }

  function renderStatusTabs() {
    const wrap = $('#statusTabs');
    if (!wrap) return;
    const countsByStatus = state.demands.reduce((acc, d) => {
      acc.all = (acc.all || 0) + 1;
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {});
    wrap.innerHTML = STATUS_TABS.map(s => {
      const active = state.filter === s ? 'active' : '';
      const count = countsByStatus[s] || 0;
      return `<div class="status-tab ${active}" data-status="${s}">${STATUS_TAB_LABEL[s]} <span class="count">${count}</span></div>`;
    }).join('');
    wrap.querySelectorAll('.status-tab').forEach(t => {
      t.addEventListener('click', () => {
        state.filter = t.dataset.status;
        renderStatusTabs();
        renderList();
      });
    });
  }

  function renderList() {
    const list = $('#listCard');
    if (!list) return;
    const filtered = applyFilters(state.demands);
    if (filtered.length === 0) {
      list.innerHTML = `<div style="padding:48px 24px;text-align:center;color:var(--muted);font-size:0.9rem;">
        ${state.demands.length === 0 ? 'Nenhuma demanda atribuída a você ainda.' : 'Nenhuma demanda corresponde aos filtros.'}
      </div>`;
      return;
    }
    list.innerHTML = filtered.map(d => {
      const iconCls = inferIconClass(d.title);
      const tag = STATUS_TAG[d.status] || 'new';
      const tagLabel = STATUS_LABEL[d.status] || d.status;
      const lastAt = d.last_message_at || d.updated_at || d.created_at;
      const isActive = d.id === state.currentId ? 'active' : '';
      return `
        <div class="list-row ${isActive}" data-id="${d.id}">
          <div class="demand-icon ${iconCls}">${iconSvg(iconCls)}</div>
          <div class="row-info">
            <div class="row-title">${escapeHtml(d.title || 'Sem título')}</div>
            <div class="row-meta">
              ${escapeHtml(d.client_display_name || '—')}
              <span class="sep">•</span> ${escapeHtml(dueMeta(d))}
            </div>
          </div>
          <span class="demand-tag ${tag}">${tagLabel}</span>
          <span class="row-date">${fmtRelative(lastAt)}</span>
        </div>`;
    }).join('');
    list.querySelectorAll('.list-row').forEach(row => {
      row.addEventListener('click', () => selectDemand(row.dataset.id));
    });
  }

  function renderDetailHead() {
    const head = $('#detailHead');
    const d = state.demands.find(x => x.id === state.currentId);
    if (!head) return;
    if (!d) {
      head.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:8px;">Selecione uma demanda à esquerda.</div>`;
      return;
    }
    const iconCls = inferIconClass(d.title);
    head.innerHTML = `
      <div class="demand-icon ${iconCls}">${iconSvg(iconCls)}</div>
      <div style="min-width:0;flex:1;">
        <h3>${escapeHtml(d.title)}</h3>
        <div class="who">${escapeHtml(d.client_display_name || '—')} • ${escapeHtml(dueMeta(d))}</div>
      </div>`;
  }

  function renderDetailBody() {
    const body = $('#detailBody');
    if (!body) return;
    const d = state.demands.find(x => x.id === state.currentId);
    if (!d) { body.innerHTML = ''; return; }
    body.innerHTML = `
      <div class="info-grid">
        <div class="item"><div class="k">Status</div><div class="v">${STATUS_LABEL[d.status] || d.status}</div></div>
        <div class="item"><div class="k">Aberta em</div><div class="v">${fmtDate(d.created_at)}</div></div>
        <div class="item"><div class="k">Prazo</div><div class="v">${d.ends_at ? fmtDate(d.ends_at) : '—'}</div></div>
        <div class="item"><div class="k">Mensagens</div><div class="v">${d.message_count || 0}</div></div>
      </div>
      ${d.description ? `<div class="desc-box" style="margin-bottom:16px">${escapeHtml(d.description)}</div>` : ''}
      <div class="status-actions" id="statusActions"></div>
    `;
    renderStatusActions();
  }

  function renderStatusActions() {
    const wrap = $('#statusActions');
    if (!wrap) return;
    const d = state.demands.find(x => x.id === state.currentId);
    if (!d) { wrap.innerHTML = ''; return; }
    const actions = [];
    if (d.status === 'open')        actions.push({ to: 'in_progress', label: 'Começar trabalho' });
    if (d.status === 'in_progress') actions.push({ to: 'review',      label: 'Marcar para revisão' });
    if (d.status === 'review')      actions.push({ to: 'in_progress', label: 'Voltar para em andamento' });
    wrap.innerHTML = actions.map(a =>
      `<button class="op-btn" data-to="${a.to}">${a.label}</button>`
    ).join('');
    wrap.querySelectorAll('.op-btn').forEach(b => {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await OperatorAPI.updateDemandStatus(d.id, b.dataset.to);
          await reloadDemands();
        } catch (e) {
          alert('Falha ao mudar status: ' + (e.message || e));
        } finally {
          b.disabled = false;
        }
      });
    });
  }

  async function renderChat() {
    const scroll = $('#chatScroll');
    if (!scroll) return;
    const msgs = state.messages[state.currentId] || [];
    if (msgs.length === 0) {
      scroll.innerHTML = `<div style="margin:auto;color:var(--muted);font-size:0.85rem;text-align:center;padding:24px;">Nenhuma mensagem ainda. Diga oi pro aluno 👋</div>`;
      return;
    }
    const me = state.me;
    scroll.innerHTML = msgs.map(m => {
      const mine = me && m.user_id === me.id;
      const attHtml = window.ChatComposer ? ChatComposer.renderAttachmentsHtml(m.attachments) : '';
      const bubbleHtml = m.content
        ? `<div class="msg-text">${escapeHtml(m.content)}</div>`
        : '';
      return `
        <div class="msg ${mine ? 'me' : ''}">
          <div class="av" style="background:linear-gradient(135deg,#fde68a,${mine ? 'var(--accent)' : '#f59e0b'})">${initials(m.author_name)}</div>
          <div class="msg-body">
            <div class="msg-head"><span class="name">${escapeHtml(mine ? 'Você' : (m.author_name || 'Alguém'))}</span><span>${fmtTime(m.created_at)}</span></div>
            ${bubbleHtml}
            ${attHtml}
          </div>
        </div>`;
    }).join('');
    scroll.scrollTop = scroll.scrollHeight;
  }

  async function loadMessages(demandId) {
    try {
      const msgs = await DemandChatAPI.listMessages(demandId);
      if (window.ChatComposer) {
        for (const m of msgs) {
          if (Array.isArray(m.attachments) && m.attachments.length) {
            m.attachments = await ChatComposer.hydrateAttachments(m.attachments);
          }
        }
      }
      state.messages[demandId] = msgs;
      if (state.currentId === demandId) renderChat();
    } catch (e) {
      console.error('loadMessages', e);
    }
  }

  function subscribeCurrent() {
    if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
    if (!state.currentId) return;
    state.unsubscribe = DemandChatAPI.subscribe(state.currentId, {
      onMessage: async () => { await loadMessages(state.currentId); },
      onDemandUpdate: async () => { await reloadDemands(); },
    });
  }

  async function selectDemand(id) {
    if (state.currentId === id) return;
    state.currentId = id;
    renderList();
    renderDetailHead();
    renderDetailBody();
    await loadMessages(id);
    subscribeCurrent();
  }

  async function reloadDemands() {
    state.demands = await OperatorAPI.listAssignedDemands({ status: 'all' });
    renderStatusTabs();
    renderList();
    if (state.currentId) {
      renderDetailHead();
      renderDetailBody();
    }
  }

  function bindSearch() {
    const inp = $('#searchInput');
    if (!inp) return;
    inp.addEventListener('input', () => {
      state.search = inp.value;
      renderList();
    });
  }

  function bindLogout() {
    const btn = document.querySelector('.logout-btn');
    if (btn) btn.addEventListener('click', () => OperatorAPI.logout());
  }

  function setupComposer() {
    const textarea = $('#composer');
    const wrap     = $('#composerWrap');
    if (!textarea || !wrap) return;
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
    });
    ChatComposer.attach({
      textarea,
      anchor:    wrap,
      attachBtn: $('#attachBtn'),
      sendBtn:   $('#sendBtn'),
      getDemandId: () => state.currentId,
      onSend: async ({ content, attachments }) => {
        if (!state.currentId || !state.me) return;
        await DemandChatAPI.postMessage(state.currentId, content, attachments, state.me.id);
        await loadMessages(state.currentId);
      },
    });
  }

  async function bootstrap() {
    state.me = await OperatorAPI.requireOperator();
    if (!state.me) return;
    renderHeader();
    bindLogout();
    bindSearch();
    setupComposer();
    await reloadDemands();
    if (state.demands.length > 0) {
      await selectDemand(state.demands[0].id);
    } else {
      renderDetailHead();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
