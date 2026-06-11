'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import BriefingForm, { type BriefingUnit, type SaveState } from '@/components/briefing/BriefingForm';
import {
  getGeneralFields,
  getProjectSections,
  getBaseSections,
  validateProjectBriefing,
  BRIEFING_SERVICE_LABELS,
  type BriefingAnswers,
  type ProjectBriefing,
} from '@/lib/briefing-templates';
import {
  getProject,
  getClientBriefing,
  saveProjectBriefing,
  submitProjectBriefing,
  getSessionJwt,
  type ProjectRow,
} from '@/lib/api/briefing';
import { generateBriefingPdf, displayVal, type PdfUnit } from '@/lib/briefing-pdf';
import { toast } from '@/lib/toast';
import styles from '@/components/briefing/BriefingForm.module.css';

// Campos curtos do bloco geral ocupam meia coluna; o resto vira full.
const GENERAL_HALF = new Set(['event_date', 'traffic_start', 'total_budget', 'desired_domain']);

const BACK_HREF = '/portal/projetos';

export default function ProjectBriefingPage() {
  const router = useRouter();
  const params = useParams<{ projetoId: string }>();
  const projectId = params?.projetoId ?? '';

  const modelRef = useRef<ProjectBriefing>({ general: {}, services: {} });
  const baseAccessRef = useRef<Record<string, BriefingAnswers>>({});

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ cls: '', msg: '—' });
  const [errorKeys, setErrorKeys] = useState<Set<string>>(new Set());
  const [validationItems, setValidationItems] = useState<string[]>([]);
  const [submitBtn, setSubmitBtn] = useState('Enviar para a Equipe');
  const [submitting, setSubmitting] = useState(false);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) { setNotFound(true); setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const p = await getProject(projectId);
        if (!alive) return;
        if (!p) { setNotFound(true); setLoading(false); return; }
        setProject(p);
        setServices(p.services?.length ? p.services : []);
        const b = p.briefing ?? {};
        modelRef.current = { general: { ...(b.general ?? {}) }, services: { ...(b.services ?? {}) } };
        setSubmitted(p.briefing_status === 'submitted');
        if (p.briefing_status === 'submitted') setSubmitBtn('Já enviado');
        try {
          const cb = await getClientBriefing();
          baseAccessRef.current = cb.access ?? {};
        } catch { /* acessos herdados são opcionais */ }
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [projectId]);

  const servicesLabel = useCallback(
    () => services.map((s) => BRIEFING_SERVICE_LABELS[s] ?? s).join(' · ') || 'Evento',
    [services],
  );

  // ── Units: geral + (por serviço) seções project + seções base (acessos herdados, read-only) ──
  const units = useMemo<BriefingUnit[]>(() => {
    const list: BriefingUnit[] = [];
    list.push({
      key: 'general',
      kind: 'general',
      title: 'Dados do evento',
      icon: 'calendar',
      fields: getGeneralFields(),
      grid: true,
      halfFields: GENERAL_HALF,
    });
    services.forEach((svc) => {
      const lbl = BRIEFING_SERVICE_LABELS[svc] ?? svc;
      getProjectSections(svc).forEach((sec, i) => {
        list.push({
          key: `p::${svc}::${i}`,
          kind: 'service',
          title: sec.title,
          icon: sec.icon,
          group: `${lbl} — campanha`,
          alert: sec.alert,
          hint: sec.hint,
          fields: sec.fields,
        });
      });
      getBaseSections(svc).forEach((sec, i) => {
        list.push({
          key: `a::${svc}::${i}`,
          kind: 'access',
          title: sec.title,
          icon: 'lock',
          group: `${lbl} — acessos (já cadastrados)`,
          readonly: true,
          readonlyBadge: 'Do Briefing Básico',
          fields: sec.fields,
          emptyHint: 'Nenhum acesso cadastrado para este serviço.',
        });
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, loading]);

  // svc a partir da key "p::svc::i" / "a::svc::i"
  const unitSvc = (u: BriefingUnit) => u.key.split('::')[1];

  // ── Accessors ────────────────────────────────────────────
  const getValue = useCallback((u: BriefingUnit, fieldId: string): unknown => {
    if (u.kind === 'general') return (modelRef.current.general ?? {})[fieldId];
    if (u.kind === 'access') return (baseAccessRef.current[unitSvc(u)] ?? {})[fieldId];
    return ((modelRef.current.services ?? {})[unitSvc(u)] ?? {})[fieldId];
  }, []);

  const scheduleSave = useCallback(() => {
    if (submitted) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState({ cls: 'saving', msg: 'Salvando...' });
    saveTimer.current = setTimeout(async () => {
      try {
        await saveProjectBriefing(projectId, {
          general: modelRef.current.general,
          services: modelRef.current.services,
        });
        setSaveState({ cls: 'saved', msg: 'Rascunho salvo ✓' });
        setTimeout(() => setSaveState({ cls: '', msg: '—' }), 3000);
      } catch {
        setSaveState({ cls: 'error', msg: 'Erro ao salvar' });
      }
    }, 1200);
  }, [projectId, submitted]);

  const setValue = useCallback((u: BriefingUnit, fieldId: string, value: unknown) => {
    if (u.kind === 'access') return; // herdado read-only
    if (u.kind === 'general') {
      modelRef.current.general = modelRef.current.general ?? {};
      modelRef.current.general[fieldId] = value;
    } else {
      const svc = unitSvc(u);
      modelRef.current.services = modelRef.current.services ?? {};
      modelRef.current.services[svc] = modelRef.current.services[svc] ?? {};
      modelRef.current.services[svc][fieldId] = value;
    }
    setErrorKeys((prev) => {
      const k = `${u.key}::${fieldId}`;
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
    rerender();
    scheduleSave();
  }, [scheduleSave]);

  // ── Progresso ────────────────────────────────────────────
  const progress = useMemo(() => {
    let total = 0, filled = 0;
    const doneKeys = new Set<string>();
    const isEmpty = (v: unknown) => v === null || v === undefined || v === '';
    units.filter((u) => !u.readonly).forEach((u) => {
      const reds = u.fields.filter((f) => f.priority === 'red');
      let unitOk = reds.length > 0;
      reds.forEach((f) => {
        if (f.dependsOn && getValue(u, f.dependsOn.field) !== f.dependsOn.value) return;
        total++;
        const v = getValue(u, f.id);
        if (!isEmpty(v)) filled++;
        else unitOk = false;
      });
      if (unitOk) doneKeys.add(u.key);
    });
    const pct = total ? Math.round((filled / total) * 100) : 100;
    return { pct, doneKeys };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, saveState, errorKeys, loading]);

  // ── Submit ───────────────────────────────────────────────
  async function onSubmit() {
    const r = validateProjectBriefing(services, {
      general: modelRef.current.general,
      services: modelRef.current.services,
    });
    if (!r.valid) {
      const errs = new Set<string>();
      const items: string[] = [];
      r.missing.forEach((m) => {
        if (m.scope === 'general') {
          const u = units.find((x) => x.kind === 'general');
          const f = u?.fields.find((x) => x.id === m.field);
          if (u && f) errs.add(`${u.key}::${f.id}`);
          items.push(f?.label ?? m.field);
        } else {
          const u = units.find((x) => x.kind === 'service' && unitSvc(x) === m.scope && x.fields.some((y) => y.id === m.field));
          const f = u?.fields.find((x) => x.id === m.field);
          if (u && f) errs.add(`${u.key}::${f.id}`);
          items.push(f?.label ?? m.field);
        }
      });
      setErrorKeys(errs);
      setValidationItems(items);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setValidationItems([]);
    setSubmitting(true);
    setSubmitBtn('Enviando...');
    try {
      await saveProjectBriefing(projectId, {
        general: modelRef.current.general,
        services: modelRef.current.services,
      });
      await submitProjectBriefing(projectId);
      setSubmitted(true);
      // PDF + ClickUp (falha não bloqueia)
      try {
        setSubmitBtn('Gerando PDF...');
        const blob = buildPdf();
        setSubmitBtn('Enviando ao ClickUp...');
        await attachPdf(blob);
      } catch (e) {
        console.warn('PDF/ClickUp:', e);
      }
      setSubmitBtn('Enviado ✓');
      toast('Briefing enviado para a equipe!', 'success');
      setTimeout(() => router.push(BACK_HREF), 2200);
    } catch (err) {
      setSubmitting(false);
      setSubmitBtn('Enviar para a Equipe');
      const msg = err instanceof Error ? err.message : String(err);
      toast('Erro ao enviar: ' + msg, 'error');
    }
  }

  function buildPdf(): Blob {
    const pdfUnits: PdfUnit[] = units.map((u) => ({
      group: u.group,
      title: u.title,
      fields: u.fields
        .map((f) => ({ label: f.label, value: displayVal(getValue(u, f.id)) }))
        .filter((x) => x.value !== ''),
    }));
    return generateBriefingPdf(servicesLabel(), project?.title ?? 'Projeto', pdfUnits);
  }

  async function attachPdf(blob: Blob) {
    const jwt = await getSessionJwt();
    if (!jwt) throw new Error('Sessão expirada.');
    const form = new FormData();
    form.append('project_id', projectId);
    form.append('pdf', blob, 'Briefing.pdf');
    const res = await fetch('/api/briefing-to-clickup', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + jwt },
      body: form,
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error || 'Erro ClickUp');
    return d;
  }

  if (loading) {
    return <p className="muted" style={{ padding: 24 }}>Carregando…</p>;
  }
  if (notFound) {
    return (
      <div className={styles.stateBox}>
        <h2>Projeto não encontrado</h2>
        <p>Este projeto não existe ou você não tem acesso a ele.</p>
        <button type="button" className="btn-primary" onClick={() => router.push(BACK_HREF)}>
          Voltar para projetos
        </button>
      </div>
    );
  }

  const banners = submitted ? (
    <div className={`${styles.statusBanner} ${styles.bannerOk}`}>
      <div className={styles.sbIcon}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      </div>
      <div>
        <strong>Briefing enviado para a equipe!</strong>
        <p>A equipe recebeu o contexto completo e já pode começar a trabalhar.</p>
      </div>
    </div>
  ) : null;

  return (
    <BriefingForm
      brandSub="Briefing do Projeto"
      pageTitle={project?.title ?? 'Briefing'}
      pageMeta={`${servicesLabel()} · ${submitted ? 'Briefing enviado' : 'Preencher briefing'}`}
      backHref={BACK_HREF}
      backLabel="Voltar para projetos"
      units={units}
      getValue={getValue}
      setValue={setValue}
      progress={progress}
      errorKeys={errorKeys}
      banners={banners}
      validationItems={validationItems}
      saveState={saveState}
      submitLabel={submitBtn}
      submitDisabled={submitting || submitted}
      onSubmit={onSubmit}
      ghostLabel="Salvar e sair"
      onGhost={() => router.push(BACK_HREF)}
    />
  );
}
