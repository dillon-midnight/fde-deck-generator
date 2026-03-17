import type { Deck } from "./schemas";

interface DiffResult {
  slides_modified: number[];
  slides_added: number[];
  slides_deleted: number[];
  slides_reordered: boolean;
  changes: Array<{
    slide_number: number;
    field: string;
    from: unknown;
    to: unknown;
  }>;
}

export function computeDiff(original: Deck, edited: Deck): DiffResult {
  const result: DiffResult = {
    slides_modified: [],
    slides_added: [],
    slides_deleted: [],
    slides_reordered: false,
    changes: [],
  };

  const originalMap = new Map(original.slides.map((s) => [s.slide_number, s]));
  const editedMap = new Map(edited.slides.map((s) => [s.slide_number, s]));

  // Find deleted slides
  for (const num of originalMap.keys()) {
    if (!editedMap.has(num)) {
      result.slides_deleted.push(num);
    }
  }

  // Find added slides
  for (const num of editedMap.keys()) {
    if (!originalMap.has(num)) {
      result.slides_added.push(num);
    }
  }

  // Find modified slides
  for (const [num, editedSlide] of editedMap) {
    const originalSlide = originalMap.get(num);
    if (!originalSlide) continue;

    const fields = ["title", "talking_points", "features", "sources"] as const;
    let modified = false;

    for (const field of fields) {
      const origVal = JSON.stringify(originalSlide[field]);
      const editVal = JSON.stringify(editedSlide[field]);
      if (origVal !== editVal) {
        modified = true;
        result.changes.push({
          slide_number: num,
          field,
          from: originalSlide[field],
          to: editedSlide[field],
        });
      }
    }

    if (modified) {
      result.slides_modified.push(num);
    }
  }

  // Check reorder
  const origOrder = original.slides.map((s) => s.slide_number);
  const editOrder = edited.slides.map((s) => s.slide_number);
  const commonOrig = origOrder.filter((n) => editedMap.has(n));
  const commonEdit = editOrder.filter((n) => originalMap.has(n));
  result.slides_reordered = JSON.stringify(commonOrig) !== JSON.stringify(commonEdit);

  return result;
}
