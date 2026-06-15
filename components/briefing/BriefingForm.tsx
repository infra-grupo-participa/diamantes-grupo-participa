'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { BriefingField, CardValue } from '@/lib/briefing-templates';
import styles from './BriefingForm.module.css';

// ── Ícones (porte fiel do SVG_ICONS do legado) ─────────────────
const SVG_ICONS: Record<string, ReactNode> = {
  user: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  ),
  target: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
  ),
  cpu: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /></svg>
  ),
  layers: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
  ),
  'bar-chart': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
  ),
  calendar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
  ),
  'credit-card': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
  ),
  search: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
  ),
  'trending-up': (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
  ),
  lock: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
  ),
};
function icon(n?: string): ReactNode {
  return (n && SVG_ICONS[n]) || SVG_ICONS.cpu;
}

const IconWarn = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
const IconInfo = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
);

const PRIORITY_LABEL: Record<string, string> = { red: 'Obrigatório', yellow: 'Importante', green: 'Recomendado' };

// ── Modelo de render ───────────────────────────────────────────
/** Tipo de unidade renderizável. */
export type UnitKind = 'general' | 'service' | 'access' | 'identity';

export interface BriefingUnit {
  /** Chave única e estável (usada para DOM ids e accessors). */
  key: string;
  kind: UnitKind;
  title: string;
  icon?: string;
  /** Rótulo de grupo exibido acima da seção (sequências do mesmo grupo agrupam). */
  group?: string;
  /** Tag "Somente leitura" + estilo tracejado de acesso herdado. */
  readonly?: boolean;
  /** Badge à direita do label dos campos read-only. */
  readonlyBadge?: string;
  alert?: string;
  hint?: string;
  /** Aviso quando readonly e sem campos. */
  emptyHint?: string;
  fields: BriefingField[];
  /** Campos cujo id deve ocupar meia coluna no grid (resto vira full). */
  halfFields?: Set<string>;
  /** Renderiza os campos em grid 2-col (bloco geral / identidade). */
  grid?: boolean;
  /** Habilita pending-note nos boolean has_* (Briefing Básico). */
  pendingNotes?: boolean;
}

export interface SaveState {
  cls: '' | 'saving' | 'saved' | 'error';
  msg: string;
}

export interface BriefingFormProps {
  brandSub: string;
  pageTitle: string;
  pageMeta: string;
  backHref?: string;
  backLabel?: string;
  units: BriefingUnit[];
  /** Lê o valor de um campo. */
  getValue: (unit: BriefingUnit, fieldId: string) => unknown;
  /** Escreve o valor de um campo. */
  setValue: (unit: BriefingUnit, fieldId: string, value: unknown) => void;
  /** Calcula progresso (0-100) e unidades concluídas (set de keys). */
  progress: { pct: number; doneKeys: Set<string> };
  /** Erros realçados (set de "unitKey::fieldId"). */
  errorKeys: Set<string>;
  /** Pending flags ("svc.field") — para exibir pending-note. */
  pendingFlags?: string[];
  banners?: ReactNode;
  validationItems?: string[];
  saveState: SaveState;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void;
  ghostLabel?: string;
  onGhost?: () => void;
}

