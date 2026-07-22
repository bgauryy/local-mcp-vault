import React from 'react';
import { useAppStore, useCanSaveServer, DEFAULT_SERVER_FORM } from '../store.js';
import { createEnvParamDraft, splitArgs } from '../app-model.js';
import { Field, PanelTitle } from './ui.js';
import { EnvParamEditor } from './EnvParamEditor.js';

export function AddServerPage() {
  const secrets = useAppStore((s) => s.secrets);
  const serverForm = useAppStore((s) => s.serverForm);
  const isSaving = useAppStore((s) => s.isSaving);

  const setServerForm = useAppStore((s) => s.setServerForm);
  const setDraftField = useAppStore((s) => s.setDraftField);
  const saveServer = useAppStore((s) => s.saveServer);
  const setPage = useAppStore((s) => s.setPage);
  const canSave = useCanSaveServer();

  const isEditing = !!serverForm.id;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void saveServer();
  }

  function handleCancel() {
    // Reset form so old edit state doesn't persist
    useAppStore.setState({
      serverForm: DEFAULT_SERVER_FORM,
      envRows: [createEnvParamDraft(0)],
    });
    setPage('servers');
  }

  return (
    <div className="form-page">
      <form className="panel form-panel" onSubmit={handleSubmit} noValidate>
        <PanelTitle
          eyebrow={isEditing ? `Editing — ${serverForm.name}` : 'New server'}
          title={isEditing ? 'Edit MCP server' : 'Add MCP server'}
          hint="Choose a transport, fill in the command or URL, then map environment variables below."
        />

        {/* ── Identity ─────────────────────────────── */}
        <fieldset className="form-section">
          <legend className="form-section-label">Identity</legend>

          <Field
            label="Name"
            hint="Short display label shown in the server list."
            tooltip="The app generates a URL-safe ID from this name."
            required
          >
            <input
              value={serverForm.name}
              onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })}
              placeholder="GitHub Tools"
              autoFocus={!isEditing}
            />
          </Field>

          <Field
            label="Transport"
            hint="Stdio starts a local process. HTTP proxies an existing MCP endpoint."
            tooltip="MCP clients always connect to OctoVault — never directly to the process or URL."
          >
            <select
              value={serverForm.transport}
              onChange={(e) =>
                setServerForm({ ...serverForm, transport: e.target.value as 'stdio' | 'http' })
              }
            >
              <option value="stdio">stdio — local command</option>
              <option value="http">HTTP — upstream URL</option>
            </select>
          </Field>
        </fieldset>

        {/* ── Connection ───────────────────────────── */}
        <fieldset className="form-section">
          <legend className="form-section-label">
            {serverForm.transport === 'stdio' ? 'Command' : 'Endpoint'}
          </legend>

          {serverForm.transport === 'stdio' ? (
            <>
              <Field
                label="Command"
                hint="The executable to run: npx, node, python, uvx, or an absolute path."
                tooltip="Runs in a child process with vault secrets resolved as env vars."
                required
              >
                <input
                  value={serverForm.command ?? ''}
                  onChange={(e) => setDraftField('command', e.target.value)}
                  placeholder="npx"
                  spellCheck={false}
                  className="input-mono"
                />
              </Field>

              <Field
                label="Args"
                hint="Space-separated arguments passed to the command."
                tooltip="Example: -y @acme/mcp-server --stdio"
              >
                <input
                  value={serverForm.args?.join(' ') ?? ''}
                  onChange={(e) =>
                    setServerForm({ ...serverForm, args: splitArgs(e.target.value) })
                  }
                  placeholder="-y my-mcp-server --stdio"
                  spellCheck={false}
                  className="input-mono"
                />
              </Field>

              <Field
                label="Working directory"
                hint="Optional — the folder where the command starts. Leave blank to use the system default."
                tooltip="Set this when the server reads local project files or relative config paths."
              >
                <input
                  value={serverForm.cwd ?? ''}
                  onChange={(e) => setDraftField('cwd', e.target.value)}
                  placeholder="/Users/you/project"
                  spellCheck={false}
                  className="input-mono"
                />
              </Field>
            </>
          ) : (
            <Field
              label="Upstream URL"
              hint="The existing HTTP MCP endpoint to proxy and protect."
              tooltip="OctoVault adds access-key auth so client config stays credential-free."
              required
            >
              <input
                value={serverForm.url ?? ''}
                onChange={(e) => setDraftField('url', e.target.value)}
                placeholder="http://127.0.0.1:3000/mcp"
                type="url"
                spellCheck={false}
                className="input-mono"
              />
            </Field>
          )}
        </fieldset>

        {/* ── Environment ──────────────────────────── */}
        <fieldset className="form-section">
          <legend className="form-section-label">Environment variables</legend>
          <EnvParamEditor secrets={secrets} />
        </fieldset>

        {/* ── Actions ──────────────────────────────── */}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button className="btn btn--primary" disabled={!canSave || isSaving}>
            {isSaving ? 'Saving…' : isEditing ? 'Update server' : 'Save server'}
          </button>
        </div>
      </form>
    </div>
  );
}
