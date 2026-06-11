'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadAttachment, fmtSize, isImage, type Attachment } from '@/lib/chat';
import { toast } from '@/lib/toast';
import s from './demandas.module.css';

const ICON_FILE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const ICON_X = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

type Pending = {
  file: File;
  status: 'uploading' | 'ready' | 'error';
  thumbUrl: string | null;
  meta: Attachment | null;
};

const MAX_FILES = 5;

export default function ChatComposer({
  demandId,
  onSend,
}: {
  demandId: string | null;
  onSend: (payload: { content: string; attachments: Attachment[] }) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragover, setDragover] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;

  // Limpa thumbnails ao desmontar
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
    };
  }, []);

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }

  async function addFiles(files: FileList | File[]) {
    if (!demandId) {
      toast('Selecione uma demanda antes de anexar arquivos.', 'warning');
      return;
    }
    const limit = MAX_FILES - pendingRef.current.length;
    const arr = Array.from(files).slice(0, Math.max(0, limit));
    for (const file of arr) {
      const entry: Pending = {
        file,
        status: 'uploading',
        thumbUrl: isImage(file.type) ? URL.createObjectURL(file) : null,
        meta: null,
      };
      setPending((prev) => [...prev, entry]);
      try {
        const meta = await uploadAttachment(demandId, file);
        setPending((prev) =>
          prev.map((p) => (p === entry ? { ...p, status: 'ready', meta } : p)),
        );
      } catch (e) {
        console.error('upload error', e);
        toast('Falha no upload: ' + ((e as Error).message || e), 'error');
        setPending((prev) => prev.map((p) => (p === entry ? { ...p, status: 'error' } : p)));
      }
    }
  }

  function removeAt(idx: number) {
    setPending((prev) => {
      const p = prev[idx];
      if (p?.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function trySend() {
    const content = text.trim();
    if (pendingRef.current.some((p) => p.status === 'uploading')) {
      toast('Aguarde os anexos terminarem de subir.', 'warning');
      return;
    }
    const ready = pendingRef.current
      .filter((p) => p.status === 'ready' && p.meta)
      .map((p) => p.meta as Attachment);
    if (!content && ready.length === 0) return;
    try {
      await onSend({ content, attachments: ready });
      pendingRef.current.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
      setPending([]);
      setText('');
      const ta = taRef.current;
      if (ta) ta.style.height = 'auto';
    } catch (e) {
      toast('Erro ao enviar: ' + ((e as Error).message || e), 'error');
    }
  }

  return (
    <div className={s.chatComposer}>
      {pending.length > 0 && (
        <div className={s.composerPreviews}>
          {pending.map((p, idx) => {
            const img = isImage(p.file.type);
            return (
              <div className={s.preview} key={idx}>
                <div
                  className={s.previewThumb}
                  style={p.thumbUrl && img ? { backgroundImage: `url('${p.thumbUrl}')` } : undefined}
                >
                  {p.thumbUrl && img ? null : ICON_FILE}
                </div>
                <div className={s.previewInfo}>
                  <div className={s.previewName}>{p.file.name}</div>
                  <div className={s.previewSize}>
                    {fmtSize(p.file.size)}
                    {p.status === 'error' ? ' • erro' : ''}
                  </div>
                </div>
                {p.status === 'uploading' ? (
                  <span className={s.spin}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  </span>
                ) : p.status === 'error' ? (
                  <span>⚠️</span>
                ) : (
                  <button className={s.previewRemove} title="Remover" onClick={() => removeAt(idx)}>
                    {ICON_X}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className={`${s.composerWrap} ${dragover ? s.dragover : ''}`}
        onDragEnter={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            setDragover(true);
          }
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            setDragover(true);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragover(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragover(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        <button
          className={s.composerBtn}
          title="Anexar arquivo"
          onClick={(e) => {
            e.preventDefault();
            fileRef.current?.click();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder="Escreva uma mensagem para o aluno..."
          onChange={(e) => {
            setText(e.target.value);
            autosize();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              trySend();
            }
          }}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files).filter((f) => isImage(f.type));
            if (imgs.length) {
              e.preventDefault();
              addFiles(imgs);
            }
          }}
        />
        <button
          className={`${s.composerBtn} ${s.send}`}
          title="Enviar (Enter)"
          onClick={(e) => {
            e.preventDefault();
            trySend();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
