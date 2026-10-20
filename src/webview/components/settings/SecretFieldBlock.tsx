import { FieldText } from './SettingsFields';
import { t } from '../../i18n';
import { vscodeApi } from '../../vscodeApi';
import { useCallback } from 'react';

interface SecretFieldBlockProps {
	labelKey: string;
	hintKey: string;
	value: string;
	placeholder?: string;
	disabled?: boolean;
	keySet: boolean;
	markedClear: boolean;
	onChange: (value: string) => void;
	onMarkClear: () => void;
}

let pickSecretFileRequestId = 0;
const pickSecretFileWaiters = new Map<number, (value: string | undefined) => void>();

let pickListenerRegistered = false;

function ensureSecretFilePickListener(): void {
	if (pickListenerRegistered) {
		return;
	}
	pickListenerRegistered = true;
	window.addEventListener('message', (event: MessageEvent<{ type?: string; requestId?: number; value?: string }>) => {
		const data = event.data;
		if (!data || data.type !== 'secretFilePicked' || typeof data.requestId !== 'number') {
			return;
		}

		const resolve = pickSecretFileWaiters.get(data.requestId);
		if (resolve) {
			pickSecretFileWaiters.delete(data.requestId);
			resolve(data.value);
		}
	});
}

function requestSecretFileRef(): Promise<string | undefined> {
	const requestId = ++pickSecretFileRequestId;
	return new Promise((resolve) => {
		pickSecretFileWaiters.set(requestId, resolve);
		vscodeApi.postMessage({ type: 'pickSecretFile', requestId });
	});
}

export function SecretFieldBlock({
	labelKey,
	hintKey,
	value,
	placeholder,
	disabled = false,
	keySet,
	markedClear,
	onChange,
	onMarkClear,
}: SecretFieldBlockProps) {
	ensureSecretFilePickListener();

	const onBrowse = useCallback(async () => {
		const picked = await requestSecretFileRef();
		if (picked) {
			onChange(picked);
		}
	}, [onChange]);

	return (
		<div className="field">
			<FieldText
				labelKey={labelKey}
				hintKey={hintKey}
				type="password"
				autoComplete="off"
				value={value}
				placeholder={placeholder}
				disabled={disabled || markedClear}
				onChange={onChange}
			/>
			<span className="field__hint">{t('settings.secret.rotateHint')}</span>
			<div className="field__row" style={{ marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
				<button
					className="btn btn--secondary"
					type="button"
					disabled={disabled || markedClear}
					onClick={() => void onBrowse()}
				>
					{t('settings.secret.browseFile')}
				</button>
				{(keySet || markedClear) ? (
					<button
						className="btn btn--secondary"
						type="button"
						onClick={onMarkClear}
						disabled={markedClear}
					>
						{markedClear ? t('settings.secret.markedClear') : t('settings.secret.clear')}
					</button>
				) : null}
			</div>
		</div>
	);
}
