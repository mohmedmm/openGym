import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import {
  dayAssignSheet, starterPlanSheet, confirmSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile,
} from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { Button, Row, Section, Segmented } from '../components/ui.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import { copyRoutine, deleteRoutine, restoreRoutine, routineSnapshot } from '../lib/routines.js'
import MiniBodyMap from '../components/MiniBodyMap.jsx'
import { workoutControls } from '../lib/workout-controls.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useListReorder, moved } from '../lib/use-list-reorder.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import { queueOf, queueView } from '../lib/queue.js'
import { deriveSessionName } from '../lib/session-merge.js'
import { programmeChip } from '../lib/programmes.js'
import { markUndone, undoMarks } from '../lib/sync-merge.js'
import {
  scheduleModeOf, queueRecovery, rotationIds, saveRotation, startNewPass, startPass, stopPass,
  chooseRotation, chooseFixedWeek, sequenceOf, isSimpleSequence, segmentAt, REST,
} from '../lib/rotation.js'
import { isOn } from '../lib/modules.js'

// Plan has two views (v1.3.11): Schedule (how you train, and when) and Routines (what you
// train). The last one you looked at comes back: a per-device convenience, never synced, so it
// lives in this browser's storage and not in S.
export const PLAN_VIEW_KEY = 'gym_plan_view'
const readView = () => {
  try { return localStorage.getItem(PLAN_VIEW_KEY) === 'routines' ? 'routines' : 'schedule' } catch { return 'schedule' }
}

/* Undo for Plan's two removals (v1.3.11). Both go through the store's normal update, so sync
   sees an ordinary edit (a routine put back clears its own removal stamp, lib/sync-merge.js). */

/** Deletes a routine with an Undo toast in place of a confirm: the toast puts it back exactly,
 *  list place, weekdays, reschedules and loop included (lib/routines.js routineSnapshot). */
export function deleteRoutineWithUndo(id) {
  const st = useStore.getState()
  const snap = routineSnapshot(st.S, id)
  if (!snap) return false
  const before = st.S
  st.update(s => { deleteRoutine(s, id) })
  // What the removal moved (weekdays, reschedules, the loop), for the Undo to mark as put back:
  // a change another device made to one of them before it saw the removal then still wins.
  snap.marks = undoMarks(before, useStore.getState().S)
  useUI.getState().toast(t('“{0}” gone.', snap.routine.name), { action: t('Undo'), onAction: () => undoDeleteRoutine(snap) })
  return true
}
export function undoDeleteRoutine(snap) {
  let ok = false
  useStore.getState().update(s => { ok = restoreRoutine(s, snap); if (ok && snap.marks) markUndone(s, snap.marks) })
  // False when a sync brought it back first (another device's Undo, or its later edit).
  if (!ok) useUI.getState().toast(t('It’s already back.'))
  return ok
}

/** Takes a routine out of the loop (the swipe and the edit-mode minus), with an Undo. The removal
 *  is the editor's own (`setSeq`), which may sweep the routine's future pins or roll a finished
 *  round over; so while the loop is still what the removal left, Undo puts the loop, the round and
 *  the swept pins back as they were. Once something else changed the loop, it just slots the
 *  routine back in at its old place, through the same save an edit uses. */
