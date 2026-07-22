import React from 'react';
import { Plus, Search } from 'lucide-react';
import { useAppStore, useVisibleServers } from '../store.js';
import { Empty, PanelTitle } from './ui.js';
import { ServerCard } from './ServerCard.js';

export function ServersPage() {
  const servers = useAppStore((s) => s.servers);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const startNewServer = useAppStore((s) => s.startNewServer);
  const visibleServers = useVisibleServers();

  return (
    <div className="servers-page">
      {/* Header row: title + Add CTA */}
      <div className="servers-page-header">
        <PanelTitle
          eyebrow="Configured"
          title="MCP servers"
          hint="Enable or disable routes. Copy credential-free install JSON for any client."
        />
        <button className="btn btn--primary" onClick={startNewServer}>
          <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
          Add server
        </button>
      </div>

      {/* Search */}
      {servers.length > 0 && (
        <div className="search-row">
          <div className="search-input-wrap">
            <Search size={14} className="search-icon" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, command, env key…"
              aria-label="Search servers"
            />
          </div>
          <span className="search-count" aria-live="polite">
            {visibleServers.length} / {servers.length}
          </span>
        </div>
      )}

      {/* List */}
      <div className="item-list">
        {servers.length === 0 && (
          <Empty
            title="No servers yet"
            text="Add a server, configure environment variables, then copy install JSON for any MCP client."
            action={{ label: 'Add your first server', onClick: startNewServer }}
          />
        )}
        {servers.length > 0 && visibleServers.length === 0 && (
          <Empty
            title="No matches"
            text="Try searching by name, command, transport, or an env key."
          />
        )}
        {visibleServers.map((server) => (
          <ServerCard key={server.id} server={server} />
        ))}
      </div>
    </div>
  );
}
