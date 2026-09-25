'use client';

// Briefing obrigatório de edição de vídeo — entra no lugar da descrição livre
// quando o tipo da demanda é 'editor-video'. Componente controlado: sem estado
// próprio e sem rede; o NewDemandModal guarda o rascunho e valida.

import {
  VIDEO_ARQUIVO_OPTIONS,
  VIDEO_FIELD_LABELS,
  VIDEO_FORMATO_OPTIONS,
  VIDEO_PECA_OPTIONS,
  VIDEO_TEXT_MAX,
  isNonDriveUrl,
  type VideoArquivo,
  type VideoBriefingDraft,
  type VideoBriefingErrors,
  type VideoBriefingField,
  type VideoFormato,
} from '@/lib/video-briefing';
import styles from './Modal.module.css';

/** id do elemento focável de cada campo (checkbox group → primeiro checkbox). */
export function videoFieldId(prefix: string, field: VideoBriefingField): string {
  return `${prefix}-vb-${field}`;
}

export default function VideoBriefingForm({
  idPrefix,
  value,
  errors,
  disabled,
  onChange,
}: {
  idPrefix: string;
  value: VideoBriefingDraft;
  errors: VideoBriefingErrors;
  disabled?: boolean;
  onChange: (patch: Partial<VideoBriefingDraft>) => void;
}) {
  const id = (f: VideoBriefingField) => videoFieldId(idPrefix, f);
  const errId = (f: VideoBriefingField) => `${id(f)}-err`;
  const invalid = (f: VideoBriefingField) =>
    errors[f] ? { 'aria-invalid': true as const, 'aria-describedby': errId(f) } : {};
  const errLine = (f: VideoBriefingField) =>
    errors[f] ? (
      <div id={errId(f)} className={styles.fieldError}>
        {errors[f]}
      </div>
    ) : null;

  function toggle<T extends string>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  const text = (
    f: 'decupagem' | 'direcao_visual' | 'textos_tela' | 'assets_url' | 'observacoes',
    required: boolean,
    placeholder: string,
    rows = 2,
  ) => (
    <div>
      <label className={styles.label} htmlFor={id(f)}>
        {VIDEO_FIELD_LABELS[f]} {!required && <span className={styles.opt}>(opcional)</span>}
      </label>
      <textarea
        id={id(f)}
        className={styles.textarea}
        rows={rows}
        maxLength={VIDEO_TEXT_MAX}
        placeholder={placeholder}
        value={value[f]}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange({ [f]: e.target.value } as Partial<VideoBriefingDraft>)}
        {...invalid(f)}
      />
      {errLine(f)}
    </div>
  );

  const materialWarn = !errors.material_url && isNonDriveUrl(value.material_url);
  const entregaWarn = !errors.entrega_url && isNonDriveUrl(value.entrega_url);

  return (
    <div className={styles.vbForm}>
      <div className={styles.vbHead}>Briefing de edição de vídeo</div>

      <div className={styles.grid2}>
        <div>
          <label className={styles.label} htmlFor={id('peca')}>
            {VIDEO_FIELD_LABELS.peca}
          </label>
          <select
            id={id('peca')}
            className={styles.select}
            value={value.peca}
            disabled={disabled}
            required
            onChange={(e) => onChange({ peca: e.target.value as VideoBriefingDraft['peca'] })}
            {...invalid('peca')}
          >
            <option value="">— Selecione —</option>
            {VIDEO_PECA_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errLine('peca')}
        </div>
        {value.peca === 'outro' ? (
          <div>
            <label className={styles.label} htmlFor={id('peca_outro')}>
              {VIDEO_FIELD_LABELS.peca_outro}
            </label>
            <input
              id={id('peca_outro')}
              className={styles.input}
              type="text"
              maxLength={VIDEO_TEXT_MAX}
              value={value.peca_outro}
              disabled={disabled}
              required
              onChange={(e) => onChange({ peca_outro: e.target.value })}
              {...invalid('peca_outro')}
            />
            {errLine('peca_outro')}
          </div>
        ) : (
          <div />
        )}
      </div>

      <fieldset
        className={styles.fieldset}
        aria-describedby={errors.formatos ? errId('formatos') : undefined}
        aria-invalid={errors.formatos ? true : undefined}
      >
        <legend className={styles.label}>{VIDEO_FIELD_LABELS.formatos}</legend>
        <div className={styles.checkRow}>
          {VIDEO_FORMATO_OPTIONS.map((o, i) => (
            <label key={o.value} className={styles.checkItem}>
              <input
                id={i === 0 ? id('formatos') : undefined}
                type="checkbox"
                checked={value.formatos.includes(o.value)}
                disabled={disabled}
                onChange={() =>
                  onChange({
                    formatos: toggle<VideoFormato>(value.formatos, o.value),
                  })
                }
              />
              {o.label}
            </label>
          ))}
        </div>
        {errLine('formatos')}
      </fieldset>
      {value.formatos.includes('outro') && (
        <div>
          <label className={styles.label} htmlFor={id('formato_outro')}>
            {VIDEO_FIELD_LABELS.formato_outro}
          </label>
          <input
            id={id('formato_outro')}
            className={styles.input}
            type="text"
            maxLength={VIDEO_TEXT_MAX}
            placeholder="Ex: 2:3, 21:9"
            value={value.formato_outro}
            disabled={disabled}
            required
            onChange={(e) => onChange({ formato_outro: e.target.value })}
            {...invalid('formato_outro')}
          />
          {errLine('formato_outro')}
        </div>
      )}

      <fieldset
        className={styles.fieldset}
        aria-describedby={errors.arquivo ? errId('arquivo') : undefined}
        aria-invalid={errors.arquivo ? true : undefined}
      >
        <legend className={styles.label}>{VIDEO_FIELD_LABELS.arquivo}</legend>
        <div className={styles.checkRow}>
          {VIDEO_ARQUIVO_OPTIONS.map((o, i) => (
            <label key={o.value} className={styles.checkItem}>
              <input
                id={i === 0 ? id('arquivo') : undefined}
                type="checkbox"
                checked={value.arquivo.includes(o.value)}
                disabled={disabled}
                onChange={() =>
                  onChange({
                    arquivo: toggle<VideoArquivo>(value.arquivo, o.value),
                  })
                }
              />
              {o.label}
            </label>
          ))}
        </div>
        {errLine('arquivo')}
      </fieldset>

      <div>
        <label className={styles.label} htmlFor={id('material_url')}>
          {VIDEO_FIELD_LABELS.material_url}
        </label>
        <input
          id={id('material_url')}
          className={styles.input}
          type="url"
          inputMode="url"
          maxLength={VIDEO_TEXT_MAX}
          placeholder="https://drive.google.com/…"
          value={value.material_url}
          disabled={disabled}
          required
          onChange={(e) => onChange({ material_url: e.target.value })}
          {...invalid('material_url')}
        />
        {errLine('material_url')}
        {materialWarn && (
          <div className={styles.fieldWarn}>
            Atenção: não é um link do Google Drive. Confira se a equipe tem acesso a ele.
          </div>
        )}
      </div>

      {text('decupagem', true, 'Trechos e minutagem (ex: 02:10–03:45) ou "usar o material inteiro".')}
      {text('direcao_visual', true, 'Ritmo, cortes, cores, trilha, referências de estilo…')}
      {text('textos_tela', false, 'Headline e letterings que devem aparecer no vídeo.')}

      <div>
        <label className={styles.label} htmlFor={id('entrega_url')}>
          {VIDEO_FIELD_LABELS.entrega_url} <span className={styles.opt}>(opcional)</span>
        </label>
        <input
          id={id('entrega_url')}
          className={styles.input}
          type="url"
          inputMode="url"
          maxLength={VIDEO_TEXT_MAX}
          placeholder="https://drive.google.com/…"
          value={value.entrega_url}
          disabled={disabled}
          onChange={(e) => onChange({ entrega_url: e.target.value })}
          {...invalid('entrega_url')}
        />
        {errLine('entrega_url')}
        {entregaWarn && (
          <div className={styles.fieldWarn}>
            Atenção: não é um link do Google Drive. Confira se a equipe consegue gravar nele.
          </div>
        )}
        {!value.entrega_url.trim() && (
          <small className={styles.hint}>Em branco: a entrega vai para a pasta do material bruto.</small>
        )}
      </div>

      {text('assets_url', false, 'Logos, fontes, músicas, links específicos…')}
      {text('observacoes', false, 'Qualquer outra informação para o editor.')}
    </div>
  );
}
