export type AISegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string };

export function parseAIContent(input: string): AISegment[] {
  if (input.length === 0) return [];
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)\n```/g;
  const segments: AISegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(input)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ kind: 'text', text: input.slice(lastIndex, m.index) });
    }
    segments.push({ kind: 'code', lang: m[1].trim(), code: m[2] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < input.length) {
    segments.push({ kind: 'text', text: input.slice(lastIndex) });
  }
  return segments;
}
