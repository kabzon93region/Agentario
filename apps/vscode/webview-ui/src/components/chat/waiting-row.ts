/** Sentinel ts for the ephemeral in-list waiting row (not persisted to history). */
export const WAITING_ROW_TS = Number.MIN_SAFE_INTEGER

export function isWaitingStatusMessage(ts: number | undefined): boolean {
	return ts === WAITING_ROW_TS
}