export default function BriefingForm(props: BriefingFormProps) {
  const {
    brandSub, pageTitle, pageMeta, backHref, backLabel, units,
    getValue, setValue, progress, errorKeys, pendingFlags = [],
    banners, validationItems, saveState, submitLabel, submitDisabled,
    onSubmit, ghostLabel, onGhost,
  } = props;

  const [active, setActive] = useState(0);
  // Tick local para re-render imediato ao digitar (o pai muta o model mutável).
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);

  const navUnits = useMemo(() => units, [units]);

  function scrollToUnit(i: number) {
    setActive(i);
    panelRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function isVisible(unit: BriefingUnit, f: BriefingField): boolean {
    if (!f.dependsOn) return true;
    return getValue(unit, f.dependsOn.field) === f.dependsOn.value;
  }

  function handleSet(unit: BriefingUnit, f: BriefingField, raw: unknown) {
    const value = f.type === 'number' ? (raw === '' || raw == null ? null : Number(raw)) : raw;
    setValue(unit, f.id, value);
    // limpar dependentes ocultos
    unit.fields
      .filter((x) => x.dependsOn && x.dependsOn.field === f.id)
      .forEach((x) => {
        if (getValue(unit, x.id) != null && getValue(unit, f.id) !== x.dependsOn!.value) {
          setValue(unit, x.id, null);
        }
      });
    rerender();
  }

  function renderField(unit: BriefingUnit, f: BriefingField): ReactNode {
    if (!isVisible(unit, f)) return null;
    const ro = !!unit.readonly || !!f.readonly;
    const cur = getValue(unit, f.id);
    const errKey = `${unit.key}::${f.id}`;
    const hasErr = errorKeys.has(errKey);
    const full = unit.grid
      ? unit.halfFields?.has(f.id) ? '' : styles.full
      : '';

    let input: ReactNode = null;

    if (f.type === 'card') {
      const st = (cur && typeof cur === 'object' ? cur : {}) as CardValue;
      const brands = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Outro'];
      const writeCard = (patch: Partial<CardValue>) => {
        const next: CardValue = { brand: st.brand, last4: st.last4, expiry: st.expiry, ...patch };
        setValue(unit, f.id, next);
        rerender();
      };
      input = (
        <div className={styles.cardInputWrap}>
          <div>
            <div className={styles.cardInputLabel}>Bandeira</div>
            <select
              className={`${styles.fieldInput} ${styles.select}`}
              value={st.brand ?? ''}
              disabled={ro}
              onChange={(e) => writeCard({ brand: e.target.value })}
            >
              <option value="">—</option>
              {brands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <div className={styles.cardInputLabel}>Últimos 4</div>
            <input
              className={styles.fieldInput}
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              readOnly={ro}
              value={st.last4 ?? ''}
              onChange={(e) => writeCard({ last4: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })}
            />
          </div>
          <div>
            <div className={styles.cardInputLabel}>Validade</div>
            <input
              className={styles.fieldInput}
              inputMode="numeric"
              maxLength={5}
              placeholder="MM/AA"
              readOnly={ro}
              value={st.expiry ?? ''}
              onChange={(e) => {
                let v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
                writeCard({ expiry: v });
              }}
            />
          </div>
        </div>
      );
    } else if (f.type === 'boolean') {
      if (ro) {
        input = (
          <input
            className={styles.fieldInput}
            readOnly
            tabIndex={-1}
            value={cur === true ? 'Sim' : cur === false ? 'Não' : '—'}
          />
        );
      } else {
        const showPending = !!unit.pendingNotes && /^has_/.test(f.id) && cur === false;
        input = (
          <>
            <div className={styles.toggleGroup}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${cur === true ? styles.toggleBtnActive : ''}`}
                onClick={() => handleSet(unit, f, true)}
              >
                Sim
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${cur === false ? styles.toggleBtnActive : ''}`}
                onClick={() => handleSet(unit, f, false)}
              >
                Não
              </button>
            </div>
            {showPending && (
              <div className={styles.pendingNote}>
                ⚠️ Sem isso, agendaremos uma reunião para resolver. Pode enviar mesmo assim.
              </div>
            )}
          </>
        );
      }
    } else if (f.type === 'select') {
      if (ro) {
        input = (
          <input className={styles.fieldInput} readOnly tabIndex={-1} value={cur != null && cur !== '' ? String(cur) : '—'} />
        );
      } else {
        input = (
          <select
            className={`${styles.fieldInput} ${styles.select} ${hasErr ? styles.inputError : ''}`}
            value={cur != null ? String(cur) : ''}
            onChange={(e) => handleSet(unit, f, e.target.value)}
          >
            <option value="">— Selecione —</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      }
    } else {
      const t =
        f.type === 'number' ? 'number'
          : f.type === 'url' ? 'url'
            : f.type === 'date' ? 'date'
              : f.type === 'email' ? 'email'
                : 'text';
      input = (
        <input
          className={`${styles.fieldInput} ${hasErr ? styles.inputError : ''}`}
          type={t}
          value={cur != null ? String(cur) : ''}
          placeholder={ro ? '—' : (f.placeholder ?? '')}
          readOnly={ro}
          tabIndex={ro ? -1 : undefined}
          onChange={ro ? undefined : (e) => handleSet(unit, f, e.target.value)}
        />
      );
    }

    return (
      <div key={f.id} className={`${styles.fieldRow} ${full}`}>
        <div className={styles.fieldTop}>
          <div className={`${styles.priorityDot} ${f.priority === 'red' ? styles.dotRed : f.priority === 'yellow' ? styles.dotYellow : styles.dotGreen}`} />
          <span className={styles.fieldLabelText}>{f.label}</span>
          {ro ? (
            <span className={styles.readonlyBadge}>{unit.readonlyBadge ?? 'Somente leitura'}</span>
          ) : (
            <span className={`${styles.priorityTag} ${f.priority === 'red' ? styles.tagRed : f.priority === 'yellow' ? styles.tagYellow : styles.tagGreen}`}>
              {PRIORITY_LABEL[f.priority]}
            </span>
          )}
        </div>
        {f.hint && <div className={styles.fieldHint}>{f.hint}</div>}
        {input}
        {hasErr && <div className={styles.fieldErrorMsg}>Campo obrigatório</div>}
      </div>
    );
  }

  // Render seções, agrupando por `group`
  let lastGroup: string | null = null;

  return (
    <div className={styles.wrap}>
      {/* Sidebar */}
      <nav className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarBrand}>
            <div className={styles.sidebarBrandMark}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            </div>
            <div>
              <div className={styles.sidebarBrandName}>Diamantes</div>
              <div className={styles.sidebarBrandSub}>{brandSub}</div>
            </div>
          </div>
        </div>
        <div className={styles.sidebarProgress}>
          <div className={styles.sidebarProgressLabel}>
            Progresso <span>{progress.pct}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
        <div className={styles.sidebarSectionLabel}>Seções</div>
        <div className={styles.sidebarNav}>
          {navUnits.map((u, i) => (
            <button
              type="button"
              key={u.key}
              className={`${styles.navItem} ${i === active ? styles.navItemActive : ''} ${progress.doneKeys.has(u.key) ? styles.navItemDone : ''} ${u.readonly ? styles.navItemAccess : ''}`}
              onClick={() => scrollToUnit(i)}
            >
              <span className={styles.navIcon}>{icon(u.icon)}</span>
              <span className={styles.navLabel}>{u.title}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main */}
      <div className={styles.main}>
        {/* Barra de progresso visível só no mobile (substitui a sidebar) */}
        <div className={styles.mobileProgress}>
          <div className={styles.mobileProgressTop}>
            <span style={{ color: 'var(--bf-sidebar-text)' }}>Progresso do briefing</span>
            <span>{progress.pct}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
          </div>
        </div>

        <div className={styles.pageHeader}>
          {backHref && (
            <button type="button" className={styles.pageBack} onClick={() => (onGhost ? onGhost() : (window.location.href = backHref))}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              <span>{backLabel ?? 'Voltar'}</span>
            </button>
          )}
          <h1 className={styles.pageTitle}>{pageTitle}</h1>
          <div className={styles.pageMeta}>{pageMeta}</div>
        </div>

        {banners}

        {validationItems && validationItems.length > 0 && (
          <div className={styles.validationBar}>
            <strong>⚠️ Preencha os campos obrigatórios (🔴) antes de enviar:</strong>
            <ul>
              {validationItems.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          {navUnits.map((u, i) => {
            const groupNode =
              u.group && u.group !== lastGroup ? (
                <div className={styles.grpLabel} key={`grp-${u.key}`}>{u.group}</div>
              ) : null;
            lastGroup = u.group ?? lastGroup;
            const visibleFields = u.fields.filter((f) => isVisible(u, f));
            const body = u.fields.map((f) => renderField(u, f));
            return (
              <div key={u.key}>
                {groupNode}
                <div
                  ref={(el) => { panelRefs.current[i] = el; }}
                  className={`${styles.sectionPanel} ${u.readonly ? styles.sectionPanelAccess : ''}`}
                >
                  <div className={styles.sectionPanelHeader}>
                    <div className={styles.sectionIcon}>{icon(u.icon)}</div>
                    <div className={styles.sectionTitle}>{u.title}</div>
                    {u.readonly && <span className={styles.sectionTag}>Somente leitura</span>}
                  </div>
                  {u.alert && (
                    <div className={`${styles.sectionNotice} ${styles.noticeWarn}`}>{IconWarn}<span>{u.alert}</span></div>
                  )}
                  {u.hint && (
                    <div className={`${styles.sectionNotice} ${styles.noticeInfo}`}>{IconInfo}<span>{u.hint}</span></div>
                  )}
                  {u.readonly && visibleFields.length === 0 && (
                    <div className={styles.fieldHint}>{u.emptyHint ?? 'Nenhum acesso cadastrado para este serviço.'}</div>
                  )}
                  {u.grid ? <div className={styles.fieldGrid}>{body}</div> : body}
                </div>
              </div>
            );
          })}
          <div style={{ height: 64 }} />
        </div>

        <div className={styles.bottomBar}>
          <div className={`${styles.saveStatus} ${saveState.cls === 'saving' ? styles.saveStatusSaving : saveState.cls === 'saved' ? styles.saveStatusSaved : ''}`}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            <span>{saveState.msg}</span>
          </div>
          <div className={styles.btnGroup}>
            {ghostLabel && onGhost && (
              <button type="button" className={styles.btnGhost} onClick={onGhost}>{ghostLabel}</button>
            )}
            <button type="button" className={styles.btnSend} disabled={submitDisabled} onClick={onSubmit}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
