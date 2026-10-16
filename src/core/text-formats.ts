/**
 * Small helpers for plain-text formats: type detection and a CSV reader for
 * previews.
 */

/** Guess whether pasted text is JSON, CSV or plain text. */
export function detectTextType(text: string): 'application/json' | 'text/csv' | 'text/plain' {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'application/json';
    } catch {
      /* not JSON */
    }
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  if (lines.length >= 2) {
    const delimiter = guessDelimiter(lines.join('\n'));
    const counts = lines.map((l) => parseCsv(l, delimiter)[0]?.length ?? 0);
    if (counts[0] >= 2 && counts.every((c) => c === counts[0])) return 'text/csv';
  }
  return 'text/plain';
}

export function guessDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  return [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter = guessDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
