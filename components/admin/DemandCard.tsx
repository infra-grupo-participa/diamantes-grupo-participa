'use client';

import { initials } from '@/lib/format';
import {
  STATUS_BADGE,
  dueLabel,
  clickupTaskUrl,
  type Demand,
  type DemandMemberLite,
  type OperatorUser,
} from '@/lib/api/admin-demandas';
import styles from '@/app/admin/demandas/demandas.module.css';

const ClickUpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

function Avatars({
  members,
  usersById,
  max,
}: {
  members: DemandMemberLite[];
  usersById: Record<string, OperatorUser>;
  max: number;
}) {
  const ops = members.filter((m) => m.role === 'operator');
  const visible = ops.slice(0, max);
  const moreCount = ops.length - visible.length;
  if (ops.length === 0) return <span className={styles.noTeam}>sem equipe</span>;
  return (
    <div className={styles.avatars}>
      {visible.map((m) => {
        const u = usersById[m.user_id];
        const name = u?.name || '—';
        return (
          <div key={m.user_id} className={styles.avatar} title={name}>
            {initials(name)}
          </div>
        );
      })}
      {moreCount > 0 && <div className={styles.avatarMore}>+{moreCount}</div>}
    </div>
  );
}

/** Card padrão do Kanban (por status). */
export function DemandCard({
  demand,
  members,
  usersById,
  onOpen,
}: {
  demand: Demand;
  members: DemandMemberLite[];
  usersById: Record<string, OperatorUser>;
  onOpen: (id: string) => void;
}) {
  const due = dueLabel(demand);
  const dueCls = due.cls ? `${styles.due} ${styles[due.cls]}` : styles.due;

  return (
    <div className={styles.kcard} onClick={() => onOpen(demand.id)}>
      <div className={styles.cardTop}>
        <div>
          <div className={styles.cardTitle}>{demand.title || 'Sem título'}</div>
          <div className={styles.cardClient}>
            {demand.client_name || demand.client_slug || '—'}
          </div>
        </div>
      </div>
      <div className={styles.metaRow}>
        <Avatars members={members} usersById={usersById} max={4} />
        <span className={dueCls}>{due.text}</span>
      </div>
      {(Number(demand.messages_count) > 0 || demand.clickup_task_id) && (
        <div className={styles.cardFoot}>
          {Number(demand.messages_count) > 0 && (
            <span className={styles.chatCount}>
              <ChatIcon />
              {demand.messages_count}
            </span>
          )}
          {demand.clickup_task_id && (
            <a
              className={styles.cuLink}
              href={clickupTaskUrl(demand.clickup_task_id)}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir no ClickUp"
              onClick={(e) => e.stopPropagation()}
            >
              <ClickUpIcon />
              ClickUp
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Card compacto da view por aluno (badge de status + título + prazo). */
export function StudentDemandCard({
  demand,
  members,
  usersById,
  onOpen,
}: {
  demand: Demand;
  members: DemandMemberLite[];
  usersById: Record<string, OperatorUser>;
  onOpen: (id: string) => void;
}) {
  const due = dueLabel(demand);
  const dueCls = due.cls ? `${styles.due} ${styles[due.cls]}` : styles.due;
  const miniCls =
    demand.status === 'open'
      ? styles.open
      : demand.status === 'in_progress'
        ? styles.prog
        : demand.status === 'review'
          ? styles.review
          : demand.status === 'done'
            ? styles.done
            : styles.cancel;
  const label = STATUS_BADGE[demand.status]?.label || demand.status;

  return (
    <div
      className={styles.kcard}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(demand.id);
      }}
    >
      <span className={`${styles.badgeMini} ${miniCls}`}>{label}</span>
      <div className={styles.cardTitle}>{demand.title || 'Sem título'}</div>
      <div className={styles.metaRow}>
        <Avatars members={members} usersById={usersById} max={3} />
        <span className={dueCls}>{due.text}</span>
      </div>
    </div>
  );
}
