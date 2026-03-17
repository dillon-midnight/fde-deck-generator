import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// Tagged template proxy that lazily initializes the connection
export const sql = new Proxy({} as NeonQueryFunction<false, false>, {
  apply(_target, _thisArg, args) {
    return getSql()(...(args as [TemplateStringsArray, ...any[]]));
  },
  get(_target, prop) {
    return (getSql() as any)[prop];
  },
});
