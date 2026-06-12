'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createProject,
  getClientBriefingBrowser,
} from '@/lib/api/projects';
import { BRIEFING_ACTIVE_SERVICES, BRIEFING_SERVICE_LABELS } from '@/lib/briefing-templates';
import { toast } from '@/lib/toast';
import styles from './page.module.css';

const ICONS: Record<string, string> = {
  anuncios_pagos: '📣',
  edicao_video: '🎬',
  paginas: '💻',
  automacao: '⚙️',
};
const DESC: Record<string, string> = {
  anuncios_pagos: 'Meta · Google · YouTube',
  edicao_video: 'Reels · VSL · YouTube',
  paginas: 'Landing pages · Domínio',
  automacao: 'WhatsApp · Integrações',
};

type Phase = 'loading' | 'gate' | 'ready';

export default function NovoProjetoPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [services, setServices] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [apiError, setApiError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const briefing = await getClientBriefingBrowser();
        if (!briefing || briefing.base_status !== 'submitted') {
          setPhase('gate');
          return;
        }
        // Serviços contratados ativos para briefing (interseção com os ativos).
        const contracted = (briefing.services ?? []).filter((s) =>
          BRIEFING_ACTIVE_SERVICES.includes(s),
        );
        setServices(contracted);
        setSelected(new Set(contracted)); // pré-selecionados
        setPhase('ready');
      } catch {
        // Sem briefing acessível → trata como gate (precisa do básico).
        setPhase('gate');
      }
    })();
  }, []);

  function toggle(svc: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(svc)) next.delete(svc);
      else next.add(svc);
      return next;
    });
    setServiceError(false);
  }

  async function onCreate() {
    const name = title.trim();
    let ok = true;
    setTitleError(false);
    setServiceError(false);
    setApiError('');
    if (!name) {
      setTitleError(true);
      ok = false;
    }
    if (selected.size === 0) {
      setServiceError(true);
      ok = false;
    }
    if (!ok) return;

    setCreating(true);
    try {
      const project = await createProject({
        title: name,
        general: {},
        services: Array.from(selected),
      });
      toast('Projeto criado');
      router.push(`/portal/briefing/${project.id}`);
    } catch (err) {
      setApiError((err as Error).message || 'Erro ao criar projeto.');
      setCreating(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className={styles.wrap}>
        <div className={`${styles.skel}`} style={{ width: 80, height: 16, marginBottom: 20 }} />
        <div className={`${styles.skel}`} style={{ width: '60%', height: 26, marginBottom: 10 }} />
        <div className={`${styles.skel}`} style={{ width: '90%', height: 14, marginBottom: 28 }} />
        <div className={`${styles.skel}`} style={{ width: 160, height: 16, marginBottom: 8 }} />
        <div className={`${styles.skel}`} style={{ width: '100%', height: 44, marginBottom: 24 }} />
        <div className={styles.serviceGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${styles.skel} ${styles.skelCard}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <Link className={styles.back} href="/portal/projetos">
        ← Voltar
      </Link>
      <h1>Novo Projeto (Evento)</h1>
      <p className={styles.subtitle}>
        Dê um nome ao evento e confirme os serviços que entram nele. Em seguida você preenche o
        briefing com os dados da campanha.
      </p>

      {phase === 'gate' ? (
        <div className={styles.gate}>
          Você precisa concluir o{' '}
          <Link href="/portal/briefing-basico">Briefing Básico</Link> antes de criar projetos.
        </div>
      ) : (
        <>
          <div className={styles.fieldGroup}>
            <label htmlFor="projectTitle">Nome do evento *</label>
            <input
              id="projectTitle"
              className={styles.input}
              type="text"
              maxLength={120}
              placeholder="Ex.: Seminário Tributário Jun/26"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(false);
              }}
            />
            {titleError && <p className={styles.error}>Preencha o nome do evento.</p>}
          </div>

          <div className={styles.fieldGroup}>
            <label>Serviços deste evento *</label>
            <div className={styles.serviceGrid}>
              {services.length === 0 ? (
                <div className={styles.noServices}>
                  Nenhum serviço contratado encontrado. Fale com a coordenação.
                </div>
              ) : (
                services.map((s) => {
                  const isSel = selected.has(s);
                  return (
                    <button
                      type="button"
                      key={s}
                      className={`${styles.serviceCard} ${isSel ? styles.selected : ''}`}
                      onClick={() => toggle(s)}
                    >
                      <div className="chk">
                        {isSel && (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <div className="icon">{ICONS[s] ?? '📋'}</div>
                      <div className="name">{BRIEFING_SERVICE_LABELS[s] ?? s}</div>
                      <div className="desc">{DESC[s] ?? ''}</div>
                    </button>
                  );
                })
              )}
            </div>
            {serviceError && <p className={styles.error}>Selecione ao menos um serviço.</p>}
            {apiError && <p className={styles.error}>{apiError}</p>}
          </div>

          <button
            type="button"
            className={`btn-primary ${styles.submit}`}
            onClick={onCreate}
            disabled={creating}
          >
            {creating ? 'Criando…' : 'Continuar para o Briefing →'}
          </button>
        </>
      )}
    </div>
  );
}
