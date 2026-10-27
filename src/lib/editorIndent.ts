/** Home alternates between the first non-whitespace character and column one. */
export function smartHomeOffset(code: string, focus: number) {
  const start = focus === 0 ? 0 : code.lastIndexOf("\n", focus - 1) + 1;
  const firstText =
    start + (code.slice(start).match(/^[ \t]*/)?.[0].length ?? 0);
  return focus === firstText ? start : firstText;
}

/** Delete to the previous two-column indent stop; leave ordinary deletion native. */
export function indentBackspace(code: string, start: number, end: number) {
  if (start !== end) return null;
  const lineStart = start === 0 ? 0 : code.lastIndexOf("\n", start - 1) + 1;
  const prefix = code.slice(lineStart, start);
  if (!/^ +$/.test(prefix)) return null;
  const next = start - (prefix.length % 2 || 2);
  return {
    code: code.slice(0, next) + code.slice(start),
    start: next,
    end: next,
  };
}

/** Shift whole lines, retaining selection direction and relative YAML indentation. */
export function indentLines(
  code: string,
  start: number,
  end: number,
  outdent: boolean,
) {
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const first = low === 0 ? 0 : code.lastIndexOf("\n", low - 1) + 1;
  // Ending at column one must not indent the next, unselected line.
  const last = high > low && code[high - 1] === "\n" ? high - 1 : high;
  let nextStart = start;
  let nextEnd = end;
  let offset = first;
  const newline = code.indexOf("\n", last);
  const stop = newline < 0 ? code.length : newline;
  const lines = code
    .slice(first, stop)
    .split("\n")
    .map((line) => {
      const removed = outdent
        ? (line.match(/^(?: {1,2}|\t)/)?.[0].length ?? 0)
        : 0;
      const added = outdent ? 0 : 2;
      const move = (position: number) =>
        position < offset ? 0 : added - Math.min(removed, position - offset);
      nextStart += move(start);
      nextEnd += move(end);
      offset += line.length + 1;
      return " ".repeat(added) + line.slice(removed);
    });
  return {
    code: code.slice(0, first) + lines.join("\n") + code.slice(stop),
    start: nextStart,
    end: nextEnd,
  };
}
