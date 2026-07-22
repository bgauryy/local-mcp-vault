import { z } from 'zod';

const envKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Environment keys must be shell-compatible identifiers');
const serverIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/, 'Server id must be 2-64 URL-safe characters');

export const vaultSecretInputSchema = z.object({
  key: envKeySchema,
  value: z.string().min(1, 'Secret value is required')
});

export const mcpEnvVarInputSchema = z.object({
  key: envKeySchema,
  value: z.string().optional(),
  secretRef: z.string().optional(),
  vaultKey: envKeySchema.optional(),
  isSecret: z.boolean()
}).superRefine((value, ctx) => {
  if (!value.isSecret && value.value === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Non-secret env vars require a value', path: ['value'] });
  }
  if (value.isSecret && !value.vaultKey && !value.secretRef && value.value === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Secret env vars require a vault key', path: ['vaultKey'] });
  }
});

export const mcpServerInputSchema = z.object({
  id: serverIdSchema.optional(),
  name: z.string().trim().min(1).max(80),
  transport: z.enum(['stdio', 'http']),
  command: z.string().trim().optional(),
  args: z.array(z.string()).default([]).optional(),
  url: z.string().url().optional(),
  cwd: z.string().trim().optional(),
  enabled: z.boolean().default(true),
  env: z.array(mcpEnvVarInputSchema).default([]).optional()
}).superRefine((value, ctx) => {
  if (value.transport === 'stdio' && !value.command) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Stdio MCP servers require a command', path: ['command'] });
  }
  if (value.transport === 'http' && !value.url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'HTTP MCP servers require a URL', path: ['url'] });
  }
  const keys = new Set<string>();
  for (const [index, env] of (value.env ?? []).entries()) {
    if (keys.has(env.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate env key: ${env.key}`, path: ['env', index, 'key'] });
    }
    keys.add(env.key);
  }
});

export function parseMcpServerInput(input: unknown) {
  return mcpServerInputSchema.parse(input);
}

export function parseVaultSecretInput(input: unknown) {
  return vaultSecretInputSchema.parse(input);
}

export function makeServerId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || `mcp-${Date.now().toString(36)}`;
}
