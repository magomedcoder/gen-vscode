import { useEffect, useState } from 'react';
import type { ThinkingDisplay } from '../../core/config/types';
import { t } from '../i18n';

interface ThinkingBlockProps {
	thinking: string;
	display: ThinkingDisplay;
}

// Сворачиваемый блок reasoning/thinking (как карточка инструмента)
export function ThinkingBlock({ thinking, display }: ThinkingBlockProps) {
	const text = thinking.trim();
	if (!text || display === 'off') {
		return null;
	}

	const modeDefaultOpen = display === 'expanded';
	const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);

	useEffect(() => {
		setUserOpen(undefined);
	}, [display]);

	const open = userOpen ?? modeDefaultOpen;

	return (
		<details
			className={`thinking-block${display === 'collapsed' && !open ? ' thinking-block--compact' : ''}`}
			open={open}
			onToggle={(event) => {
				const next = (event.currentTarget as HTMLDetailsElement).open;
				if (next === open) {
					return;
				}

				setUserOpen(next);
			}}
		>
			<summary>
				<span className="thinking-block__title">{t('chat.thinking.label')}</span>
			</summary>
			<pre className="thinking-block__body">{text}</pre>
		</details>
	);
}
