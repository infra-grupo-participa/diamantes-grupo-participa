'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import BriefingForm, { type BriefingUnit, type SaveState } from '@/components/briefing/BriefingForm';
import {
  getBaseSections,
  validateBaseAccess,
  BRIEFING_SERVICE_LABELS,
  type BriefingAnswers,
  type BriefingField,
} from '@/lib/briefing-templates';
import {
  getClientBriefing,
  getMyIdentity,
  saveBaseBriefing,
  submitBaseBriefing,
  type MeIdentity,
} from '@/lib/api/briefing';
import { toast } from '@/lib/toast';
import styles from '@/components/briefing/BriefingForm.module.css';

// Campos sintéticos read-only de identificação (não persistem; vêm de portal.users).
const IDENTITY_FIELDS: BriefingField[] = [
  { id: '__name', label: 'Nome', type: 'text', priority: 'green', readonly: true },
  { id: '__email', label: 'E-mail', type: 'text', priority: 'green', readonly: true },
  { id: '__phone', label: 'Telefone', type: 'text', priority: 'green', readonly: true },
];

export default function BriefingBasicoPage() {
  const router = useRouter();

  // Estado mutável (espelha o legado: access/pending mutados in-place + tick de render).
  const accessRef = useRef<Record<string, BriefingAnswers>>({});
  const pendingRef = useRef<string[]>([]);
  const meRef = useRef<MeIdentity>({ name: '', email: '', phone: '' });

  const [services, setServices] = useState<string[]>([]);
  const [baseStatus, setBaseStatus] = useState<'draft' | 'submitted'>('draft');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ cls: '', msg: '—' });
  const [errorKeys, setErrorKeys] = useState<Set<string>>(new Set());
  const [validationItems, setValidationItems] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cb, me] = await Promise.all([getClientBriefing(), getMyIdentity()]);
        if (!alive) return;
        accessRef.current = cb.access ?? {};
        pendingRef.current = cb.pending_flags ?? [];
        meRef.current = me;
        // só serviços que têm seções "base" (acessos) a preencher
        const withBase = (cb.services ?? []).filter((s) => getBaseSections(s).length > 0);
        setServices(withBase);
        setBaseStatus(cb.base_status);
      } catch {
        if (alive) setLoadError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // ── Units ────────────────────────────────────────────────
  const units = useMemo<BriefingUnit[]>(() => {
    const list: BriefingUnit[] = [];
    list.push({
      key: 'me',
      kind: 'identity',
      title: 'Seus dados',
      icon: 'user',
      group: 'Seus dados (Hotmart)',
      readonly: true,
      readonlyBadge: 'Cadastro',
      hint: 'Esses dados vêm do seu cadastro. Para corrigir algo, fale com a coordenação.',
      fields: IDENTITY_FIELDS,
      grid: true,
    });
    services.forEach((svc) => {
      const lbl = BRIEFING_SERVICE_LABELS[svc] ?? svc;
      getBaseSections(svc).forEach((sec, i) => {
        list.push({
          key: `${svc}::${sec.id}`,
          kind: 'service',
          title: sec.title,
          icon: sec.icon,
          group: `${lbl} — acessos`,
          alert: sec.alert,
          hint: sec.hint,
          fields: sec.fields,
          pendingNotes: true,
        });
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, loading]);

  // svc de uma unit (key = "svc::secId")
  const unitSvc = useCallback((u: BriefingUnit) => u.key.split('::')[0], []);

  // ── Accessors ────────────────────────────────────────────
  const getValue = useCallback((u: BriefingUnit, fieldId: string): unknown => {
    if (u.kind === 'identity') {
      if (fieldId === '__name') return meRef.current.name;
      if (fieldId === '__email') return meRef.current.email;
      if (fieldId === '__phone') return meRef.current.phone;
      return '';
    }
    const svc = unitSvc(u);
    return (accessRef.current[svc] ?? {})[fieldId];
  }, [unitSvc]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState({ cls: 'saving', msg: 'Salvando...' });
    saveTimer.current = setTimeout(async () => {
      try {
        await saveBaseBriefing(accessRef.current, pendingRef.current);
        setSaveState({ cls: 'saved', msg: 'Rascunho salvo ✓' });
        setTimeout(() => setSaveState({ cls: '', msg: '—' }), 3000);
      } catch {
        setSaveState({ cls: 'error', msg: 'Erro ao salvar' });
      }
    }, 1200);
  }, []);

  const setValue = useCallback((u: BriefingUnit, fieldId: string, value: unknown) => {
    if (u.kind === 'identity') return; // read-only
    const svc = unitSvc(u);
    accessRef.current[svc] = accessRef.current[svc] ?? {};
    accessRef.current[svc][fieldId] = value;

    // pending-note: boolean has_* === false → registra flag "svc.field"
    if (/^has_/.test(fieldId)) {
      const key = `${svc}.${fieldId}`;
      if (value === false) {
        if (!pendingRef.current.includes(key)) pendingRef.current.push(key);
      } else {
        pendingRef.current = pendingRef.current.filter((k) => k !== key);
      }
    }

    // limpa realce de erro do campo
    setErrorKeys((prev) => {
      const k = `${u.key}::${fieldId}`;
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
    rerender();
    scheduleSave();
  }, [unitSvc, scheduleSave]);

  // ── Progresso ────────────────────────────────────────────
  const progress = useMemo(() => {
    let totalReq = 0;
    let filled = 0;
    const doneKeys = new Set<string>();
    services.forEach((svc) => {
      const ans = accessRef.current[svc] ?? {};
      const { missing, valid } = validateBaseAccess(svc, ans);
      const req = getBaseSections(svc).flatMap((s) => s.fields).filter((f) => f.priority === 'red' && !f.dependsOn);
      totalReq += req.length;
      filled += req.length - missing.filter((id) => req.some((r) => r.id === id)).length;
      if (valid) {
        getBaseSections(svc).forEach((sec) => doneKeys.add(`${svc}::${sec.id}`));
      }
    });
    const pct = totalReq ? Math.round((filled / totalReq) * 100) : 100;
    return { pct, doneKeys };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, saveState, errorKeys, loading]);

  // ── Submit ───────────────────────────────────────────────
  async function onSubmit() {
    const items: string[] = [];
    const errs = new Set<string>();
    services.forEach((svc) => {
      const ans = accessRef.current[svc] ?? {};
      const { missing } = validateBaseAccess(svc, ans);
      const allFields = getBaseSections(svc).flatMap((sec) => sec.fields.map((f) => ({ secId: sec.id, f })));
      missing.forEach((id) => {
        const found = allFields.find((x) => x.f.id === id);
        if (found) errs.add(`${svc}::${found.secId}::${id}`);
        const lbl = BRIEFING_SERVICE_LABELS[svc] ?? svc;
        items.push(`${lbl} · ${found?.f.label ?? id}`);
      });
    });

    if (items.length) {
      setErrorKeys(errs);
      setValidationItems(items);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setValidationItems([]);
    setSubmitting(true);
    try {
      await saveBaseBriefing(accessRef.current, pendingRef.current);
      await submitBaseBriefing();
      setBaseStatus('submitted');
      toast('Briefing Básico enviado!', 'success');
      setTimeout(() => router.push('/portal'), 1500);
    } catch (err) {
      setSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      toast('Erro ao enviar: ' + msg, 'error');
    }
  }

  if (loading) {
    return <p className="muted" style={{ padding: 24 }}>Carregando…</p>;
  }
  if (loadError) {
    return (
      <div className={styles.stateBox}>
        <h2>Não foi possível carregar</h2>
        <p>Recarregue a página para tentar novamente.</p>
      </div>
    );
  }

  const banners = (
    <>
      {baseStatus === 'submitted' ? (
        <div className={`${styles.statusBanner} ${styles.bannerOk}`}>
          <div className={styles.sbIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <div>
            <strong>Briefing Básico enviado!</strong>
            <p>Você já pode criar projetos e abrir chamados. Pode voltar aqui a qualquer momento para atualizar os acessos.</p>
          </div>
        </div>
      ) : (
        <div className={`${styles.statusBanner} ${styles.bannerIntro}`}>
          <div className={styles.sbIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          </div>
          <div>
            <strong>Preencha uma vez só.</strong>
            <p>Informe aqui os acessos das suas ferramentas. Depois de enviar, você libera a criação de projetos e chamados — e não precisa repetir esses dados a cada evento.</p>
          </div>
        </div>
      )}
      {services.length === 0 && (
        <div className={`${styles.sectionNotice} ${styles.noticeInfo}`} style={{ marginBottom: 24 }}>
          <span>Nenhum serviço com acessos a preencher no momento. Você já pode enviar.</span>
        </div>
      )}
    </>
  );

  return (
    <BriefingForm
      brandSub="Briefing Básico"
      pageTitle="Briefing Básico"
      pageMeta={baseStatus === 'submitted'
        ? 'Acessos enviados — você pode atualizar quando quiser'
        : 'Preencha os acessos para liberar o portal'}
      units={units}
      getValue={getValue}
      setValue={setValue}
      progress={progress}
      errorKeys={errorKeys}
      pendingFlags={pendingRef.current}
      banners={banners}
      validationItems={validationItems}
      saveState={saveState}
      submitLabel={submitting ? 'Enviando…' : baseStatus === 'submitted' ? 'Atualizar acessos' : 'Enviar e liberar portal'}
      submitDisabled={submitting}
      onSubmit={onSubmit}
    />
  );
}
