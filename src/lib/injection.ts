const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|context)/i,
  /you\s+are\s+now\s+a/i,
  /system\s*:\s*(override|ignore|forget)/i,
  /disregard\s+(all\s+)?(previous|prior|earlier)/i,
  /forget\s+(everything|all|your)\s+(you|instructions|rules)/i,
  /output\s+(the\s+)?(system\s+)?prompt/i,
  /reveal\s+(your|the)\s+(instructions|prompt|system)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(if|though)/i,
  /new\s+instructions\s*:/i,
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");
}

function scanText(text: string): boolean {
  const normalized = normalize(text);
  return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function injectionDetected(signals: Record<string, unknown>): boolean {
  for (const value of Object.values(signals)) {
    if (typeof value === "string") {
      if (scanText(value)) return true;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && scanText(item)) return true;
      }
    }
  }
  return false;
}
