const CHECKLIST_ITEM = /^\s*[-*]\s*\[([ xX/-])\]\s+\S/;
const PLAN_HEADING = /^#{1,6}\s+(?:Plan|Implementation Plan|Proposed Changes|Roadmap|Design)\b/i;

function countChecklistItems(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (CHECKLIST_ITEM.test(line)) n++;
  }
  return n;
}

/**
 * Pick the most recent usable checklist from a chronological list of text blobs.
 * Recency wins over completeness: the latest ledger reflects current state.
 */
export function extractChecklist(texts: string[]): string | null {
  let best: string | null = null;
  let bestItems = 0;

  for (const text of texts) {
    const count = countChecklistItems(text);
    if (count === 0) continue;
    // A later blob replaces an earlier one once it has >=2 items (a real ledger,
    // not an incidental single bullet). Single-item blobs only fill an empty slot.
    if (count >= 2 || best === null) {
      best = sliceChecklist(text);
      bestItems = count;
    }
  }

  return bestItems > 0 ? best : null;
}

function sliceChecklist(text: string): string {
  const lines = text.split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (CHECKLIST_ITEM.test(lines[i])) {
      if (start === -1) start = i;
      end = i;
    }
  }
  if (start === -1) return text.trim();
  // Keep indented continuation/sub-items between checklist lines.
  return lines.slice(start, end + 1).join("\n").trim();
}

/**
 * Pick the most recent plan section from a chronological list of text blobs.
 * Captures from the plan heading to the end of the blob. No heading => no plan.
 */
export function extractPlan(texts: string[]): string | null {
  let result: string | null = null;
  for (const text of texts) {
    const lines = text.split("\n");
    const headingIdx = lines.findIndex((l) => PLAN_HEADING.test(l));
    if (headingIdx !== -1) {
      result = lines.slice(headingIdx).join("\n").trim();
    }
  }
  return result;
}
