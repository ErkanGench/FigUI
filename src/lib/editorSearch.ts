/** Literal, non-overlapping matches in document coordinates, independent of tokens. */
export function findEditorMatches(text: string, term: string): number[] {
  if (!term) return [];
  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) matches.push(match.index);
  return matches;
}

export function applySearchMarks(
  editor: HTMLElement,
  term: string,
  activeIndex: number,
) {
  const matches = findEditorMatches(editor.textContent ?? "", term);
  if (!matches.length) return;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  let offset = 0;
  let matchIndex = 0;
  for (const node of nodes) {
    const text = node.data;
    const end = offset + text.length;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    while (matchIndex < matches.length && matches[matchIndex] < end) {
      const start = Math.max(0, matches[matchIndex] - offset);
      const stop = Math.min(
        text.length,
        matches[matchIndex] + term.length - offset,
      );
      fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement("mark");
      mark.className =
        matchIndex === activeIndex ? "hl-search-active" : "hl-search";
      mark.textContent = text.slice(start, stop);
      fragment.appendChild(mark);
      cursor = stop;
      // One logical match may continue across several syntax-colored nodes.
      if (matches[matchIndex] + term.length > end) break;
      matchIndex++;
    }
    if (cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
      node.replaceWith(fragment);
    }
    offset = end;
  }
}
