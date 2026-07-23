import { create } from 'zustand';
import type { McpServerInput, McpServerWithEnv, ServerHealth, VaultSecretRecord, VaultStatus } from '../shared/types.js';
import {
  buildDashboardMetrics,
  buildEditForm,
  createEnvParamDraft,
  envDraftsFromServer,
  envDraftsToInput,
  filterServers,
  splitArgs,
  withOptionalField,
  type EnvParamDraft,
} from './app-model.js';
import { getLocalMcpVaultApi, missingBridgeMessage } from './api.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Page = 'vault' | 'add-server' | 'servers' | 'dashboard' | 'help';
export type ToastKind = 'info' | 'success' | 'error';
export type DraftField = 'cwd' | 'command' | 'url';

export interface Toast {
  kind: ToastKind;
  text: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SERVER_FORM: McpServerInput = {
  name: '',
  transport: 'stdio',
  command: '',
  args: [],
  enabled: true,
  env: [],
};

export const DEFAULT_SECRET_FORM = { key: '', value: '' };

// ─── State shape ──────────────────────────────────────────────────────────────

interface AppState {
  // Remote data
  servers: McpServerWithEnv[];
  secrets: VaultSecretRecord[];
  vault: VaultStatus | null;
  accessKey: string;
  gatewayAddress: string;
  serverHealth: Record<string, ServerHealth>;

  // UI state
  page: Page;
  query: string;
  isLoading: boolean;
  isSaving: boolean;
  updatingServerId: string | null;
  toast: Toast | null;

  // Form state
  serverForm: McpServerInput;
  secretForm: { key: string; value: string };
  envRows: EnvParamDraft[];

  // ── UI actions ──────────────────────────────────────────────────────────────
  setPage: (page: Page) => void;
  setQuery: (query: string) => void;
  setToast: (toast: Toast | null) => void;
  startNewServer: () => void;

  // ── Form actions ────────────────────────────────────────────────────────────
  setServerForm: (form: McpServerInput) => void;
  setSecretForm: (form: { key: string; value: string }) => void;
  setDraftField: (key: DraftField, value: string) => void;
  updateEnvRow: (id: string, patch: Partial<EnvParamDraft>) => void;
  addEnvRow: () => void;
  removeEnvRow: (id: string) => void;

  // ── Async actions ───────────────────────────────────────────────────────────
  refresh: (showLoading?: boolean) => Promise<void>;
  saveSecret: () => Promise<void>;
  deleteSecret: (key: string) => Promise<void>;
  saveServer: () => Promise<void>;
  toggleServer: (server: McpServerWithEnv) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  editServer: (server: McpServerWithEnv) => void;
  copyClientConfig: (server: McpServerWithEnv) => Promise<void>;
  rotateServerKey: (server: McpServerWithEnv) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected application error';
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  // Remote data
  servers: [],
  secrets: [],
  vault: null,
  accessKey: '',
  gatewayAddress: '',
  serverHealth: {},

  // UI state
  page: 'vault',
  query: '',
  isLoading: true,
  isSaving: false,
  updatingServerId: null,
  toast: { kind: 'info', text: 'Loading vault…' },

  // Form state
  serverForm: DEFAULT_SERVER_FORM,
  secretForm: DEFAULT_SECRET_FORM,
  envRows: [createEnvParamDraft(0)],

  // ── UI actions ──────────────────────────────────────────────────────────────

  setPage: (page) => set({ page }),
  setQuery: (query) => set({ query }),
  setToast: (toast) => set({ toast }),

  startNewServer: () =>
    set({
      serverForm: DEFAULT_SERVER_FORM,
      // With an empty vault there is nothing to map, so default to a Plain row.
      envRows: [createEnvParamDraft(0, get().secrets.length ? 'vault' : 'plain')],
      page: 'add-server',
    }),

  // ── Form actions ────────────────────────────────────────────────────────────

  setServerForm: (serverForm) => set({ serverForm }),

  setSecretForm: (secretForm) => set({ secretForm }),

  setDraftField: (key, value) => {
    const { serverForm } = get();
    set({ serverForm: withOptionalField(serverForm, key, value) });
  },

  updateEnvRow: (id, patch) =>
    set((s) => ({
      envRows: s.envRows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    })),

  addEnvRow: () =>
    set((s) => ({
      envRows: [...s.envRows, createEnvParamDraft(s.envRows.length, s.secrets.length ? 'vault' : 'plain')],
    })),

  removeEnvRow: (id) =>
    set((s) => ({
      envRows:
        s.envRows.length === 1
          ? [createEnvParamDraft(0, s.secrets.length ? 'vault' : 'plain')]
          : s.envRows.filter((row) => row.id !== id),
    })),

  // ── Async actions ───────────────────────────────────────────────────────────

  async refresh(showLoading = true) {
    const api = getLocalMcpVaultApi();
    if (!api) {
      set({ toast: { kind: 'error', text: missingBridgeMessage() }, isLoading: false });
      return;
    }
    try {
      if (showLoading) set({ isLoading: true });
      const [serverList, secretList, vaultStatus, gateway] = await Promise.all([
        api.listServers(),
        api.listVaultSecrets(),
        api.vaultStatus(),
        api.gatewayConfig(),
      ]);
      set({
        servers: serverList,
        secrets: secretList,
        vault: vaultStatus,
        accessKey: gateway.accessKey,
        gatewayAddress: `${gateway.host}:${gateway.port}`,
        toast: {
          kind: vaultStatus.status === 'blocked' ? 'error' : 'success',
          text: vaultStatus.message,
        },
      });
      // Fetch per-server health in the background; never let one failure block the view.
      const health = await Promise.all(
        serverList.map((s) =>
          api
            .serverHealth(s.id)
            .catch((): ServerHealth => ({ serverId: s.id, ok: false, status: 'error', message: 'Health unavailable' })),
        ),
      );
      set({ serverHealth: Object.fromEntries(health.map((h) => [h.serverId, h])) });
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    } finally {
      set({ isLoading: false });
    }
  },

