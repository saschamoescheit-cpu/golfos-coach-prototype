import type { FaultProgressRecord, Swing } from '../model/types';

/**
 * Progress rows for one analysed swing: one row per checked fault (detected or not). Faults that could not be checked
 * reliably produce no row – "unknown" must not count as "fixed". Raw material for the later development curve ("Elo").
 * OWNER: agent "history-i18n-offline" may add aggregation helpers here.
 */
export function progressRecordsFor(swing: Swing): FaultProgressRecord[] {
  return swing.checkedFaultIds.map((faultId) => {
    const f = swing.faults.find((x) => x.defId === faultId);
    return {
      id: `${swing.id}:${faultId}`,
      faultId,
      swingId: swing.id,
      ts: swing.createdAt,
      shotType: swing.shotType,
      view: swing.view,
      detected: !!f,
      severity: f?.severity ?? 0,
      confidence: f?.confidence ?? 1,
    };
  });
}
