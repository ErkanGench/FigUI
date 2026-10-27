import assert from "node:assert/strict";
import {
  indentLines,
  smartHomeOffset,
  indentBackspace,
} from "../src/lib/editorIndent";

const yaml = "axes:\n  x:\n    steps_per_mm: 80\n  y:\n";
const start = yaml.indexOf("  x:");
const end = yaml.indexOf("  y:");
const indented = indentLines(yaml, start, end, false);
assert.equal(indented.code, "axes:\n    x:\n      steps_per_mm: 80\n  y:\n");
assert.deepEqual(
  indentLines(indented.code, indented.start, indented.end, true),
  {
    code: yaml,
    start,
    end,
  },
);
// Reverse selections keep the active end and exclude the next untouched line.
const reversed = indentLines(yaml, end, start, false);
assert.equal(reversed.code, indented.code);
assert.equal(reversed.start, indented.end);
assert.equal(reversed.end, indented.start);

assert.deepEqual(indentLines("  key: value", 7, 7, true), {
  code: "key: value",
  start: 5,
  end: 5,
});
assert.deepEqual(indentLines("  key", 1, 1, true), {
  code: "key",
  start: 0,
  end: 0,
});
assert.deepEqual(indentLines("key", 0, 0, true), {
  code: "key",
  start: 0,
  end: 0,
});
assert.deepEqual(indentLines("\nkey", 0, 1, false), {
  code: "  \nkey",
  start: 2,
  end: 3,
});
assert.deepEqual(indentLines("key\n", 4, 4, false), {
  code: "key\n  ",
  start: 6,
  end: 6,
});
const mixed = "\tkey\n value\n    child";
assert.equal(
  indentLines(mixed, 0, mixed.length, true).code,
  "key\nvalue\n  child",
);
// A partially selected line moves as a unit; it is never replaced by spaces.
assert.deepEqual(indentLines("  name: Mill", 4, 6, false), {
  code: "    name: Mill",
  start: 6,
  end: 8,
});
console.log(
  "Editor indentation: YAML blocks, selection boundaries/direction, blank lines, tabs, and caret offsets passed",
);

const indentedLine = "axes:\n    x: 80\n";
assert.equal(smartHomeOffset(indentedLine, 14), 10);
assert.equal(smartHomeOffset(indentedLine, 10), 6);
assert.equal(smartHomeOffset(indentedLine, 6), 10);
assert.equal(smartHomeOffset("\n  value", 0), 0);
assert.equal(smartHomeOffset("\t  value", 7), 3);
assert.equal(smartHomeOffset("  \n", 1), 2);
assert.equal(
  smartHomeOffset(indentedLine, indentedLine.length),
  indentedLine.length,
);
assert.deepEqual(indentBackspace(indentedLine, 10, 10), {
  code: "axes:\n  x: 80\n",
  start: 8,
  end: 8,
});
assert.deepEqual(indentBackspace(indentedLine, 9, 9), {
  code: "axes:\n   x: 80\n",
  start: 8,
  end: 8,
});
assert.deepEqual(indentBackspace(" value", 1, 1), {
  code: "value",
  start: 0,
  end: 0,
});
assert.equal(indentBackspace(indentedLine, 6, 6), null);
assert.equal(indentBackspace(indentedLine, 10, 14), null);
assert.equal(indentBackspace("key:  value", 6, 6), null);
assert.equal(indentBackspace("\tvalue", 1, 1), null);
console.log(
  "Smart Home and indentation Backspace: line boundaries, odd indentation, tabs, selections, and normal text passed",
);