  async saveSecret() {
    const api = getLocalMcpVaultApi();
    if (!api) {
      set({ toast: { kind: 'error', text: missingBridgeMessage() } });
      return;
    }
    const { secretForm } = get();
    try {
      set({ isSaving: true });
      await api.saveVaultSecret({ key: secretForm.key.trim(), value: secretForm.value });
      set({
        secretForm: DEFAULT_SECRET_FORM,
        toast: { kind: 'success', text: 'Secret saved. Use its key from the Servers page.' },
      });
      await get().refresh(false);
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    } finally {
      set({ isSaving: false });
    }
  },

  async deleteSecret(key) {
    const api = getLocalMcpVaultApi();
    if (!api) return;
    if (!confirm(`Delete vault secret "${key}"? Servers using it will fail until remapped.`)) return;
    try {
      await api.deleteVaultSecret(key);
      set({ toast: { kind: 'success', text: 'Vault secret deleted.' } });
      await get().refresh(false);
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    }
  },

  async saveServer() {
    const api = getLocalMcpVaultApi();
    if (!api) {
      set({ toast: { kind: 'error', text: missingBridgeMessage() } });
      return;
    }
    const { serverForm, envRows } = get();
    // Don't silently drop a mapped row the user half-filled: a vault row with a
    // name but no secret chosen is almost certainly a mistake.
    const incomplete = envRows.find(
      (row) => row.key.trim() && row.mode === 'vault' && !row.vaultKey.trim(),
    );
    if (incomplete) {
      set({
        toast: {
          kind: 'error',
          text: `Choose a secret for "${incomplete.key.trim()}", or switch it to a Custom value.`,
        },
      });
      return;
    }
    try {
      set({ isSaving: true });
      await api.saveServer({
        ...serverForm,
        args: splitArgs(serverForm.args?.join(' ') ?? ''),
        env: envDraftsToInput(envRows),
      });
      set({
        serverForm: DEFAULT_SERVER_FORM,
        envRows: [createEnvParamDraft(0, get().secrets.length ? 'vault' : 'plain')],
        page: 'servers',
        toast: { kind: 'success', text: 'Server saved. Copy install JSON from the server card.' },
      });
      await get().refresh(false);
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    } finally {
      set({ isSaving: false });
    }
  },

  async toggleServer(server) {
    const api = getLocalMcpVaultApi();
    if (!api) return;
    try {
      set({ updatingServerId: server.id });
      await api.setServerEnabled(server.id, !server.enabled);
      set({
        toast: {
          kind: 'success',
          text: `${server.name} ${server.enabled ? 'disabled' : 'enabled'}.`,
        },
      });
      await get().refresh(false);
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    } finally {
      set({ updatingServerId: null });
    }
  },

  async removeServer(id) {
    const api = getLocalMcpVaultApi();
    if (!api) return;
    const name = get().servers.find((s) => s.id === id)?.name ?? id;
    if (!confirm(`Delete MCP server "${name}"? Vault secrets are kept.`)) return;
    try {
      await api.deleteServer(id);
      set({ toast: { kind: 'success', text: 'Server deleted. Vault secrets were kept.' } });
      await get().refresh(false);
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    }
  },

  editServer(server) {
    const drafts = envDraftsFromServer(server);
    set({
      serverForm: buildEditForm(server),
      envRows: drafts.length ? drafts : [createEnvParamDraft(0)],
      page: 'add-server',
      toast: {
        kind: 'info',
        text: 'Editing server — use Vault mode for secrets, Plain mode for safe config values.',
      },
    });
  },

  async copyClientConfig(server) {
    const api = getLocalMcpVaultApi();
    if (!api) return;
    try {
      const snippet = await api.clientConfig(server.id);
      await navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
      set({ toast: { kind: 'success', text: `Copied ${server.name} install JSON (server-scoped key).` } });
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    }
  },

  async rotateServerKey(server) {
    const api = getLocalMcpVaultApi();
    if (!api) return;
    if (!confirm(`Rotate the access key for "${server.name}"? Its current install JSON stops working until re-copied.`)) return;
    try {
      const snippet = await api.rotateServerKey(server.id);
      await navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
      set({ toast: { kind: 'success', text: `Rotated key for ${server.name}. New install JSON copied to clipboard.` } });
    } catch (error) {
      set({ toast: { kind: 'error', text: errorMessage(error) } });
    }
  },
}));

// ─── Selectors (stable references via slice) ──────────────────────────────────

export const useVisibleServers = () =>
  useAppStore((s) => filterServers(s.servers, s.query));

export const useMetrics = () =>
  useAppStore((s) => buildDashboardMetrics(s.servers, s.secrets));

export const useCanSaveSecret = () =>
  useAppStore((s) => {
    const api = getLocalMcpVaultApi();
    return (
      !!api &&
      !s.isSaving &&
      s.secretForm.key.trim().length > 0 &&
      s.secretForm.value.length > 0 &&
      s.vault?.canPersistSecrets !== false
    );
  });

export const useCanSaveServer = () =>
  useAppStore((s) => {
    const api = getLocalMcpVaultApi();
    return (
      !!api &&
      !s.isSaving &&
      s.serverForm.name.trim().length > 0 &&
      (s.serverForm.transport === 'http' ? !!s.serverForm.url : !!s.serverForm.command)
    );
  });
