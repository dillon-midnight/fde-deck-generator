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

// Normalize leet-speak substitutions before pattern matching.
// A naive regex on raw input would miss "1gn0re pr3v10us 1nstruct10ns".
// Attackers who know you use regex will probe with character substitutions.
// Normalizing to plain ASCII first collapses the evasion surface before
// the patterns run. This is not comprehensive — a determined attacker with
// enough creativity will find gaps — but it raises the cost of evasion
// significantly for the most common substitution patterns.
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
      // Scan array fields (pain_points, use_cases, objections, tools) individually.
    // An attacker who knows the schema is validated as an object would embed
    // injection in an array item expecting only top-level fields to be scanned.
    // Every string reachable from the signals object is a potential injection
    // vector and must be checked.
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && scanText(item)) return true;
      }
    }
  }
  return false;
}