export function takeOutOfLoop(idOrAt, setSeq, seq, label) {
  // By position: a loop may hold a routine twice, or several rest days (#536). An id means its
  // first place, as before.
  const at = typeof idOrAt === 'number' ? idOrAt : seq.indexOf(idOrAt)
  if (at < 0 || at >= seq.length) return false
  const id = seq[at]
  const before = useStore.getState().S
  const snap = structuredClone({ rotation: before.rotation ?? null, queue: before.queue ?? null, dayPlan: before.dayPlan ?? {} })
  setSeq(seq.filter((x, i) => i !== at))
  const after = useStore.getState().S
  const mark = loopMark(after)
  const marks = undoMarks(before, after)
  const name = id === REST ? t('Rest day') : before.routines.find(r => r.id === id)?.name ?? id
  useUI.getState().toast(t('“{0}” is out of the loop.', name), { action: t('Undo'), onAction: () => undoTakeOut({ id, at, label, snap, mark, marks }) })
  return true
}
// What the loop looked like right after a removal: the saved loop, the pass and the mode switch.
const loopMark = S => JSON.stringify([S.rotation ?? null, S.queue ?? null, S.scheduleMode ?? null])
export function undoTakeOut({ id, at, label, snap, mark, marks }) {
  if (id !== REST && !useStore.getState().S.routines.some(r => r.id === id)) {
    useUI.getState().toast(t('Too late, that one’s gone'))
    return false
  }
  useStore.getState().update(s => {
    if (loopMark(s) === mark) {
      s.rotation = snap.rotation
      s.queue = snap.queue
      const pins = Object.entries(snap.dayPlan).filter(([iso]) => s.dayPlan?.[iso] == null)
      if (pins.length) s.dayPlan = { ...(s.dayPlan || {}), ...Object.fromEntries(pins) }
      // Put back exactly: a reorder another device made before it saw the removal still wins.
      if (marks) markUndone(s, marks)
      return
    }
    // Only a loop that is still this app's and still running gets a pass written. After "Fixed
    // week", or with a coach's or planner's queue in charge, a new pass would quietly take over
    // again, so the routine just goes back into the saved loop for the next time it starts.
    const q = queueOf(s)
    const ours = scheduleModeOf(s) === 'rotation' && (!s.queue || (!!q && !!s.rotation && q.rotationId === s.rotation.id))
    if (!ours) {
      const seq = Array.isArray(s.rotation?.sequence) ? s.rotation.sequence : null
      if (seq && (id === REST || !isSimpleSequence(seq) || !seq.includes(id))) {
        const next = seq.slice()
        next.splice(Math.min(at, next.length), 0, id)
        s.rotation = { ...s.rotation, sequence: next }
      }
      return
    }
    const full = sequenceOf(s)
    const looped = full.length && !isSimpleSequence(full)
    const ids = looped ? full : q?.ids ?? rotationIds(s)
    if (!looped && id !== REST && ids.includes(id)) return
    const next = ids.slice()
    next.splice(Math.min(at, next.length), 0, id)
    saveRotation(s, next, s.queue?.label || s.rotation?.label || label)
  })
  return true
}

// The flash a row lands with when a swipe brought it (a duplicate, an undo): one per new value.
let flashSeq = 0

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const [view, setViewState] = useState(readView)
  const setView = v => {
    setViewState(v)
    try { localStorage.setItem(PLAN_VIEW_KEY, v) } catch { /* private mode: the view just isn't remembered */ }
  }

  /* The Coach's way in from Plan: its own button in the header (a banner over the week was too
     loud, the last entry of the share menu too hidden). Gated by the same predicate every other
     Coach surface uses, so an instance without the feature sees exactly the header it would have
     without it. */
  const showCoach = isOn(S, 'coach') && coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  // Share, print, import and starter plans: one menu behind the header button, so the
  // two views below are only about the plan itself.
  const openMenu = () => {
    const has = planHasRoutines(S)
    menuSheet({
      title: t('Plan'),
      subtitle: has ? null : t('Add an exercise to a routine first. An empty plan has nothing to share.'),
      items: [
        { icon: 'share', label: t('Export plan file'), sub: t('A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.'), disabled: !has, onClick: exportPlanFile },
        { icon: 'note', label: t('Print / Save as PDF'), disabled: !has, onClick: printWholePlan },
        { icon: 'download', label: t('Import a plan file'), onClick: () => fileRef.current?.click() },
        { icon: 'clipboard', label: t('Load starter plan'), onClick: starterPlanSheet },
        { icon: 'calendar', label: t('Programmes'), sub: t('Your routines as a block of weeks, with starter programmes to try.'), onClick: () => nav('/plan/programmes') },
      ],
    })
  }
  const pickFile = ev => { const f = ev.target.files[0]; ev.target.value = ''; importPlanFile(f) }

  const mode = scheduleModeOf(S)
  // A running programme wrote the schedule below (lib/programmes.js); the strip says whose it is.
  const progChip = programmeChip(S)

  return <div className="narrow plan">
    <div className="hdr">
      <SeasonDeco spot="header-bats" />
      <div><h1>{t('Plan')}</h1><div className="sub">{mode === 'rotation' ? t('Your routines in a loop') : t('Your weekly routine')}</div></div>
      <div className="hdr-actions">
        {showCoach && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => nav('/coach')}>{t('Coach')}</Button>}
        <button className="iconbtn" data-tour="plan-menu" onClick={openMenu} aria-label={t('Plan options')} title={t('Plan options')}><Icon name="share" /></button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
    <Segmented className="plan-views" tour="plan-views" value={view} onChange={setView}
      options={[
        { value: 'schedule', label: t('Schedule') || 'الجدول' },
        { value: 'routines', label: 'خطط منفردة' },
        { value: 'teams', label: 'خطط الفريق' }
      ]} />
    {progChip && <button type="button" className="prog-strip" onClick={() => nav('/plan/programmes')}>
      <Icon name="calendar" /><span className="grow">{S.programmes?.[S.programme?.id]?.name || t('Programme')}</span><span className="tag acc">{progChip}</span>
    </button>}
    {view === 'teams'
      ? <TeamPlansHub S={S} update={update} nav={nav} />
      : view === 'routines'
      ? <Routines S={S} update={update} nav={nav} />
      : <Schedule S={S} update={update} nav={nav} mode={mode} />}
  </div>
}

