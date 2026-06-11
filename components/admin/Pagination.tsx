'use client';

import s from './admin.module.css';

export default function Pagination({
  page,
  pageSize,
  total,
  noun,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className={s.pagination}>
      <span className={s.pgInfo} dangerouslySetInnerHTML={{ __html: `Mostrando <strong>${first}–${last}</strong> de <strong>${total}</strong> ${noun}` }} />
      <div className={s.pageSizeWrap}>
        <span>Itens por página</span>
        <select value={pageSize} onChange={(e) => onPageSize(parseInt(e.target.value, 10) || 25)}>
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
        </select>
      </div>
      <div className={s.pageNav}>
        <button className={s.pageBtn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹
        </button>
        {nums.map((i) => (
          <button key={i} className={`${s.pageBtn} ${i === page ? s.active : ''}`} onClick={() => onPage(i)}>
            {i}
          </button>
        ))}
        <button className={s.pageBtn} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          ›
        </button>
      </div>
    </div>
  );
}
