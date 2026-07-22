import React from 'react';
import { Trash2 } from 'lucide-react';
import { useAppStore, useCanSaveSecret } from '../store.js';
import { Empty, Field, PanelTitle } from './ui.js';

export function VaultPage() {
  const secrets = useAppStore((s) => s.secrets);
  const secretForm = useAppStore((s) => s.secretForm);
  const vault = useAppStore((s) => s.vault);
  const isSaving = useAppStore((s) => s.isSaving);
  const setSecretForm = useAppStore((s) => s.setSecretForm);
  const saveSecret = useAppStore((s) => s.saveSecret);
  const deleteSecret = useAppStore((s) => s.deleteSecret);
  const canSave = useCanSaveSecret();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void saveSecret();
  }

  return (
    <div className="two-col">
      {/* Add secret form */}
      <form className="panel form-panel" onSubmit={handleSubmit} noValidate>
        <PanelTitle
          eyebrow="Step 1"
          title="Add a vault key"
          hint="Secrets are sealed locally and never shown again after saving."
        />

        <Field
          label="Key"
          hint="Use a shell-compatible name: letters, numbers, underscores."
          tooltip="Example: GITHUB_TOKEN or OPENAI_API_KEY"
          required
        >
          <input
            value={secretForm.key}
            onChange={(e) => setSecretForm({ ...secretForm, key: e.target.value.toUpperCase() })}
            placeholder="GITHUB_TOKEN"
            autoCapitalize="characters"
            spellCheck={false}
            className="input-mono"
          />
        </Field>

        <Field
          label="Value"
          hint="Paste the secret value once — it becomes write-only after save."
          tooltip="Sealed via Electron safeStorage or AES-GCM fallback"
          required
        >
          <input
            type="password"
            value={secretForm.value}
            onChange={(e) => setSecretForm({ ...secretForm, value: e.target.value })}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>

        <button className="btn btn--primary" disabled={!canSave || isSaving}>
          {isSaving ? 'Saving…' : vault?.status === 'blocked' ? 'Vault blocked' : 'Save secret'}
        </button>
      </form>

      {/* Stored secrets list */}
      <section className="panel">
        <PanelTitle
          eyebrow="Stored"
          title={`${secrets.length} vault ${secrets.length === 1 ? 'key' : 'keys'}`}
          hint="Only key names are visible. Values stay encrypted on this device."
        />

        <div className="item-list">
          {secrets.length === 0 ? (
            <Empty
              title="No secrets yet"
              text="Add credentials here first, then map them to server environment rows."
            />
          ) : (
            secrets.map((secret) => (
              <article className="secret-row" key={secret.key}>
                <div className="secret-row-info">
                  <strong>{secret.key}</strong>
                  <small>Updated {new Date(secret.updatedAt).toLocaleString()}</small>
                </div>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => void deleteSecret(secret.key)}
                  title={`Delete sealed value for ${secret.key}`}
                >
                  <Trash2 size={13} strokeWidth={2.5} aria-hidden="true" />
                  Delete
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
