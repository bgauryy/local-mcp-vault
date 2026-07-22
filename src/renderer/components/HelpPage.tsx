import React from 'react';
import { PanelTitle } from './ui.js';

const STEPS = [
  {
    number: '1',
    title: 'Save secrets in Vault',
    text: 'Add KEY / VALUE credentials on the Vault page. Values are sealed locally and become write-only after saving.',
  },
  {
    number: '2',
    title: 'Add a server',
    text: 'Choose stdio for local commands (npx, uvx, python…) or HTTP for an existing MCP endpoint. Set a working directory when the command needs local project files.',
  },
  {
    number: '3',
    title: 'Configure env rows',
    text: 'Use "Vault key" for secret tokens. Use "Plain value" for non-sensitive settings like LOG_LEVEL=debug.',
  },
  {
    number: '4',
    title: 'Copy install JSON',
    text: 'Click "Copy install JSON" on any server card. The snippet contains only the localhost URL and gateway access key — never secret values.',
  },
];

const SAFETY_ITEMS = [
  'Vault values are never shown in server forms or copied client JSON snippets.',
  'The local gateway binds to 127.0.0.1 and requires the generated access key on every request.',
  'Deleting a server keeps its reusable vault secrets — delete secrets from the Vault page when you no longer need them.',
  'Electron safeStorage is used when available; AES-GCM is the secure fallback.',
];

export function HelpPage() {
  return (
    <div className="stack">
      {/* Step cards */}
      <div className="help-grid">
        {STEPS.map((step) => (
          <article className="panel help-card" key={step.number}>
            <div className="help-card-header">
              <span className="help-step-num" aria-hidden="true">{step.number}</span>
              <div>
                <p className="eyebrow">Step {step.number}</p>
                <h2>{step.title}</h2>
              </div>
            </div>
            <p>{step.text}</p>
          </article>
        ))}
      </div>

      {/* Safety model */}
      <section className="panel">
        <PanelTitle
          eyebrow="Safety model"
          title="What stays private"
          hint="Secrets are resolved only by OctoVault at process startup."
        />
        <ul className="help-list">
          {SAFETY_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
