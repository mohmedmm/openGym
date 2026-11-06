/**
 * Real-time Workout Sync Engine for openGym
 * Connects active trainee sessions to the Coach Live Board
 */

let lastSyncTimestamp = 0;
const THROTTLE_MS = 3000; // Throttle set updates to avoid excessive requests

export async function syncWorkoutProgress(active, status = 'in_progress') {
  if (!active || active.editingWorkoutId || active.backfill) return;

  const now = Date.now();
  if (status === 'in_progress' && (now - lastSyncTimestamp < THROTTLE_MS)) {
    return;
  }
  lastSyncTimestamp = now;

  try {
    const entries = active.entries || [];
    const currentEntry = entries.find(e => !e.sets?.every(s => s.done)) || entries[entries.length - 1];

    let setsDone = 0;
    let totalSets = 0;
    let totalVolume = 0;

    for (const e of entries) {
      if (Array.isArray(e.sets)) {
        for (const s of e.sets) {
          totalSets++;
          if (s.done) {
            setsDone++;
            const w = parseFloat(s.w) || 0;
            const r = parseInt(s.r, 10) || 0;
            totalVolume += (w * r);
          }
        }
      }
    }

    const payload = {
      id: String(active.start || now),
      routine_name: active.name || 'حصة تدريبية',
      started_at: active.start || now,
      finished_at: status === 'completed' ? now : null,
      duration_seconds: Math.round((now - (active.start || now)) / 1000),
      status: status,
      current_exercise: currentEntry?.name || 'تمرين جارٍ',
      sets_done: setsDone,
      total_sets: totalSets,
      total_volume_kg: Math.round(totalVolume * 10) / 10,
      exercises_json: entries.map(e => ({
        name: e.name,
        sets_count: e.sets?.length || 0,
        completed_sets: e.sets?.filter(s => s.done)?.length || 0
      }))
    };

    await fetch('/api/workout/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Non-blocking resilient catch
  }
}

export async function syncWorkoutFinished(completed) {
  if (!completed) return;
  try {
    const now = Date.now();
    let totalVolume = completed.vol || 0;
    let totalSets = 0;
    let setsDone = 0;

    const entries = completed.entries || [];
    for (const e of entries) {
      if (Array.isArray(e.sets)) {
        for (const s of e.sets) {
          totalSets++;
          if (s.done) {
            setsDone++;
            if (!totalVolume) {
              const w = parseFloat(s.w) || 0;
              const r = parseInt(s.r, 10) || 0;
              totalVolume += (w * r);
            }
          }
        }
      }
    }

    const payload = {
      id: String(completed.id || completed.start || now),
      routine_name: completed.name || 'حصة تدريبية مكتملة',
      started_at: completed.start || (now - (completed.dur || 3600) * 1000),
      finished_at: completed.end || now,
      duration_seconds: completed.dur || Math.round((now - (completed.start || now)) / 1000),
      status: 'completed',
      current_exercise: 'اكتملت الحصة',
      sets_done: setsDone || totalSets,
      total_sets: totalSets,
      total_volume_kg: Math.round(totalVolume * 10) / 10,
      notes: completed.note || '',
      exercises_json: entries.map(e => ({
        name: e.name,
        sets_count: e.sets?.length || 0,
        completed_sets: e.sets?.filter(s => s.done)?.length || 0
      }))
    };

    await fetch('/api/workout/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Non-blocking resilient catch
  }
}

