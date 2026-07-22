import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCw } from 'lucide-react';
import { useAppStore, type Page } from './store.js';
import { Sidebar } from './components/Sidebar.js';
import { VaultPage } from './components/VaultPage.js';
import { AddServerPage } from './components/AddServerPage.js';
import { ServersPage } from './components/ServersPage.js';
import { DashboardPage } from './components/DashboardPage.js';
import { HelpPage } from './components/HelpPage.js';
import './styles.css';

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast() {
  const toast = useAppStore((s) => s.toast);
  const setToast = useAppStore((s) => s.setToast);

  useEffect(() => {
    if (!toast || toast.kind === 'error') return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast, setToast]);

  if (!toast) return null;

  return (
    <div
      className={`toast toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span>{toast.text}</span>
      <button
        className="toast-close"
        onClick={() => setToast(null)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────

const PAGE_META = {
  vault:        { title: 'Vault',       lede: 'Seal credentials locally — values are never shown again after saving.' },
  'add-server': { title: 'Add server',  lede: 'Configure a new MCP server and map its environment variables to vault keys.' },
  servers:      { title: 'All servers', lede: 'Browse, enable, or copy install JSON for every configured MCP server.' },
  dashboard:    { title: 'Dashboard',   lede: 'Live metrics, proxy status, and gateway health at a glance.' },
  help:         { title: 'Help',        lede: 'Four steps to credential-free MCP clients.' },
} satisfies Record<Page, { title: string; lede: string }>;

function TopBar() {
  const page = useAppStore((s) => s.page);
  const isLoading = useAppStore((s) => s.isLoading);
  const refresh = useAppStore((s) => s.refresh);
  const serverForm = useAppStore((s) => s.serverForm);
  const { lede } = PAGE_META[page];

  // When editing, show the server name as the heading
  const title =
    page === 'add-server' && serverForm.id
      ? `Editing — ${serverForm.name}`
      : PAGE_META[page].title;

  return (
    <header className="topbar">
      <div className="topbar-text">
        <p className="eyebrow">OctoVault</p>
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
      </div>
      <button
        className="btn btn--ghost"
        onClick={() => void refresh()}
        disabled={isLoading}
        title="Refresh vault, servers, metrics, and gateway key"
        aria-label="Refresh all data"
      >
        <RefreshCw
          size={14}
          strokeWidth={2.5}
          className={isLoading ? 'spin' : ''}
          aria-hidden="true"
        />
        {isLoading ? 'Refreshing…' : 'Refresh'}
      </button>
    </header>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

function App() {
  const page = useAppStore((s) => s.page);
  const refresh = useAppStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="workspace">
        <TopBar />
        <Toast />

        {page === 'vault'        && <VaultPage />}
        {page === 'add-server'   && <AddServerPage />}
        {page === 'servers'      && <ServersPage />}
        {page === 'dashboard'    && <DashboardPage />}
        {page === 'help'         && <HelpPage />}
      </main>
    </div>
  );
}

// ─── Mount ────────────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')!).render(<App />);
