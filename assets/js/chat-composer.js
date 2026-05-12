/**
 * chat-composer.js — UI compartilhada do composer com anexos.
 *
 * Anexa comportamento de seleção de arquivo + drag-and-drop + previews
 * a um <textarea> existente. Não conhece a API — recebe um callback
 * onSend({ content, attachments }) que cada caller (cliente/operador)
 * resolve à sua maneira (PortalAPI.postDemandMessage etc).
 *
 * Anexos são uploadados via DemandChatAPI.uploadAttachment ANTES do
 * envio da mensagem, então `attachments` chega já como
 * [{ path, name, size, mime, signedUrl }] e vai direto pro insert
 * em demand_messages.attachments (jsonb).
 *
 * Uso:
 *   ChatComposer.attach({
 *     textarea: document.getElementById('composer'),
 *     anchor:   document.querySelector('.composer-wrap'),
 *     attachBtn: document.querySelector('.composer-btn.ghost'),
 *     sendBtn:  document.querySelector('.composer-btn.send'),
 *     getDemandId: () => state.currentId,
 *     onSend: async ({ content, attachments }) => { ... }
 *   });
 *
 * Lightbox:
 *   ChatComposer.openLightbox(signedUrl, alt)
 */
(function () {
  'use strict';

  const ICON_FILE  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  const ICON_X     = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_SPIN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="cc-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const s = document.createElement('style');
    s.textContent = `
      .cc-previews{display:flex;flex-wrap:wrap;gap:8px;padding:8px 12px 0;}
      .cc-preview{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f4f6fb;border:1px solid #e4e7ef;border-radius:10px;font-size:0.78rem;color:#3c4458;max-width:260px;}
      .cc-preview .cc-thumb{width:30px;height:30px;border-radius:6px;background:#fff center/cover no-repeat;display:grid;place-items:center;color:#6b7280;flex-shrink:0;}
      .cc-preview .cc-thumb svg{width:14px;height:14px;}
      .cc-preview .cc-info{min-width:0;line-height:1.2;}
      .cc-preview .cc-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;}
      .cc-preview .cc-size{font-size:0.68rem;color:#8a92a5;}
      .cc-preview .cc-remove{background:none;border:none;cursor:pointer;color:#8a92a5;padding:2px;display:grid;place-items:center;border-radius:4px;}
      .cc-preview .cc-remove:hover{background:#fff;color:#ef4444;}
      .cc-preview .cc-remove svg{width:14px;height:14px;}
      .cc-preview.cc-uploading{opacity:0.7;}
      .cc-preview .cc-spin{width:14px;height:14px;color:#F29725;animation:cc-rot 0.9s linear infinite;}
      @keyframes cc-rot{to{transform:rotate(360deg);}}
      .cc-dragover{outline:2px dashed #F29725;outline-offset:-3px;background:#fff7ea;}
      .cc-msg-att{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
      .cc-msg-img{max-width:240px;max-height:240px;border-radius:10px;cursor:pointer;display:block;object-fit:cover;background:#f4f6fb;}
      .cc-msg-file{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.55);border:1px solid rgba(0,0,0,0.08);border-radius:10px;font-size:0.78rem;color:inherit;text-decoration:none;}
      .msg.mine .cc-msg-file{background:rgba(0,0,0,0.08);border-color:rgba(255,255,255,0.18);}
      .cc-msg-file svg{width:14px;height:14px;}
      .cc-lightbox{position:fixed;inset:0;background:rgba(8,8,12,0.84);display:grid;place-items:center;z-index:9999;backdrop-filter:blur(2px);}
      .cc-lightbox img{max-width:92vw;max-height:92vh;border-radius:6px;box-shadow:0 24px 60px rgba(0,0,0,0.4);}
      .cc-lightbox-close{position:absolute;top:18px;right:24px;background:rgba(255,255,255,0.12);color:#fff;border:none;width:40px;height:40px;border-radius:50%;cursor:pointer;display:grid;place-items:center;}
      .cc-lightbox-close:hover{background:rgba(255,255,255,0.22);}
      .cc-lightbox-close svg{width:18px;height:18px;}
    `;
    document.head.appendChild(s);
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function isImage(mime) {
    return /^image\//.test(mime || '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function attach(opts) {
    injectStyle();
    const { textarea, anchor, attachBtn, sendBtn, getDemandId, onSend, maxFiles = 5 } = opts;
    if (!textarea || !anchor) throw new Error('ChatComposer.attach: textarea+anchor obrigatórios.');
    if (typeof onSend !== 'function') throw new Error('ChatComposer.attach: onSend obrigatório.');

    let pending = []; // [{ file, status: 'uploading'|'ready'|'error', meta?: {...} }]

    // Container de previews acima do composer
    const previews = document.createElement('div');
    previews.className = 'cc-previews';
    previews.style.display = 'none';
    anchor.parentNode.insertBefore(previews, anchor);

    // Input file invisível
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip';
    fileInput.style.display = 'none';
    anchor.appendChild(fileInput);

    function renderPreviews() {
      previews.style.display = pending.length ? 'flex' : 'none';
      previews.innerHTML = pending.map((p, idx) => {
        const isImg = isImage(p.file.type);
        const thumbBg = (p.thumbUrl && isImg) ? `style="background-image:url('${p.thumbUrl}')"` : '';
        const thumbInner = (p.thumbUrl && isImg) ? '' : ICON_FILE;
        const statusIcon = p.status === 'uploading' ? ICON_SPIN
                         : p.status === 'error' ? '⚠️'
                         : `<button class="cc-remove" data-idx="${idx}" title="Remover">${ICON_X}</button>`;
        return `
          <div class="cc-preview ${p.status === 'uploading' ? 'cc-uploading' : ''}">
            <div class="cc-thumb" ${thumbBg}>${thumbInner}</div>
            <div class="cc-info">
              <div class="cc-name">${escapeHtml(p.file.name)}</div>
              <div class="cc-size">${fmtSize(p.file.size)}${p.status === 'error' ? ' • erro' : ''}</div>
            </div>
            ${statusIcon}
          </div>`;
      }).join('');
      previews.querySelectorAll('.cc-remove').forEach(btn => {
        btn.addEventListener('click', () => removeAt(parseInt(btn.dataset.idx, 10)));
      });
    }

    function removeAt(idx) {
      const p = pending[idx];
      if (!p) return;
      if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
      pending.splice(idx, 1);
      renderPreviews();
    }

    async function addFiles(files) {
      const demandId = getDemandId();
      if (!demandId) {
        alert('Selecione uma demanda antes de anexar arquivos.');
        return;
      }
      if (!window.DemandChatAPI) {
        alert('Módulo de chat não carregado.');
        return;
      }
      const limit = maxFiles - pending.length;
      const arr = Array.from(files).slice(0, Math.max(0, limit));
      for (const file of arr) {
        const p = {
          file,
          status: 'uploading',
          thumbUrl: isImage(file.type) ? URL.createObjectURL(file) : null,
          meta: null,
        };
        pending.push(p);
        renderPreviews();
        try {
          const meta = await window.DemandChatAPI.uploadAttachment(demandId, file);
          p.status = 'ready';
          p.meta = meta;
        } catch (e) {
          p.status = 'error';
          console.error('upload error', e);
          alert('Falha no upload: ' + (e.message || e));
        }
        renderPreviews();
      }
    }

    // Botão anexar
    if (attachBtn) {
      attachBtn.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
    }
    fileInput.addEventListener('change', () => {
      addFiles(fileInput.files);
      fileInput.value = '';
    });

    // Drag-and-drop sobre o anchor
    ['dragenter','dragover'].forEach(evt => {
      anchor.addEventListener(evt, (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        anchor.classList.add('cc-dragover');
      });
    });
    ['dragleave','drop'].forEach(evt => {
      anchor.addEventListener(evt, (e) => {
        e.preventDefault();
        anchor.classList.remove('cc-dragover');
      });
    });
    anchor.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    });

    // Paste de imagens
    textarea.addEventListener('paste', (e) => {
      if (!e.clipboardData?.files?.length) return;
      const imgs = Array.from(e.clipboardData.files).filter(f => isImage(f.type));
      if (imgs.length) {
        e.preventDefault();
        addFiles(imgs);
      }
    });

    // Send: aguarda uploads pendentes terminarem, junta metadados e dispara onSend
    async function trySend() {
      const text = textarea.value.trim();
      if (pending.some(p => p.status === 'uploading')) {
        alert('Aguarde os anexos terminarem de subir.');
        return;
      }
      const ready = pending.filter(p => p.status === 'ready').map(p => p.meta);
      if (!text && ready.length === 0) return;

      const oldDisabled = textarea.disabled;
      textarea.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      try {
        await onSend({ content: text, attachments: ready });
        // Limpa estado
        pending.forEach(p => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
        pending = [];
        renderPreviews();
        textarea.value = '';
        textarea.style.height = 'auto';
      } catch (e) {
        alert('Erro ao enviar: ' + (e.message || e));
      } finally {
        textarea.disabled = oldDisabled;
        if (sendBtn) sendBtn.disabled = false;
        textarea.focus();
      }
    }

    if (sendBtn) sendBtn.addEventListener('click', (e) => { e.preventDefault(); trySend(); });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySend(); }
    });

    return {
      send: trySend,
      clear: () => {
        pending.forEach(p => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
        pending = [];
        renderPreviews();
      },
      pending: () => pending.slice(),
    };
  }

  // Renderiza anexos de uma mensagem (já com signed URLs)
  function renderAttachmentsHtml(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return '';
    return '<div class="cc-msg-att">' + attachments.map(a => {
      if (!a) return '';
      const url = escapeHtml(a.signedUrl || a.url || '');
      const name = escapeHtml(a.name || 'arquivo');
      if (isImage(a.mime)) {
        return `<img class="cc-msg-img" src="${url}" alt="${name}" data-cc-lightbox="1" loading="lazy">`;
      }
      return `<a class="cc-msg-file" href="${url}" target="_blank" rel="noopener">${ICON_FILE}<span>${name}</span></a>`;
    }).join('') + '</div>';
  }

  // Lightbox simples — clique numa imagem renderizada por renderAttachmentsHtml
  function openLightbox(url, alt) {
    const overlay = document.createElement('div');
    overlay.className = 'cc-lightbox';
    overlay.innerHTML = `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || '')}"><button class="cc-lightbox-close" title="Fechar">${ICON_X}</button>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('.cc-lightbox-close')) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(overlay);
  }

  // Delegação global pra lightbox em qualquer scroll de chat
  document.addEventListener('click', (e) => {
    const img = e.target.closest('img[data-cc-lightbox]');
    if (img) openLightbox(img.src, img.alt);
  });

  // Re-signa URLs expiradas no client-side (anexos lidos do BD têm só `path`)
  async function hydrateAttachments(attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    if (!window.DemandChatAPI) return attachments;
    const out = [];
    for (const a of attachments) {
      if (!a) { out.push(a); continue; }
      if (a.signedUrl) { out.push(a); continue; }
      const url = await window.DemandChatAPI.signAttachment(a.path);
      out.push(Object.assign({}, a, { signedUrl: url }));
    }
    return out;
  }

  window.ChatComposer = {
    attach,
    renderAttachmentsHtml,
    openLightbox,
    hydrateAttachments,
  };
})();
