import React from 'react';
import { ClipboardCopy, Pencil, Trash2 } from 'lucide-react';
import type { McpServerWithEnv } from '../../shared/types.js';
import { useAppStore } from '../store.js';
import { Badge, MiniMetric, ToggleSwitch, formatNumber } from './ui.js';

interface ServerCardProps {
  server: McpServerWithEnv;
}

export function ServerCard({ server }: ServerCardProps) {
  const updatingServerId = useAppStore((s) => s.updatingServerId);
  const toggleServer = useAppStore((s) => s.toggleServer);
  const editServer = useAppStore((s) => s.editServer);
  const removeServer = useAppStore((s) => s.removeServer);
  const copyClientConfig = useAppStore((s) => s.copyClientConfig);

  const busy = updatingServerId === server.id;

  const commandLine =
    server.transport === 'stdio'
      ? `${server.command ?? ''} ${server.args.join(' ')}`.trim()
      : server.url ?? '';

  const envCount = server.env.length;

  return (
    <article className={`server-card${server.enabled ? '' : ' server-card--disabled'}`}>
      {/* Header row */}
      <div className="server-card-header">
        <div className="server-card-meta">
          <div className="server-card-title">
            <h3>{server.name}</h3>
            <Badge>{server.transport}</Badge>
            {!server.enabled && <Badge variant="danger">disabled</Badge>}
          </div>
          <p className="mono muted server-url">{server.localUrl}</p>
          {commandLine && <p className="muted server-cmd">{commandLine}</p>}
        </div>

        <ToggleSwitch
          checked={server.enabled}
          disabled={busy}
          label={server.enabled ? 'Disable this proxy route' : 'Enable this proxy route'}
          onChange={() => void toggleServer(server)}
        />
      </div>

      {/* Env summary */}
      <p className="server-env-summary muted">
        <span className="server-env-label">Env: </span>
        {envCount === 0
          ? 'no env vars'
          : server.env.map((e) => `${e.key}→${e.vaultKey ?? 'plain'}`).join(', ')}
      </p>

      {/* Usage metrics */}
      <div className="server-metrics">
        <MiniMetric label="Requests" value={formatNumber(server.usage.requestCount)} />
        <MiniMetric label="Tool calls" value={formatNumber(server.usage.toolCallCount)} />
        <MiniMetric label="Tokens" value={formatNumber(server.usage.estimatedTokenCount)} />
        <MiniMetric label="Errors" value={formatNumber(server.usage.errorCount)} />
      </div>

      {/* Actions */}
      <div className="server-card-actions">
        <button
          className="btn btn--primary"
          onClick={() => void copyClientConfig(server)}
          title="Copy JSON snippet for MCP clients — contains only the localhost URL and access key"
        >
          <ClipboardCopy size={14} strokeWidth={2.5} aria-hidden="true" />
          Copy install JSON
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => editServer(server)}
          title="Edit this server's configuration"
        >
          <Pencil size={14} strokeWidth={2.5} aria-hidden="true" />
          Edit
        </button>
        <button
          className="btn btn--danger"
          onClick={() => void removeServer(server.id)}
          title="Delete this server and its configuration"
        >
          <Trash2 size={14} strokeWidth={2.5} aria-hidden="true" />
          Delete
        </button>
      </div>
    </article>
  );
}
