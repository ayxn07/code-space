import { atom } from 'nanostores';
import type { SnackSession } from '~/utils/snackExport';

/** The exp:// URL for the live Snack session (for QR code rendering). */
export const expoUrlAtom = atom<string | null>(null);

/** The active SnackSession instance (persists across modal open/close). */
export const snackSessionAtom = atom<SnackSession | null>(null);

/** Whether the Snack QR modal is open. */
export const snackModalOpenAtom = atom<boolean>(false);
