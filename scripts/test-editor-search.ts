import assert from "node:assert/strict";
import { findEditorMatches } from "../src/lib/editorSearch";

const code = "  steps_per_mm: 80\n  STEPS_PER_MM: 80\n";
assert.deepEqual(findEditorMatches(code, "steps_per_mm: 80"), [2, 21]);
assert.deepEqual(findEditorMatches(code, "  steps_per_mm: 80"), [0, 19]);
assert.deepEqual(findEditorMatches("aaaaa", "aa"), [0, 2]);
assert.deepEqual(findEditorMatches(".* [a] $ + ? (x) {2} \\ ^ |", ".*"), [0]);
for (const term of ["[a]", "$", "+", "?", "(x)", "{2}", "\\", "^", "|"]) {
  assert.deepEqual(findEditorMatches(`prefix ${term} suffix`, term), [7]);
}
// Case conversion must not shift offsets after characters that expand when lowercased.
assert.deepEqual(findEditorMatches("İ steps: 80", "steps: 80"), [2]);
assert.deepEqual(findEditorMatches("🙂 steps: 80", "steps: 80"), [3]);
assert.deepEqual(findEditorMatches(code, "missing"), []);
assert.deepEqual(findEditorMatches(code, ""), []);
assert.deepEqual(findEditorMatches("", "x"), []);
console.log(
  "Editor search: whole-text matches, literal punctuation, non-overlap, case, and Unicode offsets passed",
);
