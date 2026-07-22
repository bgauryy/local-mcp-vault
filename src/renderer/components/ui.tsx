import React from 'react';

// ─── Typography ───────────────────────────────────────────────────────────────

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

// ─── Panel heading ────────────────────────────────────────────────────────────

interface PanelTitleProps {
  eyebrow: string;
  title: string;
  hint?: string;
}

export function PanelTitle({ eyebrow, title, hint }: PanelTitleProps) {
  return (
    <div className="panel-heading">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2>{title}</h2>
      {hint && <p className="panel-hint">{hint}</p>}
    </div>
  );
}

// ─── Form field ───────────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  hint?: string;
  tooltip?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function Field({ label, hint, tooltip, required, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="field-required" aria-label="required">*</span>}
        {tooltip && (
          <em className="field-tip" title={tooltip} aria-label={`Hint: ${tooltip}`}>?</em>
        )}
      </span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

interface EmptyProps {
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}

export function Empty({ title, text, action }: EmptyProps) {
  return (
    <article className="empty-state">
      <div className="empty-dot" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="btn btn--ghost btn--sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </article>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

interface MetricProps {
  title: string;
  value: React.ReactNode;
  detail: string;
  tone?: 'ok' | 'warn' | 'neutral';
}

export function Metric({ title, value, detail, tone = 'neutral' }: MetricProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-label">{title}</span>
      <strong className="metric-value">{value}</strong>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

// ─── Mini metric (inline) ─────────────────────────────────────────────────────

export function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mini-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

// ─── Summary row ──────────────────────────────────────────────────────────────

export function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'info';
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return <span className={`badge badge--${variant}`}>{children}</span>;
}

// ─── Status dot ───────────────────────────────────────────────────────────────

export function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={`status-dot ${on ? 'status-dot--on' : 'status-dot--off'}`}
      aria-label={on ? 'enabled' : 'disabled'}
    />
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  onChange: () => void;
}

export function ToggleSwitch({ checked, disabled, label, onChange }: ToggleSwitchProps) {
  return (
    <label className="toggle" title={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <em className="toggle-label">{checked ? 'On' : 'Off'}</em>
    </label>
  );
}

// ─── Separator ────────────────────────────────────────────────────────────────

export function Divider() {
  return <hr className="divider" />;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
