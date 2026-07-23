import React from 'react';
import {
  BarChart2,
  HelpCircle,
  Layers,
  Lock,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { useAppStore, type Page } from '../store.js';

// ─── Nav structure ────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: 'Secrets',
    items: [
      {
        id: 'vault' as Page,
        label: 'Vault',
        Icon: Lock,
        title: 'Store and manage local credentials',
      },
    ],
  },
  {
    label: 'MCP Servers',
    items: [
      {
        id: 'add-server' as Page,
        label: 'Add server',
        Icon: Plus,
        title: 'Configure a new MCP server',
        isAction: true,
      },
      {
        id: 'servers' as Page,
        label: 'All servers',
        Icon: Layers,
        title: 'Browse and manage configured servers',
      },
    ],
  },
  {
    label: 'Overview',
    items: [
      {
        id: 'dashboard' as Page,
        label: 'Dashboard',
        Icon: BarChart2,
        title: 'Metrics and gateway status',
      },
      {
        id: 'help' as Page,
        label: 'Help',
        Icon: HelpCircle,
        title: 'How the app works',
      },
    ],
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const page = useAppStore((s) => s.page);
  const vault = useAppStore((s) => s.vault);
  const setPage = useAppStore((s) => s.setPage);
  const startNewServer = useAppStore((s) => s.startNewServer);

  const statusClass = vault?.status ?? 'degraded';

  function handleNavClick(id: Page, isAction?: boolean) {
    if (id === 'add-server') {
      // always reset the form when navigating here from the sidebar
      startNewServer();
    } else {
      setPage(id);
    }
  }

  // 'add-server' page should highlight the 'add-server' nav item
  const activePage = page;

  return (
    <aside className="sidebar" aria-label="Application navigation">
      {/* Brand */}
      <div className="brand">
        <div className="brand-logo" aria-hidden="true">
          <ShieldCheck size={18} strokeWidth={2.25} />
        </div>
        <span className="brand-text">
          <span className="brand-name">OctoVault</span>
          <span className="brand-tagline">Configure MCP servers, safely</span>
        </span>
      </div>

      {/* Sectioned navigation */}
      <nav aria-label="Main pages" className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div className="nav-section" key={section.label}>
            <span className="nav-section-label">{section.label}</span>
            {section.items.map(({ id, label, Icon, title, isAction }) => (
              <button
                key={id}
                className={`nav-btn${activePage === id ? ' nav-btn--active' : ''}${isAction ? ' nav-btn--action' : ''}`}
                onClick={() => handleNavClick(id, isAction)}
                title={title}
                aria-current={activePage === id ? 'page' : undefined}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Vault status chip */}
      <div
        className={`vault-chip vault-chip--${statusClass}`}
        title="Secret storage backend"
        aria-label={`Vault status: ${vault?.status ?? 'checking'}`}
      >
        <span className="vault-chip-label">Vault backend</span>
        <strong className="vault-chip-status">{vault ? vault.status : 'checking'}</strong>
        <small className="vault-chip-backend">{vault?.backend ?? 'loading…'}</small>
      </div>

      {/* Footer credit */}
      <a
        className="sidebar-footer"
        href="https://octocode.ai"
        target="_blank"
        rel="noreferrer"
      >
        Built by octocode.ai <span aria-hidden="true">🐙</span> Team
      </a>
    </aside>
  );
}
