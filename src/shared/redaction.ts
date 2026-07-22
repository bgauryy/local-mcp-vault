const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|api[_-]?key|authorization|credential)/i;

export function redactSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function redactRecord<T>(record: T): T {
  if (Array.isArray(record)) return record.map((item) => redactRecord(item)) as T;
  if (!record || typeof record !== 'object') return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = typeof value === 'string' ? redactSecret(value) : '[redacted]';
    } else if (value && typeof value === 'object') {
      out[key] = redactRecord(value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
