import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';

interface SubNavActive {
	id: string;
	titleKey: string;
	hintKey?: string;
}

interface SettingsSubNavApi {
	activeId: string | null;
	open: (id: string, titleKey: string, hintKey: string | undefined, content: ReactNode) => void;
	setActiveContent: (content: ReactNode) => void;
	back: () => void;
}

const SettingsSubNavContext = createContext<SettingsSubNavApi | null>(null);

function useSettingsSubNavOptional(): SettingsSubNavApi | null {
	return useContext(SettingsSubNavContext);
}

export function SettingsSubNavProvider({ children }: { children: ReactNode }) {
	const [active, setActive] = useState<SubNavActive | null>(null);
	const [content, setContent] = useState<ReactNode>(null);

	const back = useCallback(() => {
		setActive(null);
		setContent(null);
	}, []);

	const open = useCallback((id: string, titleKey: string, hintKey: string | undefined, node: ReactNode) => {
		setActive({ id, titleKey, hintKey });
		setContent(node);
	}, []);

	const setActiveContent = useCallback((node: ReactNode) => {
		setContent(node);
	}, []);

	const api = useMemo<SettingsSubNavApi>(
		() => ({
			activeId: active?.id ?? null,
			open,
			setActiveContent,
			back,
		}),
		[active?.id, open, setActiveContent, back],
	);

	return (
		<SettingsSubNavContext.Provider value={api}>
			<div
				className={active ? 'settings-sub-nav-root settings-sub-nav-root--inactive' : 'settings-sub-nav-root'}
				hidden={Boolean(active)}
				aria-hidden={active ? true : undefined}
			>
				{children}
			</div>
			{active ? (
				<div className="settings-sub-screen">
					<button type="button" className="settings-sub-screen__back" onClick={back}>
						<span className="codicon codicon-chevron-left" aria-hidden="true" />
						{t('settings.sub.back')}
					</button>
					<header className="settings-sub-screen__header">
						<h2 className="settings-sub-screen__title">{t(active.titleKey)}</h2>
						{active.hintKey ? (
							<p className="settings-sub-screen__hint">{t(active.hintKey)}</p>
						) : null}
					</header>
					<div className="settings-sub-screen__body">{content}</div>
				</div>
			) : null}
		</SettingsSubNavContext.Provider>
	);
}

export function SettingsSection({
	titleKey,
	hintKey,
	children,
	defaultOpen: _defaultOpen,
}: {
	titleKey: string;
	children: ReactNode;
	hintKey?: string;
	defaultOpen?: boolean;
}) {
	const nav = useSettingsSubNavOptional();
	const id = titleKey;
	const isActive = nav?.activeId === id;

	useLayoutEffect(() => {
		if (nav && isActive) {
			nav.setActiveContent(children);
		}
	}, [nav, isActive, children]);

	if (!nav) {
		return (
			<section className="settings-block">
				<header className="settings-block__head">
					<h3 className="settings-block__title">{t(titleKey)}</h3>
					{hintKey ? <p className="settings-block__hint">{t(hintKey)}</p> : null}
				</header>
				<div className="settings-block__body">{children}</div>
			</section>
		);
	}

	return (
		<button
			type="button"
			className="settings-section-link"
			onClick={() => nav.open(id, titleKey, hintKey, children)}
		>
			<span className="settings-section-link__heading">
				<span className="settings-section-link__title">{t(titleKey)}</span>
				{hintKey ? <span className="settings-section-link__hint">{t(hintKey)}</span> : null}
			</span>
			<span className="codicon codicon-chevron-right settings-section-link__chevron" aria-hidden="true" />
		</button>
	);
}
