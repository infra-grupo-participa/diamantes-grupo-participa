/**
 * operator/assets/perfil.js — controlador do perfil do operador.
 *
 * Carrega:
 *   - OperatorAPI.requireOperator() + getMe()
 *   - OperatorAPI.listPositions()      → para o select de cargo
 *   - OperatorAPI.getDashboard()       → reusa KPIs (done_today, in_progress, rating)
 *   - OperatorAPI.listMyStudents()     → para students_count
 *   - OperatorAPI.listMyRatings()      → avaliações com client_display_name
 *
 * Ações:
 *   - Salvar nome/whatsapp/bio/position_id (updateMe)
 *   - Trocar senha (changePassword, via modal)
 *   - Trocar avatar (uploadAvatar, click no avatar grande)
 */
(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function initials(name) {
    return String(name || 'OP').split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'OP';
  }
  function gradientForName(name) {
    const palettes = [
      ['#fde68a', '#f59e0b'], ['#bae6fd', '#0284c7'],
      ['#f5d0fe', '#a855f7'], ['#fecaca', '#ef4444'],
      ['#bbf7d0', '#16a34a'], ['#c7d2fe', '#6366f1'],
    ];
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return palettes[h % palettes.length];
  }
  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtScore(score) {
    if (score == null) return '—';
    const n = Number(score);
    if (!isFinite(n)) return '—';
    return n.toFixed(2).replace('.', ',');
  }
  function starString(scoreOutOf10) {
    if (scoreOutOf10 == null) return '☆ ☆ ☆ ☆ ☆';
    const stars5 = Math.round((Number(scoreOutOf10) / 10) * 5);
    return '★'.repeat(stars5) + '☆'.repeat(Math.max(0, 5 - stars5));
  }

  let state = {
    me: null,
    positions: [],
  };

  function showToast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 2500);
  }

  function renderHeader(me) {
    $('#navAvatar').textContent = initials(me?.name);
    $('#navName').textContent = me?.name || me?.email || 'Operador';
    $('#heroName').textContent = me?.name || '—';
    const member = me?.created_at ? `Membro desde ${fmtDate(me.created_at)}` : '';
    $('#heroSub').textContent = `${me?.email || ''}${member ? ' • ' + member : ''}`;
    const avatarEl = $('#bigAvatar');
    const text = $('#bigAvatarText');
    const url = me?.metadata?.avatar_url;
    const [a, b] = gradientForName(me?.name || 'OP');
    avatarEl.style.background = `linear-gradient(135deg,${a},${b})`;
    if (url) {
      avatarEl.classList.add('has-image');
      avatarEl.style.backgroundImage = `url('${url}')`;
      text.textContent = '';
    } else {
      avatarEl.classList.remove('has-image');
      avatarEl.style.backgroundImage = '';
      text.textContent = initials(me?.name);
    }
  }

  function renderHeroTags() {
    const wrap = $('#heroTags');
    const positionName = state.positions.find(p => p.id === state.me?.position_id)?.name;
    wrap.innerHTML = positionName ? `<span class="role-tag">${escapeHtml(positionName)}</span>` : '';
  }

  function renderForm(me) {
    $('#fName').value = me?.name || '';
    $('#fEmail').value = me?.email || '';
    $('#fWhatsapp').value = me?.metadata?.whatsapp || '';
    $('#fBio').value = me?.metadata?.bio || '';
    const sel = $('#fPosition');
    sel.innerHTML = '<option value="">— sem cargo —</option>' +
      state.positions.map(p => `<option value="${p.id}" ${p.id === me?.position_id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  }

  function renderStats(dash, studentsCount) {
    $('#statDone').textContent       = dash?.kpi?.done_today_count ?? 0;
    $('#statInProgress').textContent = dash?.kpi?.in_progress_count ?? 0;
    $('#statRating').textContent     = fmtScore(dash?.kpi?.rating_avg);
    $('#statStudents').textContent   = studentsCount ?? 0;

    $('#ratingAvg').textContent = fmtScore(dash?.kpi?.rating_avg);
    const total = dash?.kpi?.rating_count || 0;
    $('#ratingCount').textContent = total === 0 ? 'Sem avaliações ainda' : `Baseado em ${total} avaliação${total === 1 ? '' : 'ões'}`;
    $('#ratingStars').textContent = starString(dash?.kpi?.rating_avg);
  }

  function renderReviews(ratings) {
    const wrap = $('#reviewsList');
    if (!ratings.length) {
      wrap.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted); font-size:0.85rem;">Quando seus alunos avaliarem demandas, as notas aparecem aqui.</div>`;
      return;
    }
    wrap.innerHTML = ratings.map(r => {
      const [a, b] = gradientForName(r.client_display_name);
      return `
        <div class="review-row">
          <div class="av" style="background:linear-gradient(135deg,${a},${b})">${initials(r.client_display_name)}</div>
          <div>
            <div class="head">
              <div class="name">${escapeHtml(r.client_display_name)}</div>
              <div class="stars">${starString(r.score)} <span style="color:var(--muted);font-weight:500;margin-left:6px;">(${fmtScore(r.score)})</span></div>
            </div>
            ${r.comment ? `<div class="comment">"${escapeHtml(r.comment)}"</div>` : ''}
            <div class="when">${fmtDate(r.created_at)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function bindAvatarUpload() {
    const input = $('#avatarInput');
    $('#bigAvatar').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        await OperatorAPI.uploadAvatar(f);
        const me = await OperatorAPI.getMe();
        state.me = me;
        renderHeader(me);
        showToast('Foto atualizada.', 'success');
      } catch (e) {
        showToast('Falha no upload: ' + (e.message || e), 'error');
      } finally {
        input.value = '';
      }
    });
  }

  function bindSave() {
    $('#btnSave').addEventListener('click', async () => {
      const btn = $('#btnSave');
      btn.disabled = true;
      try {
        const patch = {
          name:        $('#fName').value.trim(),
          position_id: $('#fPosition').value || null,
          metadata: {
            whatsapp: $('#fWhatsapp').value.trim() || null,
            bio:      $('#fBio').value.trim() || null,
          },
        };
        if (!patch.name) {
          showToast('Nome obrigatório.', 'error');
          return;
        }
        const updated = await OperatorAPI.updateMe(patch);
        state.me = await OperatorAPI.getMe();
        renderHeader(state.me);
        renderHeroTags();
        showToast('Alterações salvas.', 'success');
      } catch (e) {
        showToast('Erro ao salvar: ' + (e.message || e), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function openPasswordModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card">
        <h3>Trocar senha</h3>
        <div class="modal-sub">Mínimo de 8 caracteres. Confirme abaixo.</div>
        <div class="field" style="margin-bottom:10px;">
          <label>Nova senha</label>
          <input type="password" id="mPass1" autocomplete="new-password" />
        </div>
        <div class="field">
          <label>Confirmar nova senha</label>
          <input type="password" id="mPass2" autocomplete="new-password" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" id="mCancel">Cancelar</button>
          <button class="btn-primary" id="mConfirm">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#mCancel').addEventListener('click', close);
    backdrop.querySelector('#mConfirm').addEventListener('click', async () => {
      const p1 = backdrop.querySelector('#mPass1').value;
      const p2 = backdrop.querySelector('#mPass2').value;
      if (p1 !== p2) {
        showToast('Senhas não conferem.', 'error');
        return;
      }
      const btn = backdrop.querySelector('#mConfirm');
      btn.disabled = true;
      try {
        await OperatorAPI.changePassword(p1);
        showToast('Senha alterada.', 'success');
        close();
      } catch (e) {
        showToast(e.message || String(e), 'error');
      } finally {
        btn.disabled = false;
      }
    });
    setTimeout(() => backdrop.querySelector('#mPass1').focus(), 50);
  }

  function bindPasswordModal() {
    $('#btnChangePass').addEventListener('click', openPasswordModal);
  }

  function bindLogout() {
    $('#logoutBtn').addEventListener('click', () => OperatorAPI.logout());
  }

  async function bootstrap() {
    bindLogout();
    state.me = await OperatorAPI.requireOperator();
    if (!state.me) return;

    // Carregamento paralelo
    const [positions, dash, students, ratings] = await Promise.all([
      OperatorAPI.listPositions().catch(e => { console.error(e); return []; }),
      OperatorAPI.getDashboard().catch(e => { console.error(e); return {}; }),
      OperatorAPI.listMyStudents().catch(e => { console.error(e); return []; }),
      OperatorAPI.listMyRatings(50).catch(e => { console.error(e); return []; }),
    ]);
    state.positions = positions;

    renderHeader(state.me);
    renderHeroTags();
    renderForm(state.me);
    renderStats(dash, students.length);
    renderReviews(ratings);

    bindAvatarUpload();
    bindSave();
    bindPasswordModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