/* ================================ Schedule ================================ */

function Schedule({ S, update, nav, mode }) {
  const [editLoop, setEditLoop] = useState(false)
  /* The rotation editor. What it shows is the live pass when there is one, otherwise the saved
     sequence — S.rotation is only a definition, so the pass is the truth whenever it exists.
     Every edit writes straight through saveRotation: an edit IS the save (and, for a queue
     somebody else wrote, the adoption), so there is no half-edited state to lose. `since` and
     `startsOn` carry over, so progress already logged survives a reorder. */
  const liveQ = queueOf(S)
  // A loop with rest days or a routine twice (#536) is edited as the whole saved sequence; its
  // pass is only the running segment of it. A simple loop shows its pass, as it always has.
  const fullSeq = sequenceOf(S)
  const ownLoop = !liveQ || (!!S.rotation && liveQ.rotationId === S.rotation.id)
  const looped = ownLoop && fullSeq.length > 0 && !isSimpleSequence(fullSeq)
  const seq = looped ? fullSeq : liveQ?.ids ?? rotationIds(S)
  const seg = looped && liveQ ? segmentAt(fullSeq, S.rotation?.at) : null
  // A loop the app makes has no name of its own: Home shows it as 'Rotation' in the language on
  // screen. Stored as text, it stayed in the language it was made in (QA 2026-10-06).
  const seqLabel = liveQ?.label || S.rotation?.label || ''
  // Ownership, not presence: a planner's queue has no rotationId, or one that does not match the
  // saved rotation here — that's what makes it someone else's to write, not this app's.
  const managed = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  const external = !!liveQ && !managed
  const recovery = queueRecovery(S)
  const qv = liveQ ? queueView(S, todayISO()) : null

  // "How you train" is the same switch as Settings' (lib/rotation.js chooseRotation /
  // chooseFixedWeek), on the same keys. Leaving a running loop asks first: its progress goes,
  // the loop itself and the weekdays stay. With nothing running there is nothing to lose.
  const setMode = v => {
    if (v === mode) return
    if (v === 'rotation') { update(s => { chooseRotation(s) }); return }
    if (!liveQ) { update(s => { chooseFixedWeek(s) }); return }
    confirmSheet({
      title: t('Back to a fixed week?'),
      message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
      confirmText: t('Use Fixed Week'),
      onConfirm: () => update(s => { chooseFixedWeek(s) }),
    })
  }

  const setSeq = ids => update(s => {
    // Emptying the sequence stops the pass but stays on Rotation with an empty loop ('No rotation
    // yet'), so taking out the last routine to swap it for another never throws you onto the
    // weekday grid. Leaving the rotation is the 'How you train' switch's job.
    if (ids.length) saveRotation(s, ids, seqLabel)
    else {
      stopPass(s)
      if (s.rotation) s.rotation = { ...s.rotation, sequence: [] }
      s.scheduleMode = 'rotation'
    }
  })
  const loopReorder = useListReorder(seq.length, (from, to) => setSeq(moved(seq, from, to)))
  const takeOut = at => takeOutOfLoop(at, setSeq, seq, seqLabel)
  const swipe = workoutControls(S).swipeSets && !external
  // Any routine, also one already in the loop (A → B → C → B), and rest days (#536).
  const addToSeq = () => menuSheet({
    title: t('Add to the rotation'),
    items: [
      ...(seq.length ? [{ icon: 'moon', label: t('Rest day'), sub: t('A day off before the next one'), onClick: () => setSeq([...seq, REST]) }] : []),
      ...S.routines.map(r => ({
        icon: glyphOf(r.emoji), label: r.name, sub: seq.includes(r.id) ? t('Already in the loop: adds it again') : undefined, onClick: () => setSeq([...seq, r.id]),
      })),
    ],
  })
  // The only path from a coach-written queue into a managed one: behind a confirmation that says
  // what happens — the coach gives up control: this app owns the queue and refills it itself, and a
  // later week written by the coach's app simply replaces it (the whole queue object, token and all).
  // The rotation takes a name of its own here rather than the planner's (e.g. "US W1") — that
  // name is this one pass's, and refillAfter would otherwise repeat it on every pass after it.
  // A loop of your own saved here is overwritten by the adoption, so the confirm says so.
  const ownSeq = S.rotation?.sequence || []
  const replacesOwn = ownSeq.length > 0 && (ownSeq.length !== seq.length || ownSeq.some((id, i) => id !== seq[i]))
  const adopt = () => confirmSheet({
    title: t('Use this rotation?'),
    message: t('Your coach gives up control of this week: openGym owns the queue from here on and repeats these sessions by itself once they are all done. A new week from the coach’s app would replace this rotation.')
      + (replacesOwn ? ' ' + t('Your own loop gets replaced.') : ''),
    confirmText: t('Use this rotation'),
    onConfirm: () => update(s => saveRotation(s, seq, '')),
  })

  const ws = weekStartOf(S)
  const todayDow = new Date().getDay()
  const routineOf = id => S.routines.find(x => x.id === id)
  const dayRoutines = d => [].concat(S.week[d] || []).map(routineOf).filter(Boolean)
  // One weekday: what is on it at a glance, and a tap to change it (dayAssignSheet picks one
  // routine, several for a combined day, or a rest day).
  const dayRow = (d, rs = dayRoutines(d)) => {
    return <div key={d} className="item plan-day" data-day={d} aria-label={t(DAYN[d])} {...tappable(() => dayAssignSheet(d))}>
      <span className={'plan-day-n' + (d === todayDow ? ' today' : '')} aria-hidden="true">{t(DAYS[d])}</span>
      <span className={'lrow-i' + (rs.length ? '' : ' rest')}><Icon name={rs.length ? glyphOf(rs[0].emoji) : 'moon'} /></span>
      <div className="grow">
        <div className="tt">{rs.length ? deriveSessionName(rs.map(r => r.name)) : t('Rest day')}</div>
        <div className="ss">{rs.length === 1 ? exCount(rs[0].ex.length) : rs.length ? routineCount(rs.length) : t('Tap to plan something')}</div>
      </div>
      {rs.length > 0 && <MiniBodyMap routines={rs} body={S.body} tour="plan-body" />}
      <Icon name="chevronRight" className="chev" />
    </div>
  }
  // Beside a loop, a weekday shows only what it adds to it: a routine that is in the loop already
  // is the loop's session, the same rule Home follows (effectiveRoutineIds, history.js).
  const extraRoutines = d => dayRoutines(d).filter(r => !seq.includes(r.id))
  const plannedDays = weekOrder(ws).filter(d => extraRoutines(d).length)
  const doneCount = qv ? qv.items.filter(i => i.state === 'done').length : 0
  const stateWord = item => item.state === 'pinned' ? fmtDate(item.on, true)
    : { done: t('Done'), next: t('Up next'), later: t('Later') }[item.state]
  const editing = editLoop && !external

  return <>
    <Section className="plan-mode" tour="plan-mode" footer={mode === 'rotation'
      ? t('Routines in a loop. Whatever is next stays next until you train it, whatever the day.')
      : t('The same routines on the same weekdays, every week.')}>
      <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
        {/* A planner's own queue is not this app's to switch off: text, not a control. */}
        {external
          ? <span className="small dim plan-mode-locked">{t('Rotation')} · {t('Externally managed')}</span>
          : <Segmented className="seg-inline" value={mode} onChange={setMode}
              options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]} />}
      </Row>
      {/* a cobweb in the card's empty top corner, in season (components/Seasonal.jsx) */}
      <SeasonDeco spot="plan-card" />
    </Section>

    {!S.routines.length && <EmptyState className="plan-empty" icon="clipboard" title={t('No routines yet.')} text={t('Make one, or grab the starter plan to get going.')}>
      <Button variant="tinted" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
    </EmptyState>}

    {/* A queue payload that arrived unusable: a fix-up, shown whichever way you train. Giving it
        up also gives up S.scheduleMode='rotation', or the loop would sit there with no queue. */}
    {recovery && <div className="empty">
      {t('This rotation couldn’t be read. Another device may have written it.')}
      <div style={{ marginTop: 10 }}>
        <Button size="sm" variant="tinted" aria-label={t('Discard it')} onClick={() => update(s => { s.queue = null; s.scheduleMode = 'week' })}>{t('Discard it')}</Button>
      </div>
    </div>}

    {mode === 'week' ? <>
      <h4 className="sec">{t('This week')}</h4>
      <div className="list plan-week" data-tour="plan-week">{weekOrder(ws).map(d => dayRow(d))}</div>
      <p className="sect-f">{t('Want two routines on one day? Tap the day and pick both.')}</p>
    </> : <div className="rotation">
      <div className="row between plan-sec-h">
        <h4 className="sec">{t('The loop')}{external && <span className="tag" style={{ marginInlineStart: 8 }}>{t('Externally managed')}</span>}</h4>
        {/* A coach's own queue is read-only here: the one way to change what it holds is to
            adopt it first ("Use this rotation" below), never a tap on one of its rows. */}
        {!external && <div className="row plan-sec-acts" style={{ gap: 6 }}>
          {seq.length > 0 && <button className="plan-textbtn" aria-pressed={editLoop} onClick={() => setEditLoop(e => !e)}>{editLoop ? t('Done') : t('Edit')}</button>}
          <Button size="sm" variant="tinted" icon="plus" data-tour="plan-loop-add" aria-label={t('Add routine to the rotation')}
            disabled={!S.routines.length} onClick={addToSeq}>{t('Add')}</Button>
        </div>}
      </div>
      {seq.length ? <div className="list plan-loop" ref={loopReorder.listRef}>
        {seq.map((id, i) => {
          const rest = id === REST
          const r = rest ? null : routineOf(id)
          // In a loop with rests or repeats the pass is the running segment: only its rows have
          // a state, the rest of the loop is still ahead.
          const item = seg ? (i >= seg.start && i < seg.start + seg.ids.length ? qv?.items[i - seg.start] : null) : qv?.items[i]
          const key = looped ? i + ':' + id : id
          // The loop's swipe is remove-only (v1.3.11): a routine is in the loop once, so there is
          // nothing to copy. The row the reorder measures is the swipe's outer element.
          const reorderProps = { 'data-reorder-row': '', style: loopReorder.rowStyle(i) }
          const name = rest ? t('Rest day') : r?.name ?? id
          const row = <div key={swipe ? undefined : key} {...(swipe ? {} : reorderProps)} className={'item rotation-row' + (item?.state === 'done' ? ' is-done' : '') + (rest ? ' is-rest' : '')}>
            {editing && <button className="plan-minus" aria-label={t('Remove {0}', name)} title={t('Remove')}
              onClick={() => takeOut(i)}><Icon name="minus" /></button>}
            <span className={'plan-order' + (item?.state === 'next' ? ' next' : '')}>{item?.state === 'done' ? <Icon name="check" /> : i + 1}</span>
            <span className={'lrow-i' + (rest ? ' rest' : '')}><Icon name={rest ? 'moon' : glyphOf(r?.emoji)} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tt">{name}</div>
              <div className="ss">{item ? stateWord(item) : rest ? t('A day off before the next one') : r ? exCount(r.ex.length) : ''}</div>
            </div>
            {r && !rest && !editing && <MiniBodyMap routines={[r]} body={S.body} />}
            {editing && seq.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', name)} title={t('Drag to reorder')}
              {...loopReorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
          </div>
          return swipe
            ? <SwipeRow key={key} {...reorderProps} className="swrow-item" deleteLabel={t('Remove')} deleteIcon="minus"
              onDelete={() => takeOut(i)}>{row}</SwipeRow>
            : row
        })}
      </div> : <div className="empty">{t('No rotation yet. Add routines in the order you want to train them. The first one you haven’t logged stays up next.')}</div>}
      {seq.length > 0 && <p className="sect-f">
        {qv ? (qv.waiting ? (looped ? t('Rest day. The loop goes on {0}.', fmtDate(qv.startsOn, true)) : t('Next round starts {0}.', fmtDate(qv.startsOn, true))) : t('{0} of {1} done this round.', doneCount, qv.items.length)) + ' ' : ''}
        {external ? '' : editing ? t('Drag to reorder. Tap the minus to take one out.') : t('Trained out of order? Just pick another routine on Home.')}
      </p>}
      <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {external && <Button size="sm" variant="tinted" aria-label={t('Use this rotation')} onClick={adopt}>{t('Use this rotation')}</Button>}
        {/* Throws the current round away and starts the saved loop again today; nothing logged
            before this moment counts for it (startNewPass, the strict pass). */}
        {!!liveQ && !external && <Button size="sm" icon="reset" aria-label={t('Start the loop over')}
          onClick={() => update(s => startNewPass(s))}>{t('Start the loop over')}</Button>}
        {/* Rotation chosen and a loop saved, but no round running (it was stopped elsewhere). */}
        {!liveQ && !recovery && seq.length > 0 && <Button size="sm" variant="tinted" icon="play" aria-label={t('Start the loop')}
          onClick={() => update(s => startPass(s))}>{t('Start the loop')}</Button>}
      </div>
      {/* The weekday routines ride along beside a loop (effectiveRoutineIds, history.js) and feed
          the same tally (weekTally, queue.js), so the days that still add one stay in sight; a
          day whose only routines are in the loop already adds nothing and is left out. */}
      {plannedDays.length > 0 && <>
        <h4 className="sec">{t('Also on fixed days')}</h4>
        <div className="list plan-week">{plannedDays.map(d => dayRow(d, extraRoutines(d)))}</div>
        <p className="sect-f">{t('These count on top of the loop. Tap a day to change or clear it.')}</p>
      </>}
    </div>}

    {/* Weekly muscle volume is analysis: it moved to Stats, next to Muscle balance. Stats only
        shows that card once there is a routine, so the link waits for one too. */}
    {S.routines.length > 0 && <Section className="plan-link">
      <Row icon="chart" iconTint="var(--indigo)" title={t('Weekly muscle volume')} subtitle={t('Now in Stats, next to Muscle balance')}
        accessory="chevron" onClick={() => nav('/stats?focus=weekly-volume')} />
    </Section>}
  </>
}

/* ================================ Routines ================================ */

function Routines({ S, update, nav }) {
  const [edit, setEdit] = useState(false)
  const [flash, setFlash] = useState(null)
  const [copyTargetRoutine, setCopyTargetRoutine] = useState(null)
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const toast = useUI(s => s.toast)
  const swipe = workoutControls(S).swipeSets
  const routines = S.routines

  useEffect(() => {
    fetch('/api/teams')
      .then(r => r.ok ? r.json() : { teams: [] })
      .then(d => {
        setTeams(d.teams || [])
        if (d.teams?.length) setSelectedTeamId(d.teams[0].id)
      })
      .catch(() => {})
  }, [])

  async function handleCopyRoutineToTeam(e) {
    e.preventDefault()
    if (!copyTargetRoutine || !selectedTeamId) return
    try {
      const res = await fetch('/api/teams/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: selectedTeamId,
          name: copyTargetRoutine.name,
          description: 'خطة منسوخة من الخطط المنفردة',
          days_json: [
            {
              day: copyTargetRoutine.name,
              exercises: copyTargetRoutine.ex.map(e => ({
                id: e.id,
                name: e.id,
                sets: e.sets?.length || 3,
                reps: '8-10',
                rest: 90
              }))
            }
          ]
        })
      })
      if (res.ok) {
        toast(`تم نسخ "${copyTargetRoutine.name}" إلى خطة الفريق بنجاح!`)
        setCopyTargetRoutine(null)
      } else {
        toast('تعذر نسخ الخطة إلى الفريق')
      }
    } catch (e) {
      toast('خطأ في الاتصال بالخادم')
    }
  }

  // The order of this list is the order of `S.routines`, and every other screen reads the same
  // array (the Start screen, the day sheets, the routine pickers), so moving a routine here moves
  // it everywhere (#142). Reordering lives behind Edit, like on an iPhone.
  const reorder = useListReorder(routines.length, (from, to) => update(s => {
    if (to < 0 || to >= s.routines.length) return
    const [m] = s.routines.splice(from, 1)
    s.routines.splice(to, 0, m)
  }))

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  const remove = r => deleteRoutineWithUndo(r.id)
  const duplicate = r => {
    const copy = copyRoutine(r, t('Copy'))
    update(s => {
      const at = s.routines.findIndex(x => x.id === r.id)
      s.routines.splice(at < 0 ? s.routines.length : at + 1, 0, copy)
    })
    setFlash({ id: copy.id, n: ++flashSeq })
    useUI.getState().toast(t('Copied as “{0}”.', copy.name), { action: t('Undo'), onAction: () => {
      update(s => { if (s.routines.some(x => x.id === copy.id)) deleteRoutine(s, copy.id) })
    } })
  }
  const order = weekOrder(weekStartOf(S))
  const daysOf = id => order.filter(d => [].concat(S.week[d] || []).includes(id)).map(d => t(DAYS[d]))
  const sub = r => [exCount(r.ex.length), daysOf(r.id).join(', ')].filter(Boolean).join(' · ')

  return <>
    <div className="row between plan-sec-h plan-routines-bar">
      {routines.length > 0
        ? <button className="plan-textbtn" aria-pressed={edit} onClick={() => setEdit(e => !e)}>{edit ? t('Done') : t('Edit')}</button>
        : <span />}
      <Button size="sm" variant="tinted" icon="plus" data-tour="plan-new" onClick={addRoutine}>{t('New routine')}</Button>
    </div>
    {routines.length ? <>
      {edit
        ? <div className="list routine-list plan-routines is-editing" ref={reorder.listRef}>{routines.map((r, i) =>
          <div key={r.id} data-reorder-row className="item plan-routine" style={reorder.rowStyle(i)}>
            <button className="plan-minus" aria-label={t('Delete {0}', r.name)} title={t('Delete routine')} onClick={() => remove(r)}><Icon name="minus" /></button>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            {routines.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', r.name)} title={t('Drag to reorder')}
              {...reorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
          </div>)}</div>
        : <div className="list routine-list plan-routines">{routines.map(r => {
          const row = <div key={r.id} className="item plan-routine" {...tappable(() => nav('/plan/r/' + r.id))}>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            <MiniBodyMap routines={[r]} body={S.body} />
            {teams.length > 0 && (
              <button
                type="button"
                className="iconbtn"
                title="نسخ إلى خطة فريق"
                onClick={e => { e.stopPropagation(); setCopyTargetRoutine(r); }}
                style={{ marginLeft: 6, marginRight: 6, color: 'var(--acc)' }}
              >
                <Icon name="share" />
              </button>
            )}
            <Icon name="chevronRight" className="chev" /></div>
          return swipe
            ? <SwipeRow key={r.id} className="swrow-item" copyLabel={t('Duplicate')}
              onDelete={() => remove(r)} onCopy={() => duplicate(r)}
              flash={flash?.id === r.id ? flash.n : 0}>{row}</SwipeRow>
            : row
        })}</div>}
      <p className="sect-f">{edit ? t('Drag to reorder. Tap the minus to delete.') : t('Tap a routine to edit it. Reorder and delete are behind Edit.')}</p>
    </> : <>
      <EmptyState icon="clipboard" title={t('No routines yet.')} text={t('Make one, or grab the starter plan to get going.')}>
        <Button variant="tinted" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
      </EmptyState>
    </>}

    {/* MODAL: COPY PERSONAL ROUTINE TO TEAM */}
    {copyTargetRoutine && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
      }}>
        <div style={{
          background: 'var(--surface)', padding: 20, borderRadius: 14,
          maxWidth: 440, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
              نسخ الخطة المنفردة إلى خطة فريق
            </h3>
            <button onClick={() => setCopyTargetRoutine(null)} style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <form onSubmit={handleCopyRoutineToTeam}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 4 }}>الخطة المنفردة المراد نسخها:</div>
              <div style={{ fontWeight: 600, color: 'var(--label)' }}>{copyTargetRoutine.name} ({copyTargetRoutine.ex?.length || 0} تمرين)</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                اختر الفريق المستهدف:
              </label>
              <select
                value={selectedTeamId}
                onChange={e => setSelectedTeamId(e.target.value)}
                required
                style={{
                  width: '100%', padding: '10px', borderRadius: 8,
                  background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                  color: 'var(--label)', fontSize: '0.85rem'
                }}
              >
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setCopyTargetRoutine(null)}
                style={{
                  padding: '8px 16px', borderRadius: 8, background: 'transparent',
                  border: '1px solid var(--sep-op)', color: 'var(--label)', cursor: 'pointer'
                }}
              >
                إلغاء
              </button>
              <button
                type="submit"
                style={{
                  padding: '8px 18px', borderRadius: 8, background: 'var(--acc)',
                  border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer'
                }}
              >
                تأكيد النسخ للفريق
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>
}

