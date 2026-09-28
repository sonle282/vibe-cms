// Line diff for the writer tests: which lines were removed from `a` and added in `b` (LCS; \r is kept in lines, so a
// CRLF → LF change shows up as changed lines).
export const lineDiff = (a, b) => {
  const x = a.split("\n"); const y = b.split("\n");
  const n = x.length; const m = y.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const removed = []; const added = [];
  let i = 0; let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { i += 1; j += 1; } else if (j < m && (i === n || table[i][j + 1] >= table[i + 1][j])) { added.push({ line: j + 1, text: y[j] }); j += 1; } else { removed.push({ line: i + 1, text: x[i] }); i += 1; }
  }
  return { removed, added };
};

export const showDiff = ({ removed, added }) => [...removed.map((r) => `-${r.line}: ${JSON.stringify(r.text)}`), ...added.map((a) => `+${a.line}: ${JSON.stringify(a.text)}`)].join("\n");
