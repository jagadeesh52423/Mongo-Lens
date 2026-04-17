export function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return '';
  const cols = new Set<string>();
  for (const r of rows) {
    if (r && typeof r === 'object') {
      for (const k of Object.keys(r as Record<string, unknown>)) cols.add(k);
    }
  }
  const colList = [...cols];
  const header = colList.map(csvEscape).join(',');
  const body = rows
    .map((r) =>
      colList
        .map((c) => {
          const v = (r as Record<string, unknown>)[c];
          if (v === undefined || v === null) return '';
          const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return csvEscape(str);
        })
        .join(','),
    )
    .join('\n');
  return `${header}\n${body}`;
}

function csvEscape(s: string): string {
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toJsonText(rows: unknown[]): string {
  return JSON.stringify(rows, null, 2);
}
