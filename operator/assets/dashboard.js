/**
 * operator/assets/dashboard.js — controlador do dashboard do operador.
 *
 * Carrega:
 *   - OperatorAPI.requireOperator()   → auth + perfil
 *   - OperatorAPI.getDashboard()      → KPIs, workload, urgent, recent
 *   - OperatorAPI.listMyStudents()    → alunos no plano
 *   - OperatorAPI.listAssignedDemands() → top 5 ativas
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
  };
  const STATUS_COLOR = {
    open:        '#16a34a',
    in_progress: '#F29725',
    review:      '#ec4899',
    done:        '#6366f1',
  };

  function $(sel) { return document.querySelector(sel); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function initials(name) {
    return String(name || 'OP').split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'OP';
  }
  function firstName(name) {
    return String(name || 'Operador').trim().split(/\s+/)[0];
  }
  function fmtRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)    return 'agora';
    if (diff < 3600)  return Math.floor(diff / 60) + ' min';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function fmtRating(score) {
    if (score == null) return '—';
    const n = Number(score);
    if (!isFinite(n)) return '—';
    return n.toFixed(2).replace('.', ',');
  }
  function gradientForName(name) {
    const palettes = [
      ['#fde68a', '#f59e0b'],
      ['#bae6fd', '#0284c7'],
      ['#f5d0fe', '#a855f7'],
      ['#fecaca', '#ef4444'],
      ['#bbf7d0', '#16a34a'],
      ['#c7d2fe', '#6366f1'],
      ['#fed7aa', '#ea580c'],
      ['#fbcfe8', '#db2777'],
    ];
    const s = String(name || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return palettes[h % palettes.length];
  }
  function avatarStyle(name) {
    const [a, b] = gradientForName(name);
    return `background:linear-gradient(135deg,${a},${b})`;
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
  function dueLabel(d) {
    if (d.status === 'done') return 'Concluída';
    if (!d.ends_at) return 'Sem prazo';
    const dd = Math.ceil((new Date(d.ends_at) - new Date()) / (1000 * 60 * 60 * 24));
    if (dd < 0)  return Math.abs(dd) + ' dia(s) atrasada';
    if (dd === 0) return 'Prazo hoje';
    if (dd === 1) return 'Prazo amanhã';
    return dd + ' dias restantes';
  }

  function renderHeader(me) {
    const fn = $('#firstName'); if (fn) fn.textContent = firstName(me?.name);
    const av = $('#navAvatar'); if (av) av.textContent = initials(me?.name);
    const nm = $('#navName');   if (nm) nm.textContent = me?.name || me?.email || 'Operador';
  }

  function renderKpis(kpi) {
    if (!kpi) return;
    $('#kpiOpen').textContent       = kpi.open_count ?? 0;
    $('#kpiInProgress').textContent = kpi.in_progress_count ?? 0;
    $('#kpiDoneToday').textContent  = kpi.done_today_count ?? 0;
    $('#kpiRating').textContent     = fmtRating(kpi.rating_avg);
    $('#kpiRatingHint').textContent = kpi.rating_count ? `Baseado em ${kpi.rating_count} avaliações` : 'Sem avaliações ainda';
  }

  function renderDemands(demands) {
    const wrap = $('#demandList');
    if (!wrap) return;
    if (!demands.length) {
      wrap.innerHTML = `<div style="padding:18px;text-align:center;color:var(--muted);font-size:0.85rem;">Você não tem demandas ativas no momento.</div>`;
      $('#demandListMeta').textContent = '0 demandas ativas';
      return;
    }
    $('#demandListMeta').textContent = `${demands.length} demandas em andamento`;
    wrap.innerHTML = demands.slice(0, 5).map(d => {
      const cls = inferIconClass(d.title);
      const tag = STATUS_TAG[d.status] || 'new';
      return `
        <div class="demand-row">
          <div class="demand-icon ${cls}">${iconSvg(cls)}</div>
          <div class="demand-info">
            <div class="demand-title">${escapeHtml(d.title)} <span class="demand-tag ${tag}">${STATUS_LABEL[d.status]}</span></div>
            <div class="demand-meta">${escapeHtml(d.client_display_name || '—')} <span class="sep">•</span> ${escapeHtml(dueLabel(d))}</div>
          </div>
          <span class="demand-meta">${fmtRelative(d.last_message_at || d.updated_at)}</span>
        </div>`;
    }).join('');
  }

  // Render donut chart sem libs (cumulative dashoffsets).
  function renderWorkload(workload, activeTotal) {
    const total = workload.reduce((acc, w) => acc + (w.count || 0), 0);
    const center = $('#donutCenterNum');
    const lbl    = $('#donutCenterLabel');
    const svg    = $('#donutSvg');
    const legend = $('#donutLegend');
    if (!svg || !legend) return;

    if (center) center.textContent = total;
    if (lbl)    lbl.textContent    = total === 1 ? 'Demanda' : 'Demandas';

    // Reset segmentos (mantém o ring de fundo na linha 0)
    const baseRing = svg.querySelector('circle[data-base]');
    svg.innerHTML = '';
    if (baseRing) svg.appendChild(baseRing);
    else {
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bg.setAttribute('cx', '21'); bg.setAttribute('cy', '21'); bg.setAttribute('r', '15.915');
      bg.setAttribute('fill', 'transparent'); bg.setAttribute('stroke', '#eef0f7'); bg.setAttribute('stroke-width', '6');
      bg.setAttribute('data-base', '1');
      svg.appendChild(bg);
    }

    if (total === 0) {
      legend.innerHTML = `<div class="legend-row" style="color:var(--muted)">Sem demandas pra mostrar.</div>`;
      return;
    }

    let offset = 0;
    legend.innerHTML = '';
    workload.forEach(w => {
      const pct = Math.round((w.count / total) * 100);
      const color = STATUS_COLOR[w.status] || '#94a3b8';
      const seg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      seg.setAttribute('cx', '21'); seg.setAttribute('cy', '21'); seg.setAttribute('r', '15.915');
      seg.setAttribute('fill', 'transparent');
      seg.setAttribute('stroke', color);
      seg.setAttribute('stroke-width', '6');
      seg.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);
      seg.setAttribute('stroke-dashoffset', String(-offset));
      seg.setAttribute('stroke-linecap', 'round');
      svg.appendChild(seg);
      offset += pct;

      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `<span class="legend-dot" style="background:${color}"></span>${STATUS_LABEL[w.status] || w.status}<span class="pct">${pct}%</span>`;
      legend.appendChild(row);
    });

    // Stats agregados (placeholders honestos: ainda não temos lead time)
    $('#statActiveTotal').textContent = activeTotal ?? '—';
  }

  function renderUrgent(items) {
    const wrap = $('#urgentList');
    if (!wrap) return;
    $('#urgentMeta').textContent = items.length === 0
      ? 'Nada com prazo apertado'
      : `${items.length} ${items.length === 1 ? 'precisa' : 'precisam'} de você`;
    if (!items.length) {
      wrap.innerHTML = `<div style="padding:18px;text-align:center;color:var(--muted);font-size:0.85rem;">Tudo sob controle 🎉</div>`;
      return;
    }
    wrap.innerHTML = items.map(u => {
      const sub = u.days_left == null ? '—'
        : u.days_left < 0  ? `Atrasada ${Math.abs(u.days_left)} dia(s)`
        : u.days_left === 0 ? 'Prazo hoje'
        : u.days_left === 1 ? 'Prazo amanhã'
        : `Em ${u.days_left} dias`;
      return `
        <a class="urgent-row" href="demandas.html#${escapeHtml(u.id)}">
          <span class="pulse"></span>
          <div class="info">
            <div class="title">${escapeHtml(u.title)}</div>
            <div class="sub">${escapeHtml(u.client_display_name || '—')} • ${escapeHtml(sub)}</div>
          </div>
          <span class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        </a>`;
    }).join('');
  }

  function renderStudents(students) {
    const wrap = $('#studentsGrid');
    if (!wrap) return;
    $('#studentsMeta').textContent = students.length === 0
      ? 'Nenhum aluno alocado'
      : `${students.length} ${students.length === 1 ? 'aluno atendido' : 'alunos atendidos'} por você`;
    if (!students.length) {
      wrap.innerHTML = `<div style="padding:18px;text-align:center;color:var(--muted);font-size:0.85rem;grid-column:1/-1;">Sem alocações em team_assignments. Peça ao admin para te vincular a um aluno.</div>`;
      return;
    }
    wrap.innerHTML = students.map(s => `
      <div class="student-card">
        <div class="avatar" style="${avatarStyle(s.display_name)}">${initials(s.display_name)}</div>
        <div>
          <div class="name">${escapeHtml(s.display_name)}</div>
          <div class="plan">${escapeHtml(s.plan_name || 'Diamante')}</div>
        </div>
      </div>`).join('');
  }

  function renderActivities(items) {
    const wrap = $('#activityList');
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML = `<div style="padding:18px;text-align:center;color:var(--muted);font-size:0.85rem;">Nenhuma mensagem recente.</div>`;
      return;
    }
    wrap.innerHTML = items.map(r => `
      <div class="activity-row">
        <span class="dot"></span>
        <div>
          <div class="text"><strong>${escapeHtml(r.author_name)}</strong> em <em>${escapeHtml(r.demand_title)}</em>: ${escapeHtml(r.preview || '(anexo)')}</div>
          <div class="when">${fmtRelative(r.created_at)}</div>
        </div>
      </div>`).join('');
  }

  function bindLogout() {
    const btn = document.querySelector('.logout-btn');
    if (btn) btn.addEventListener('click', () => OperatorAPI.logout());
  }

  function renderPointsCard(kpi) {
    if (!kpi) kpi = {};
    const totalEl  = $('#pointsTotal');
    const monthEl  = $('#pointsMonth');
    const rankEl   = $('#pointsRank');
    const ratEl    = $('#pointsRatings');
    const metaEl   = $('#pointsMeta');
    if (!totalEl) return;
    totalEl.textContent = kpi.points_total ?? 0;
    monthEl.textContent = `+${kpi.points_this_month ?? 0} pts`;
    if (kpi.ranking_position && kpi.ranking_total) {
      rankEl.textContent = `${kpi.ranking_position}º de ${kpi.ranking_total}`;
    } else {
      rankEl.textContent = '—';
    }
    if (kpi.rating_count && kpi.rating_count > 0) {
      ratEl.textContent = `${fmtRating(kpi.rating_avg)} · ${kpi.rating_count} avaliação${kpi.rating_count === 1 ? '' : 'ões'}`;
    } else {
      ratEl.textContent = 'Sem avaliações';
    }
    metaEl.textContent = kpi.points_this_month > 0
      ? `${kpi.points_this_month} pts conquistados este mês`
      : 'Comece a entregar pra ganhar pontos';
  }

  function renderRatingsReceived(items) {
    const wrap = $('#ratingsReceivedList');
    if (!wrap) return;
    if (!items || items.length === 0) {
      wrap.innerHTML = `<div style="padding:18px; text-align:center; color:var(--muted); font-size:0.85rem;">Quando seus alunos avaliarem as demandas, as notas aparecem aqui.</div>`;
      return;
    }
    wrap.innerHTML = items.map(r => `
      <div class="rating-row">
        <span class="score-pill">${r.score}/10</span>
        <div>
          <div class="rr-title">${escapeHtml(r.demand_title || '—')}</div>
          <div class="rr-sub">${escapeHtml(r.client_display_name || '—')}</div>
          ${r.comment ? `<div class="rr-comment">"${escapeHtml(r.comment)}"</div>` : ''}
        </div>
        <div class="rr-when">${fmtRelative(r.submitted_at)}</div>
      </div>`).join('');
  }

  async function bootstrap() {
    bindLogout();
    const me = await OperatorAPI.requireOperator();
    if (!me) return;
    renderHeader(me);

    // Em paralelo
    const [dash, students, activeDemands] = await Promise.all([
      OperatorAPI.getDashboard().catch(e => { console.error(e); return {}; }),
      OperatorAPI.listMyStudents().catch(e => { console.error(e); return []; }),
      OperatorAPI.listAssignedDemands({ status: 'all' }).catch(e => { console.error(e); return []; }),
    ]);

    if (dash.error) {
      console.warn('Dashboard:', dash.error);
    }
    renderKpis(dash.kpi || {});
    const active = (activeDemands || []).filter(d => d.status !== 'done' && d.status !== 'canceled');
    renderDemands(active);
    renderWorkload(dash.workload || [], dash.kpi?.active_total ?? active.length);
    renderUrgent(dash.urgent || []);
    renderPointsCard(dash.kpi || {});
    renderRatingsReceived(dash.recent_ratings_received || []);
    renderStudents(students);
    renderActivities(dash.recent || []);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
