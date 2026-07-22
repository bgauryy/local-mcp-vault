import React from 'react';
import { Plus, X } from 'lucide-react';
import type { VaultSecretRecord } from '../../shared/types.js';
import type { EnvParamDraft } from '../app-model.js';
import { useAppStore } from '../store.js';

interface EnvParamEditorProps {
  secrets: VaultSecretRecord[];
}

export function EnvParamEditor({ secrets }: EnvParamEditorProps) {
  const rows = useAppStore((s) => s.envRows);
  const updateEnvRow = useAppStore((s) => s.updateEnvRow);
  const addEnvRow = useAppStore((s) => s.addEnvRow);
  const removeEnvRow = useAppStore((s) => s.removeEnvRow);

  return (
    <div className="env-editor" aria-label="Environment parameters">
      <div className="env-editor-header">
        <div>
          <span className="env-editor-title">Env vars</span>
          <small>Use Vault for secrets, Plain for safe values like LOG_LEVEL.</small>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={addEnvRow}>
          <Plus size={13} strokeWidth={2.5} aria-hidden="true" />
          Add row
        </button>
      </div>

      {rows.length > 0 && (
        <div className="env-list" role="list">
          {rows.map((row) => (
            <EnvRow
              key={row.id}
              row={row}
              secrets={secrets}
              onUpdate={(patch) => updateEnvRow(row.id, patch)}
              onRemove={() => removeEnvRow(row.id)}
            />
          ))}
        </div>
      )}

      {secrets.length === 0 && (
        <p className="env-no-secrets">
          No vault secrets yet — add them on the Vault page first, or use Plain value for non-sensitive settings.
        </p>
      )}
    </div>
  );
}

interface EnvRowProps {
  row: EnvParamDraft;
  secrets: VaultSecretRecord[];
  onUpdate: (patch: Partial<EnvParamDraft>) => void;
  onRemove: () => void;
}

function EnvRow({ row, secrets, onUpdate, onRemove }: EnvRowProps) {
  return (
    <article className="env-row" role="listitem">
      <input
        aria-label="Environment variable name"
        className="env-key-input input-mono"
        value={row.key}
        onChange={(e) => onUpdate({ key: e.target.value.toUpperCase() })}
        placeholder="ENV_NAME"
        spellCheck={false}
      />

      <select
        aria-label="Value source"
        className="env-mode-select"
        value={row.mode}
        onChange={(e) => onUpdate({ mode: e.target.value as EnvParamDraft['mode'] })}
      >
        <option value="vault">Vault key</option>
        <option value="plain">Plain value</option>
      </select>

      {row.mode === 'vault' ? (
        <select
          aria-label="Vault secret key"
          value={row.vaultKey}
          onChange={(e) => onUpdate({ vaultKey: e.target.value })}
        >
          <option value="">Choose secret…</option>
          {secrets.map((s) => (
            <option key={s.key} value={s.key}>{s.key}</option>
          ))}
        </select>
      ) : (
        <input
          aria-label="Plain environment value"
          value={row.value}
          onChange={(e) => onUpdate({ value: e.target.value })}
          placeholder="value"
          className="input-mono"
        />
      )}

      <button
        type="button"
        className="btn btn--icon btn--icon-danger"
        onClick={onRemove}
        title="Remove this row"
        aria-label="Remove environment row"
      >
        <X size={14} strokeWidth={2.5} />
      </button>
    </article>
  );
}
