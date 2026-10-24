import type { ReactNode } from 'react';
import { SettingsSection } from './SettingsSubNav';

export function SettingsCallout({
	tone = 'neutral',
	children,
}: {
	tone?: 'neutral' | 'ok' | 'warn' | 'error';
	children: ReactNode;
}) {
	return (
		<div className={`settings-callout settings-callout--${tone}`} role="status">
			{children}
		</div>
	);
}

export function SettingsToolbar({ children }: { children: ReactNode }) {
	return <div className="settings-toolbar">{children}</div>;
}

export function SettingsFieldGrid({ children }: { children: ReactNode }) {
	return <div className="settings-field-grid">{children}</div>;
}

export function SettingsBlock({
	titleKey,
	hintKey,
	children,
}: {
	titleKey: string;
	hintKey?: string;
	children: ReactNode;
}) {
	return (
		<SettingsSection titleKey={titleKey} hintKey={hintKey}>
			{children}
		</SettingsSection>
	);
}

export function SettingsPill({
	tone = 'neutral',
	children,
}: {
	tone?: 'neutral' | 'ok' | 'warn' | 'error';
	children: ReactNode;
}) {
	return <span className={`settings-pill settings-pill--${tone}`}>{children}</span>;
}
