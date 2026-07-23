import React from 'react';
import { useAppStore, useMetrics } from '../store.js';
import { Metric, PanelTitle, Summary, formatNumber } from './ui.js';

export function DashboardPage() {
  const vault = useAppStore((s) => s.vault);
  const servers = useAppStore((s) => s.servers);
  const gatewayAddress = useAppStore((s) => s.gatewayAddress);
  const metrics = useMetrics();

  return (
    <div className="stack">
      {/* Metric cards */}
      <section aria-label="Key metrics">
        <div className="metric-grid">
          <Metric
            title="Vault keys"
            value={metrics.vaultSecrets}
            detail="Local credentials"
          />
          <Metric
            title="Servers"
            value={metrics.totalServers}
            detail={`${metrics.enabledServers} enabled`}
          />
          <Metric
            title="Env maps"
            value={metrics.mappedSecrets}
            detail="Server → vault"
          />
          <Metric
            title="Requests"
            value={metrics.requests}
            detail="Proxy calls"
          />
          <Metric
            title="Tool calls"
            value={metrics.toolCalls}
            detail="tools/call"
          />
          <Metric
            title="Errors"
            value={metrics.errors}
            detail="Failures"
            tone={metrics.errors ? 'warn' : 'ok'}
          />
        </div>
      </section>

      {/* Summary panel */}
      <section className="panel">
        <PanelTitle
          eyebrow="Overview"
          title="Local proxy status"
          hint="Clients use generated local JSON. Secrets resolve only inside this app."
        />
        <div className="summary-grid">
          <Summary
            label="Vault safety"
            value={vault ? `${vault.status} / ${vault.backend}` : 'checking…'}
          />
          <Summary label="Local proxy" value={gatewayAddress || 'starting…'} />
          <Summary label="Servers configured" value={String(servers.length)} />
          <Summary label="Estimated tokens" value={formatNumber(metrics.estimatedTokens)} />
        </div>
      </section>
    </div>
  );
}