/* ================================ Team Plans Hub ================================ */

function TeamPlansHub({ S, update, nav }) {
  const [plans, setPlans] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newPlanTeamId, setNewPlanTeamId] = useState('')
  const [newPlanName, setNewPlanName] = useState('')
  const [newPlanDesc, setNewPlanDesc] = useState('')
  const toast = useUI(s => s.toast)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [plansRes, teamsRes] = await Promise.all([
        fetch('/api/teams/all-plans'),
        fetch('/api/teams')
      ])
      if (plansRes.ok) {
        const d = await plansRes.json()
        setPlans(d.plans || [])
      }
      if (teamsRes.ok) {
        const d = await teamsRes.json()
        setTeams(d.teams || [])
        if (d.teams?.length && !newPlanTeamId) {
          setNewPlanTeamId(d.teams[0].id)
        }
      }
    } catch (e) {
      console.warn('Error loading team plans:', e)
    } finally {
      setLoading(false)
    }
  }

  function copyTeamPlanToPersonal(teamPlan) {
    if (!teamPlan) return
    const days = teamPlan.days_json || []
    let allEx = []
    if (Array.isArray(days)) {
      days.forEach(d => {
        if (Array.isArray(d.exercises)) {
          d.exercises.forEach(ex => {
            allEx.push({
              id: ex.id || ex.exercise_id,
              sets: Array(ex.sets || 3).fill().map(() => ({ w: ex.target_weight || 0, r: ex.reps || 10 }))
            })
          })
        }
      })
    }

    const newRoutine = {
      id: uid(),
      name: teamPlan.name || 'خطة فريق منسوخة',
      emoji: DEFAULT_GLYPH,
      ex: allEx
    }

    update(s => {
      s.routines.push(newRoutine)
    })
    toast(`تم نسخ خطة "${teamPlan.name}" إلى خططك المنفردة بنجاح!`)
  }

  async function handleCreateTeamPlan(e) {
    e.preventDefault()
    if (!newPlanTeamId || !newPlanName.trim()) return
    try {
      const res = await fetch('/api/teams/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: newPlanTeamId,
          name: newPlanName.trim(),
          description: newPlanDesc.trim(),
          days_json: [
            {
              day: 'اليوم الأول: الأساسي',
              exercises: []
            }
          ]
        })
      })
      if (res.ok) {
        toast('تم إنشاء خطة الفريق بنجاح')
        setShowCreateModal(false)
        setNewPlanName('')
        setNewPlanDesc('')
        loadData()
      } else {
        toast('تعذر إنشاء خطة الفريق')
      }
    } catch (e) {
      toast('خطأ في الاتصال بالخادم')
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--label)' }}>
            خطط الفرق والمجموعات
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
            إدارة القوالب الجماعية وإمكانية النسخ بين البرامج الشخصية وبرامج الفرق
          </div>
        </div>

        {teams.length > 0 && (
          <Button size="sm" variant="tinted" icon="plus" onClick={() => setShowCreateModal(true)}>
            خطة فريق جديدة
          </Button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--label-2)' }}>
          جاري تحميل خطط الفرق...
        </div>
      ) : plans.length === 0 ? (
        <EmptyState icon="clipboard" title="لا توجد خطط فرق حالياً" text="يمكنك إنشاء خطة جديدة للفريق أو نسخ إحدى خططك المنفردة إلى الفريق.">
          {teams.length > 0 ? (
            <Button variant="tinted" icon="plus" onClick={() => setShowCreateModal(true)}>
              إنشاء خطة فريق جديدة
            </Button>
          ) : (
            <Button variant="tinted" icon="person" onClick={() => nav('/teams')}>
              الانتقال إلى قسم الفرق
            </Button>
          )}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {plans.map(p => {
            const daysCount = Array.isArray(p.days_json) ? p.days_json.length : 0
            const exCountTotal = Array.isArray(p.days_json)
              ? p.days_json.reduce((acc, d) => acc + (d.exercises?.length || 0), 0)
              : 0

            return (
              <div
                key={p.id}
                style={{
                  background: 'var(--surface)',
                  borderRadius: 12,
                  border: '1px solid var(--sep-op)',
                  padding: 14
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--label)' }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 2 }}>
                      الفريق: <b>{p.team_name}</b> • {daysCount} أيام تدريبية • {exCountTotal} تمرين
                    </div>
                    {p.description && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 4 }}>
                        {p.description}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => copyTeamPlanToPersonal(p)}
                      title="نسخ إلى خططي المنفردة"
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        background: 'var(--surface-2)',
                        color: 'var(--label)',
                        border: '1px solid var(--sep-op)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      <Icon name="copy" /> نسخ للشخصي
                    </button>

                    <button
                      type="button"
                      onClick={() => nav(`/teams/plan?teamId=${p.team_id}&planId=${p.id}`)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        background: 'var(--acc)',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600
                      }}
                    >
                      تعديل وتخصيص الخطة
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* CREATE TEAM PLAN MODAL */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: 'var(--surface)', padding: 20, borderRadius: 14,
            maxWidth: 440, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
                إنشاء خطة فريق جديدة
              </h3>
              <button onClick={() => setShowCreateModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleCreateTeamPlan}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  اختر الفريق:
                </label>
                <select
                  value={newPlanTeamId}
                  onChange={e => setNewPlanTeamId(e.target.value)}
                  required
                  style={{
                    width: '100%', padding: '10px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                    color: 'var(--label)', fontSize: '0.85rem'
                  }}
                >
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  اسم الخطة الجماعية:
                </label>
                <input
                  type="text"
                  value={newPlanName}
                  onChange={e => setNewPlanName(e.target.value)}
                  placeholder="مثال: خطة الدفع والسحب والأرجل (PPL)"
                  required
                  style={{
                    width: '100%', padding: '10px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                    color: 'var(--label)', fontSize: '0.85rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  الوصف والهدف من الخطة:
                </label>
                <textarea
                  value={newPlanDesc}
                  onChange={e => setNewPlanDesc(e.target.value)}
                  placeholder="خطة تدريبية للمجموعة مع إمكانية التخصيص الفردي..."
                  rows={2}
                  style={{
                    width: '100%', padding: '10px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                    color: 'var(--label)', fontSize: '0.85rem', resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, background: 'transparent',
                    border: '1px solid var(--sep-op)', color: 'var(--label)', cursor: 'pointer'
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 18px', borderRadius: 8, background: 'var(--acc)',
                    border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  إنشاء الخطة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
