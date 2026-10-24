import { t } from '../../i18n';

export function JsonOnlyHint({ messageKey }: { messageKey: string }) {
	return (
		<p className="field__hint field__hint--json-only" role="note">
			{t(messageKey)}
		</p>
	);
}
