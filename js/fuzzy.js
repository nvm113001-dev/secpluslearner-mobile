// Ported from app/fuzzy.py. `ratio()` reimplements the same metric as
// Python's difflib.SequenceMatcher.ratio() -- 2*M / T where M is the total
// length of matching blocks (via longest-common-subsequence-style matching)
// and T is the combined length of both strings -- so the 0.75/0.5 thresholds
// carried over from the desktop app mean the same thing here.

const STOP_WORDS = new Set(["a", "an", "the", "is", "are", "was", "were", "of", "in", "on", "at", "to", "for", "and", "or"]);

function normalize(text) {
  text = text.toLowerCase().trim();
  text = text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g, "");
  return text.split(/\s+/).filter((w) => w && !STOP_WORDS.has(w)).join(" ");
}

// Longest common subsequence length via DP -- used the same way
// SequenceMatcher's matching-blocks total is used in the ratio formula.
function lcsLength(a, b) {
  const n = a.length, m = b.length;
  if (n === 0 || m === 0) return 0;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const curr = new Array(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[m];
}

function ratio(a, b) {
  if (!a.length && !b.length) return 1.0;
  const matches = lcsLength(a, b);
  return (2.0 * matches) / (a.length + b.length);
}

function checkAnswer(userInput, correctAnswer) {
  if (!userInput.trim()) {
    return { isCorrect: false, ratio: 0.0, feedback: "Please type an answer." };
  }

  const normUser = normalize(userInput);
  const normCorrect = normalize(correctAnswer);
  const r = ratio(normUser, normCorrect);

  if (r >= 0.75) {
    return { isCorrect: true, ratio: r, feedback: "Correct!" };
  }

  const correctKw = new Set(normCorrect.split(" ").filter(Boolean));
  const userKw = new Set(normUser.split(" ").filter(Boolean));
  const overlap = [...correctKw].filter((w) => userKw.has(w)).length;
  const kwRatio = correctKw.size ? overlap / correctKw.size : 0;

  if (kwRatio >= 0.6) {
    return { isCorrect: true, ratio: kwRatio, feedback: "Correct — key terms matched!" };
  }

  if (r >= 0.5 || kwRatio >= 0.4) {
    return { isCorrect: false, ratio: r, feedback: `Almost! (${Math.round(r * 100)}% match) — check the explanation.` };
  }

  return { isCorrect: false, ratio: r, feedback: "Not quite — review the explanation below." };
}

window.Fuzzy = { checkAnswer, normalize };
