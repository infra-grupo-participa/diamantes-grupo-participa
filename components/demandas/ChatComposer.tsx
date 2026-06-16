'use client';

// Composer de chat com anexos — port de assets/js/chat-composer.js.
// Upload no bucket 'demand-attachments' ANTES do envio; Enter envia,
// Shift+Enter quebra linha; drag-and-drop e paste de imagens.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtSize, isImage, uploadAttachment, type Attachment } from '@/lib/chat';
import { toast } from '@/lib/toast';
import { errMessage } from '@/lib/errors';
import styles from './ChatComposer.module.css';

type Pending = {
  id: string;
  file: File;
  status: 'uploading' | 'ready' | 'error';
  thumbUrl: string | null;
  meta: Attachment | null;
};

const MAX_FILES = 5;

// Tipos aceitos (espelha o accept do <input>): imagens, PDF, docs, planilhas, txt, zip.
const ACCEPTED_MIME = /^(image\/|application\/pdf$|application\/msword$|application\/vnd\.openxmlformats|application\/vnd\.ms-excel$|text\/csv$|text\/plain$|application\/zip$|application\/x-zip-compressed$)/;
const ACCEPTED_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|csv|txt|zip)$/i;

function isAcceptedFile(file: File): boolean {
  if (file.type && ACCEPTED_MIME.test(file.type)) return true;
  // Alguns navegadores não preenchem o mime: cai pra extensão.
  return ACCEPTED_EXT.test(file.name || '');
}

const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconSpin = () => (
  <svg className={styles.spin} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function ChatComposer({
  demandId,
  disabled,
  onSend,
}: {
  demandId: string | null;
  disabled?: boolean;
  onSend: (payload: { content: string; attachments: Attachment[] }) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [dragover, setDragover] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;

  // Limpa object URLs ao desmontar.
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
    };
  }, []);

  const autosize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!demandId) {
        toast('Selecione uma demanda antes de anexar arquivos.', 'warning');
        return;
      }
      const incoming = Array.from(files);
      // Valida extensão/mime: avisa e descarta os não suportados.
      const valid = incoming.filter(isAcceptedFile);
      const rejectedType = incoming.length - valid.length;
      if (rejectedType > 0) {
        toast(
          rejectedType === 1
            ? 'Um arquivo foi ignorado: tipo não suportado.'
            : `${rejectedType} arquivos foram ignorados: tipo não suportado.`,
          'warning',
        );
      }
      const limit = Math.max(0, MAX_FILES - pendingRef.current.length);
      const arr = valid.slice(0, limit);
      // Avisa quando estourar o limite de anexos (antes descartava em silêncio).
      if (valid.length > limit) {
        toast(`Máximo de ${MAX_FILES} anexos por mensagem. ${valid.length - limit} não foram adicionados.`, 'warning');
      }
      for (const file of arr) {
        const id = Math.random().toString(36).slice(2);
        const item: Pending = {
          id,
          file,
          status: 'uploading',
          thumbUrl: isImage(file.type) ? URL.createObjectURL(file) : null,
          meta: null,
        };
        setPending((prev) => [...prev, item]);
        try {
          const meta = await uploadAttachment(demandId, file);
          setPending((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'ready', meta } : p)));
        } catch (e) {
          setPending((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'error' } : p)));
          toast('Falha no upload: ' + errMessage(e), 'error');
        }
      }
    },
    [demandId],
  );

  function removeAt(id: string) {
    setPending((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p?.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  async function trySend() {
    const content = text.trim();
    if (pendingRef.current.some((p) => p.status === 'uploading')) {
      toast('Aguarde os anexos terminarem de subir.', 'warning');
      return;
    }
    const ready = pendingRef.current.filter((p) => p.status === 'ready' && p.meta).map((p) => p.meta as Attachment);
    if (!content && ready.length === 0) return;

    setSending(true);
    try {
      await onSend({ content, attachments: ready });
      pendingRef.current.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl));
      setPending([]);
      setText('');
      if (taRef.current) taRef.current.style.height = 'auto';
    } catch (e) {
      toast('Erro ao enviar: ' + errMessage(e), 'error');
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  }

  return (
    <div className={styles.composer}>
      {pending.length > 0 && (
        <div className={styles.previews}>
          {pending.map((p) => {
            const img = isImage(p.file.type);
            return (
              <div key={p.id} className={styles.preview}>
                <div className={styles.thumb} style={img && p.thumbUrl ? { backgroundImage: `url('${p.thumbUrl}')` } : undefined}>
                  {!(img && p.thumbUrl) && <IconFile />}
                </div>
                <div className={styles.previewInfo}>
                  <div className={styles.previewName}>{p.file.name}</div>
                  <div className={`${styles.previewSize} ${p.status === 'error' ? styles.err : ''}`}>
                    {fmtSize(p.file.size)}
                    {p.status === 'error' ? ' • erro' : ''}
                  </div>
                </div>
                {p.status === 'uploading' ? (
                  <IconSpin />
                ) : (
                  <button type="button" className={styles.removeBtn} title="Remover" onClick={() => removeAt(p.id)}>
                    <IconX />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div
        className={`${styles.wrap} ${dragover ? styles.dragover : ''}`}
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
          if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={`${styles.btn} ${styles.ghost}`}
          title="Anexar arquivo"
          disabled={disabled || sending}
          onClick={() => fileRef.current?.click()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={taRef}
          className={styles.textarea}
          rows={1}
          placeholder="Escreva sua mensagem para a equipe…"
          value={text}
          disabled={disabled || sending}
          onChange={(e) => {
            setText(e.target.value);
            autosize();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void trySend();
            }
          }}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.files || []).filter((f) => isImage(f.type));
            if (imgs.length) {
              e.preventDefault();
              void addFiles(imgs);
            }
          }}
        />
        <button
          type="button"
          className={`${styles.btn} ${styles.send}`}
          title="Enviar (Enter)"
          disabled={disabled || sending}
          onClick={() => void trySend()}
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
