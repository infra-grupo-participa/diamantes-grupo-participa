import styles from './BriefingForm.module.css';

/** Skeleton (shimmer) exibido enquanto o briefing carrega — espelha o layout sidebar + main. */
export default function BriefingSkeleton() {
  return (
    <div className={styles.skel} aria-hidden="true">
      <div className={styles.skelSidebar}>
        <div className={styles.skelBlock} style={{ height: 30, width: '70%' }} />
        <div className={styles.skelBlock} style={{ height: 12, width: '100%', marginTop: 12 }} />
        <div className={styles.skelBlock} style={{ height: 34, width: '100%' }} />
        <div className={styles.skelBlock} style={{ height: 34, width: '100%' }} />
        <div className={styles.skelBlock} style={{ height: 34, width: '100%' }} />
        <div className={styles.skelBlock} style={{ height: 34, width: '100%' }} />
      </div>
      <div className={styles.skelMain}>
        <div className={styles.skelBlock} style={{ height: 26, width: '45%' }} />
        <div className={styles.skelBlock} style={{ height: 14, width: '60%' }} />
        <div className={styles.skelBlock} style={{ height: 72, width: '100%', marginTop: 4 }} />
        <div className={styles.skelCard}>
          <div className={styles.skelBlock} style={{ height: 20, width: '40%' }} />
          <div className={styles.skelBlock} style={{ height: 42, width: '100%' }} />
          <div className={styles.skelBlock} style={{ height: 42, width: '100%' }} />
          <div className={styles.skelBlock} style={{ height: 42, width: '70%' }} />
        </div>
        <div className={styles.skelCard}>
          <div className={styles.skelBlock} style={{ height: 20, width: '35%' }} />
          <div className={styles.skelBlock} style={{ height: 42, width: '100%' }} />
          <div className={styles.skelBlock} style={{ height: 42, width: '85%' }} />
        </div>
      </div>
    </div>
  );
}
