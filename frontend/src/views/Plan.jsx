import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import {
  dayAssignSheet, starterPlanSheet, confirmSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile, startFlow
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

export const ARABIC_WEEKDAYS = [
  { id: 6, name: 'السبت' },
  { id: 0, name: 'الأحد' },
  { id: 1, name: 'الاثنين' },
  { id: 2, name: 'الثلاثاء' },
  { id: 3, name: 'الأربعاء' },
  { id: 4, name: 'الخميس' },
  { id: 5, name: 'الجمعة' }
]

export const PLAN_VIEW_KEY = 'gym_plan_view'
const readView = () => {
  try {
    const v = localStorage.getItem(PLAN_VIEW_KEY)
    if (['schedule', 'team_schedule', 'routines', 'teams'].includes(v)) return v
    return 'schedule'
  } catch { return 'schedule' }
}

export function deleteRoutineWithUndo(id) {
  const st = useStore.getState()
  const snap = routineSnapshot(st.S, id)
  if (!snap) return false
  const before = st.S
  st.update(s => { deleteRoutine(s, id) })
  snap.marks = undoMarks(before, useStore.getState().S)
  useUI.getState().toast(t('“{0}” gone.', snap.routine.name), { action: t('Undo'), onAction: () => undoDeleteRoutine(snap) })
  return true
}

export function undoDeleteRoutine(snap) {
  let ok = false
  useStore.getState().update(s => { ok = restoreRoutine(s, snap); if (ok && snap.marks) markUndone(s, snap.marks) })
  if (!ok) useUI.getState().toast(t('It’s already back.'))
  return ok
}

export function takeOutOfLoop(idOrAt, setSeq, seq, label) {
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
      if (marks) markUndone(s, marks)
      return
    }
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
    try { localStorage.setItem(PLAN_VIEW_KEY, v) } catch { }
  }

  const showCoach = isOn(S, 'coach') && coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

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
  const progChip = programmeChip(S)

  return <div className="narrow plan" style={{ direction: 'rtl' }}>
    <div className="hdr">
      <SeasonDeco spot="header-bats" />
      <div>
        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700 }}>
          {view === 'team_schedule' ? 'جدول الفريق' : view === 'teams' ? 'خطط وقوالب الفريق' : view === 'routines' ? 'خطط منفردة' : 'الجدول الشخصي'}
        </h1>
        <div className="sub" style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
          {view === 'team_schedule'
            ? 'جدول تمارين الفريق الأسبوعي المعتمد من المدرب'
            : view === 'teams'
            ? 'إدارة القوالب الجماعية والتخصيص الفردي'
            : view === 'routines'
            ? 'خططك وتمارينك المنفردة المستقلة'
            : 'أيام تمرينك واستشفائك الأسبوعية'}
        </div>
      </div>
      <div className="hdr-actions">
        {showCoach && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => nav('/coach')}>{t('Coach')}</Button>}
        <button className="iconbtn" data-tour="plan-menu" onClick={openMenu} aria-label={t('Plan options')} title={t('Plan options')}>
          <Icon name="share" />
        </button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />

    <Segmented className="plan-views" tour="plan-views" value={view} onChange={setView}
      options={[
        { value: 'schedule', label: 'الجدول الشخصي' },
        { value: 'team_schedule', label: 'جدول الفريق' },
        { value: 'routines', label: 'خطط منفردة' },
        { value: 'teams', label: 'خطط وقوالب الفريق' }
      ]} />

    {progChip && <button type="button" className="prog-strip" onClick={() => nav('/plan/programmes')}>
      <Icon name="calendar" /><span className="grow">{S.programmes?.[S.programme?.id]?.name || t('Programme')}</span><span className="tag acc">{progChip}</span>
    </button>}

    {view === 'team_schedule'
      ? <TeamScheduleHub S={S} update={update} nav={nav} />
      : view === 'teams'
      ? <TeamPlansHub S={S} update={update} nav={nav} />
      : view === 'routines'
      ? <Routines S={S} update={update} nav={nav} />
      : <PersonalSchedule S={S} update={update} nav={nav} mode={mode} />}
  </div>
}

/* ================================ 1. Personal Schedule ================================ */

function PersonalSchedule({ S, update, nav, mode }) {
  const [assigningDay, setAssigningDay] = useState(null)
  const [showRotationLoop, setShowRotationLoop] = useState(false)
  const toast = useUI(s => s.toast)
  const todayDow = new Date().getDay()

  const routineOf = id => S.routines.find(x => x.id === id)
  const dayRoutines = d => [].concat(S.week[d] || []).map(routineOf).filter(Boolean)

  function assignRoutineToDay(dayId, routineId) {
    update(s => {
      if (!routineId) {
        delete s.week[dayId]
      } else {
        s.week[dayId] = [routineId]
      }
    })
    setAssigningDay(null)
    toast('تم تحديث جدولك الشخصي بنجاح!')
  }

  function handleCreateAndAssign(dayId) {
    const dayObj = ARABIC_WEEKDAYS.find(w => w.id === dayId)
    const dayName = dayObj ? dayObj.name : 'اليوم'
    const r = { id: uid(), name: `روتين ${dayName}`, emoji: DEFAULT_GLYPH, ex: [] }
    update(s => {
      s.routines.push(r)
      s.week[dayId] = [r.id]
    })
    setAssigningDay(null)
    nav('/plan/r/' + r.id)
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
            جدولك الأسبوعي الشخصي
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
            حدد الروتين والتمارين لكل يوم من أيام الأسبوع، أو اختر يوم راحة واستشفاء
          </span>
        </div>
      </div>

      {/* 7 DAYS LIST */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
        {ARABIC_WEEKDAYS.map(day => {
          const rs = dayRoutines(day.id)
          const isToday = day.id === todayDow
          const hasWorkout = rs.length > 0

          return (
            <div
              key={day.id}
              style={{
                background: 'var(--surface)',
                borderRadius: 14,
                border: isToday ? '1px solid var(--acc)' : '1px solid var(--sep-op)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontWeight: 700,
                    fontSize: '1rem',
                    color: isToday ? 'var(--acc)' : 'var(--label)'
                  }}>
                    {day.name}
                  </span>
                  {isToday && (
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: 'rgba(52, 199, 89, 0.15)',
                      color: 'var(--green)',
                      fontSize: '0.75rem',
                      fontWeight: 700
                    }}>
                      اليوم
                    </span>
                  )}
                </div>

                {hasWorkout ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
                    {rs.reduce((acc, r) => acc + (r.ex?.length || 0), 0)} تمرين
                  </span>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--label-3)' }}>
                    راحة واستشفاء
                  </span>
                )}
              </div>

              {hasWorkout ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--label)' }}>
                      {rs.map(r => r.name).join(' + ')}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => startFlow(rs.map(r => r.id))}
                      style={{
                        padding: '6px 14px', borderRadius: 8, background: 'var(--acc)',
                        color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      بدء التمرين الآن
                    </button>

                    <button
                      type="button"
                      onClick={() => nav('/plan/r/' + rs[0].id)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, background: 'var(--surface-2)',
                        color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      تعديل التمارين
                    </button>

                    <button
                      type="button"
                      onClick={() => setAssigningDay(day)}
                      style={{
                        padding: '6px 12px', borderRadius: 8, background: 'var(--surface-2)',
                        color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      تغيير الروتين
                    </button>

                    <button
                      type="button"
                      onClick={() => assignRoutineToDay(day.id, null)}
                      style={{
                        padding: '6px 10px', borderRadius: 8, background: 'transparent',
                        color: 'var(--label-3)', border: 'none', fontSize: '0.8rem', cursor: 'pointer'
                      }}
                    >
                      إلغاء (راحة)
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--label-2)' }}>
                    لا توجد تمارين محددة لهذا اليوم
                  </span>
                  <button
                    type="button"
                    onClick={() => setAssigningDay(day)}
                    style={{
                      padding: '6px 14px', borderRadius: 8, background: 'var(--surface-2)',
                      color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.8rem',
                      fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    + تعيين روتين لهذا اليوم
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* QUICK ADD ROUTINE */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => {
            const r = { id: uid(), name: 'روتين جديد', emoji: DEFAULT_GLYPH, ex: [] }
            update(s => { s.routines.push(r) })
            nav('/plan/r/' + r.id)
          }}
          style={{
            padding: '10px 16px', borderRadius: 10, background: 'var(--surface-2)',
            color: 'var(--label)', border: '1px solid var(--sep-op)', fontWeight: 600,
            fontSize: '0.85rem', cursor: 'pointer'
          }}
        >
          + إضافة روتين جديد وتعديل تمارينه
        </button>

        <button
          type="button"
          onClick={() => setShowRotationLoop(!showRotationLoop)}
          style={{
            background: 'transparent', border: 'none', color: 'var(--label-2)',
            fontSize: '0.85rem', cursor: 'pointer'
          }}
        >
          {showRotationLoop ? 'إخفاء نظام التكرار الدوري' : 'عرض نظام التكرار الدوري (Rotation)'}
        </button>
      </div>

      {/* ROTATION LOOP OPTION IF EXPANDED */}
      {showRotationLoop && (
        <div style={{ background: 'var(--surface-2)', padding: 16, borderRadius: 14, marginBottom: 20, border: '1px solid var(--sep-op)' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', color: 'var(--label)' }}>
            نظام التكرار الدوري (Rotation Loop)
          </h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: 'var(--label-2)', lineHeight: 1.5 }}>
            يتيح لك ترتيب روتين التدريب في حلقة متتابعة بغض النظر عن أيام الأسبوع الثابتة، بحيث ينتقل التمرين التالي تلقائياً عند إكمال الحصة.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant={mode === 'week' ? 'primary' : 'tinted'} onClick={() => update(s => { chooseFixedWeek(s) })}>
              الجدول الأسبوعي الثابت
            </Button>
            <Button size="sm" variant={mode === 'rotation' ? 'primary' : 'tinted'} onClick={() => update(s => { chooseRotation(s) })}>
              تفعيل التكرار الدوري
            </Button>
          </div>
        </div>
      )}

      {/* MODAL: ASSIGN ROUTINE TO DAY */}
      {assigningDay && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: 'var(--surface)', padding: 20, borderRadius: 16,
            maxWidth: 420, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
                تعيين روتين ليوم {assigningDay.name}
              </h3>
              <button
                type="button"
                onClick={() => setAssigningDay(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
              <button
                type="button"
                onClick={() => assignRoutineToDay(assigningDay.id, null)}
                style={{
                  padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)',
                  color: 'var(--label)', border: '1px solid var(--sep-op)', textAlign: 'right',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem'
                }}
              >
                يوم راحة واستشفاء (تفريغ اليوم)
              </button>

              {S.routines.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => assignRoutineToDay(assigningDay.id, r.id)}
                  style={{
                    padding: '12px 14px', borderRadius: 10, background: 'var(--surface)',
                    color: 'var(--label)', border: '1px solid var(--sep-op)', textAlign: 'right',
                    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>{r.ex?.length || 0} تمرين</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => handleCreateAndAssign(assigningDay.id)}
              style={{
                width: '100%', padding: '10px', borderRadius: 10, background: 'var(--acc)',
                color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
              }}
            >
              + إنشاء روتين جديد وتعيينه فوراً لهذا اليوم
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================ 2. Team Schedule Hub ================================ */

function TeamScheduleHub({ S, update, nav }) {
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [schedule, setSchedule] = useState({})
  const [teamPlans, setTeamPlans] = useState([])
  const [isCoach, setIsCoach] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingDay, setEditingDay] = useState(null)
  const [sessionName, setSessionName] = useState('')
  const [sessionNotes, setSessionNotes] = useState('')
  const [sourcePlanId, setSourcePlanId] = useState('')
  const [sourceRoutineId, setSourceRoutineId] = useState('')
  const toast = useUI(s => s.toast)
  const todayDow = new Date().getDay()

  useEffect(() => {
    fetch('/api/teams')
      .then(r => r.ok ? r.json() : { teams: [] })
      .then(d => {
        const tms = d.teams || []
        setTeams(tms)
        if (tms.length > 0) {
          setSelectedTeamId(tms[0].id)
        } else {
          setLoading(false)
        }
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedTeamId) return
    loadTeamSchedule(selectedTeamId)
  }, [selectedTeamId])

  async function loadTeamSchedule(teamId) {
    setLoading(true)
    try {
      const [schedRes, detailsRes] = await Promise.all([
        fetch(`/api/teams/schedule?teamId=${teamId}`),
        fetch(`/api/teams/details?teamId=${teamId}`)
      ])
      if (schedRes.ok) {
        const d = await schedRes.json()
        setSchedule(d.schedule || {})
        setIsCoach(!!d.is_coach)
      }
      if (detailsRes.ok) {
        const det = await detailsRes.json()
        setTeamPlans(det.team?.plans || [])
      }
    } catch (e) {
      console.warn('Error loading team schedule:', e)
    } finally {
      setLoading(false)
    }
  }

  async function saveDayAssignment(dayId, sessionData) {
    const updated = { ...schedule, [dayId]: sessionData }
    try {
      const res = await fetch('/api/teams/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: selectedTeamId, schedule: updated })
      })
      if (res.ok) {
        setSchedule(updated)
        toast('تم تحديث جدول الفريق بنجاح!')
        setEditingDay(null)
      } else {
        toast('تعذر حفظ جدول الفريق')
      }
    } catch (e) {
      toast('خطأ في الاتصال بالخادم')
    }
  }

  function handleOpenEditDay(day) {
    setEditingDay(day)
    const existing = schedule[day.id] || {}
    setSessionName(existing.name || '')
    setSessionNotes(existing.notes || '')
    setSourcePlanId(existing.plan_id || '')
    setSourceRoutineId('')
  }

  function handleSaveDayModal(e) {
    e.preventDefault()
    if (!editingDay) return
    let exercises = []
    let name = sessionName.trim()

    if (sourcePlanId) {
      const plan = teamPlans.find(p => p.id === sourcePlanId)
      if (plan) {
        name = name || plan.name
        if (Array.isArray(plan.days_json)) {
          plan.days_json.forEach(d => {
            if (Array.isArray(d.exercises)) exercises.push(...d.exercises)
          })
        }
      }
    } else if (sourceRoutineId) {
      const routine = S.routines.find(r => r.id === sourceRoutineId)
      if (routine) {
        name = name || routine.name
        exercises = routine.ex.map(ex => ({ id: ex.id, name: ex.id, sets: ex.sets?.length || 3, reps: '8-10' }))
      }
    }

    if (!name) name = `حصة تدريبية ليوم ${editingDay.name}`

    saveDayAssignment(editingDay.id, {
      name,
      exercises,
      notes: sessionNotes.trim(),
      plan_id: sourcePlanId || null,
      rest: false
    })
  }

  function handleClearDay(dayId) {
    const updated = { ...schedule }
    delete updated[dayId]
    saveDayAssignment(dayId, { rest: true, name: 'يوم راحة للفريق' })
  }

  function handleStartTeamWorkout(dayData) {
    if (!dayData || !dayData.exercises?.length) {
      toast('لا توجد تمارين مسجلة لهذه الحصة بعد')
      return
    }
    let routine = S.routines.find(r => r.name === dayData.name)
    if (!routine) {
      routine = {
        id: uid(),
        name: dayData.name,
        emoji: DEFAULT_GLYPH,
        ex: dayData.exercises.map(e => ({
          id: e.id || e.exercise_id,
          sets: Array(e.sets || 3).fill().map(() => ({ w: e.target_weight || 0, r: e.reps || 10 }))
        }))
      }
      update(s => { s.routines.push(routine) })
    }
    startFlow([routine.id])
  }

  if (teams.length === 0) {
    return (
      <EmptyState icon="person" title="لست عضواً أو مدرباً في أي فريق" text="انضم إلى فريق رياضي برمز الدعوة أو أنشئ فريقك الخاص لإدارة جدول التمارين.">
        <Button variant="tinted" icon="plus" onClick={() => nav('/teams')}>
          الانتقال إلى قسم الفرق
        </Button>
      </EmptyState>
    )
  }

  return (
    <div style={{ marginTop: 14 }}>
      {/* HEADER & TEAM SELECTOR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--label)' }}>
            جدول تدريب الفريق
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
            {isCoach ? 'أنت مدرب هذا الفريق • يمكنك تحديد التمارين وجدول الأسبوع للجميع' : 'جدول تمارين مجموعتك المعتمد من المدرب'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={selectedTeamId}
            onChange={e => setSelectedTeamId(e.target.value)}
            style={{
              padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)',
              border: '1px solid var(--sep-op)', color: 'var(--label)', fontSize: '0.85rem'
            }}
          >
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--label-2)' }}>
          جاري تحميل جدول الفريق...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          {ARABIC_WEEKDAYS.map(day => {
            const dayData = schedule[day.id]
            const isRest = !dayData || dayData.rest || !dayData.name
            const isToday = day.id === todayDow

            return (
              <div
                key={day.id}
                style={{
                  background: 'var(--surface)',
                  borderRadius: 14,
                  border: isToday ? '1px solid var(--acc)' : '1px solid var(--sep-op)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: isToday ? 'var(--acc)' : 'var(--label)' }}>
                      {day.name}
                    </span>
                    {isToday && (
                      <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(52, 199, 89, 0.15)', color: 'var(--green)', fontSize: '0.75rem', fontWeight: 700 }}>
                        اليوم
                      </span>
                    )}
                  </div>

                  {!isRest ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
                      {dayData.exercises?.length || 0} تمرين
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--label-3)' }}>
                      راحة للفريق
                    </span>
                  )}
                </div>

                {!isRest ? (
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--label)', marginBottom: 4 }}>
                      {dayData.name}
                    </div>
                    {dayData.notes && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 8 }}>
                        ملاحظة المدرب: {dayData.notes}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => handleStartTeamWorkout(dayData)}
                        style={{
                          padding: '6px 14px', borderRadius: 8, background: 'var(--acc)',
                          color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer'
                        }}
                      >
                        بدء تمرين اليوم للفريق
                      </button>

                      {isCoach && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEditDay(day)}
                            style={{
                              padding: '6px 12px', borderRadius: 8, background: 'var(--surface-2)',
                              color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.8rem', cursor: 'pointer'
                            }}
                          >
                            تعديل اليوم
                          </button>

                          <button
                            type="button"
                            onClick={() => handleClearDay(day.id)}
                            style={{
                              padding: '6px 10px', borderRadius: 8, background: 'transparent',
                              color: 'var(--label-3)', border: 'none', fontSize: '0.8rem', cursor: 'pointer'
                            }}
                          >
                            تحويل إلى راحة
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--label-2)' }}>
                      يوم راحة واستشفاء للمجموعة
                    </span>
                    {isCoach && (
                      <button
                        type="button"
                        onClick={() => handleOpenEditDay(day)}
                        style={{
                          padding: '6px 14px', borderRadius: 8, background: 'var(--surface-2)',
                          color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.8rem',
                          fontWeight: 600, cursor: 'pointer'
                        }}
                      >
                        + تعيين تمرين لهذا اليوم
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL: EDIT TEAM DAY (FOR COACH) */}
      {editingDay && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: 'var(--surface)', padding: 20, borderRadius: 16,
            maxWidth: 440, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
                تعديل جدول الفريق ليوم {editingDay.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingDay(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleSaveDayModal}>
              {teamPlans.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                    اختيار من خطط وقوالب الفريق:
                  </label>
                  <select
                    value={sourcePlanId}
                    onChange={e => {
                      setSourcePlanId(e.target.value)
                      setSourceRoutineId('')
                      const p = teamPlans.find(x => x.id === e.target.value)
                      if (p) setSessionName(p.name)
                    }}
                    style={{
                      width: '100%', padding: '10px', borderRadius: 8,
                      background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                      color: 'var(--label)', fontSize: '0.85rem'
                    }}
                  >
                    <option value="">-- اختر خطة فريق موجودة (اختياري) --</option>
                    {teamPlans.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {S.routines.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                    أو اختيار من خططك الشخصية:
                  </label>
                  <select
                    value={sourceRoutineId}
                    onChange={e => {
                      setSourceRoutineId(e.target.value)
                      setSourcePlanId('')
                      const r = S.routines.find(x => x.id === e.target.value)
                      if (r) setSessionName(r.name)
                    }}
                    style={{
                      width: '100%', padding: '10px', borderRadius: 8,
                      background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                      color: 'var(--label)', fontSize: '0.85rem'
                    }}
                  >
                    <option value="">-- اختر خطة شخصية لتحويلها للفريق (اختياري) --</option>
                    {S.routines.map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.ex?.length || 0} تمرين)</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  عنوان الحصة التدريبية:
                </label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={e => setSessionName(e.target.value)}
                  placeholder="مثال: تمارين الصدر والترايسبس"
                  required
                  style={{
                    width: '100%', padding: '10px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                    color: 'var(--label)', fontSize: '0.85rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  تعليمات وملاحظات المدرب لليوم:
                </label>
                <input
                  type="text"
                  value={sessionNotes}
                  onChange={e => setSessionNotes(e.target.value)}
                  placeholder="مثال: راحة 90 ثانية، الإحماء 10 دقائق قبل البدء"
                  style={{
                    width: '100%', padding: '10px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                    color: 'var(--label)', fontSize: '0.85rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setEditingDay(null)}
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
                  حفظ في جدول الفريق
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================ 3. Personal Routines ================================ */

function Routines({ S, update, nav }) {
  const [edit, setEdit] = useState(false)
  const [flash, setFlash] = useState(null)
  const [copyTargetRoutine, setCopyTargetRoutine] = useState(null)
  const [assignDayRoutine, setAssignDayRoutine] = useState(null)
  const [teams, setTeams] = useState([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [targetTeamDay, setTargetTeamDay] = useState('')
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
        // If a day in team schedule was chosen, assign it there too
        if (targetTeamDay !== '') {
          const dayId = parseInt(targetTeamDay, 10)
          const schedRes = await fetch(`/api/teams/schedule?teamId=${selectedTeamId}`)
          if (schedRes.ok) {
            const schedData = await schedRes.json()
            const curSched = schedData.schedule || {}
            curSched[dayId] = {
              name: copyTargetRoutine.name,
              exercises: copyTargetRoutine.ex.map(e => ({ id: e.id, name: e.id, sets: e.sets?.length || 3, reps: '8-10' })),
              notes: 'منسوخة من الخطط المنفردة',
              rest: false
            }
            await fetch('/api/teams/schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ team_id: selectedTeamId, schedule: curSched })
            })
          }
        }

        toast(`تم نسخ "${copyTargetRoutine.name}" إلى الفريق بنجاح!`)
        setCopyTargetRoutine(null)
        setTargetTeamDay('')
      } else {
        toast('تعذر نسخ الخطة إلى الفريق')
      }
    } catch (e) {
      toast('خطأ في الاتصال بالخادم')
    }
  }

  function handleAssignRoutineToWeekday(dayId) {
    if (!assignDayRoutine) return
    update(s => {
      const cur = [].concat(s.week[dayId] || [])
      if (cur.includes(assignDayRoutine.id)) {
        s.week[dayId] = cur.filter(x => x !== assignDayRoutine.id)
        if (!s.week[dayId].length) delete s.week[dayId]
      } else {
        s.week[dayId] = [...cur, assignDayRoutine.id]
      }
    })
    const dayObj = ARABIC_WEEKDAYS.find(w => w.id === dayId)
    toast(`تم تحديث جدول يوم ${dayObj?.name || ''}`)
  }

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

  const daysOf = id => ARABIC_WEEKDAYS.filter(d => [].concat(S.week[d.id] || []).includes(id)).map(d => d.name)
  const sub = r => [exCount(r.ex.length), daysOf(r.id).join('، ')].filter(Boolean).join(' • ')

  return <>
    <div className="row between plan-sec-h plan-routines-bar" style={{ marginTop: 12 }}>
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
            <div style={{ display: 'flex', gap: 4, marginRight: 8 }}>
              <button
                type="button"
                className="iconbtn"
                title="تعيين ليوم بالجدول الشخصي"
                onClick={e => { e.stopPropagation(); setAssignDayRoutine(r); }}
                style={{ color: 'var(--label)' }}
              >
                <Icon name="calendar" />
              </button>
              {teams.length > 0 && (
                <button
                  type="button"
                  className="iconbtn"
                  title="نسخ إلى خطة وجدول الفريق"
                  onClick={e => { e.stopPropagation(); setCopyTargetRoutine(r); }}
                  style={{ color: 'var(--acc)' }}
                >
                  <Icon name="share" />
                </button>
              )}
            </div>
            <Icon name="chevronRight" className="chev" /></div>
          return swipe
            ? <SwipeRow key={r.id} className="swrow-item" copyLabel={t('Duplicate')}
              onDelete={() => remove(r)} onCopy={() => duplicate(r)}
              flash={flash?.id === r.id ? flash.n : 0}>{row}</SwipeRow>
            : row
        })}</div>}
      <p className="sect-f">{edit ? t('Drag to reorder. Tap the minus to delete.') : 'اضغط على الروتين لتعديل التمارين، أو استخدم الأيقونات لتعيينه بالجدول أو نسخه للفريق.'}</p>
    </> : <>
      <EmptyState icon="clipboard" title={t('No routines yet.')} text={t('Make one, or grab the starter plan to get going.')}>
        <Button variant="tinted" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
      </EmptyState>
    </>}

    {/* MODAL: ASSIGN ROUTINE TO PERSONAL WEEKDAYS */}
    {assignDayRoutine && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
      }}>
        <div style={{
          background: 'var(--surface)', padding: 20, borderRadius: 16,
          maxWidth: 420, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
              تعيين "{assignDayRoutine.name}" بأيام الأسبوع
            </h3>
            <button
              type="button"
              onClick={() => setAssignDayRoutine(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 12 }}>
            اختر الأيام التي تريد تنفيذ هذا الروتين فيها ضمن جدولك الشخصي:
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16 }}>
            {ARABIC_WEEKDAYS.map(day => {
              const active = [].concat(S.week[day.id] || []).includes(assignDayRoutine.id)
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => handleAssignRoutineToWeekday(day.id)}
                  style={{
                    padding: '10px', borderRadius: 8,
                    background: active ? 'var(--acc)' : 'var(--surface-2)',
                    color: active ? '#fff' : 'var(--label)',
                    border: '1px solid var(--sep-op)', fontWeight: 600, fontSize: '0.85rem',
                    cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                >
                  <span>{day.name}</span>
                  {active && <Icon name="check" />}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => setAssignDayRoutine(null)}
            style={{
              width: '100%', padding: '10px', borderRadius: 8, background: 'var(--surface-2)',
              color: 'var(--label)', border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
            }}
          >
            إغلاق
          </button>
        </div>
      </div>
    )}

    {/* MODAL: COPY PERSONAL ROUTINE TO TEAM */}
    {copyTargetRoutine && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
      }}>
        <div style={{
          background: 'var(--surface)', padding: 20, borderRadius: 16,
          maxWidth: 440, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
              نسخ الخطة إلى خطة وجدول الفريق
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

            <div style={{ marginBottom: 14 }}>
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

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                تعيين في جدول الفريق (اختياري):
              </label>
              <select
                value={targetTeamDay}
                onChange={e => setTargetTeamDay(e.target.value)}
                style={{
                  width: '100%', padding: '10px', borderRadius: 8,
                  background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                  color: 'var(--label)', fontSize: '0.85rem'
                }}
              >
                <option value="">بدون تعيين ليوم محدد حالياً (قالب فقط)</option>
                {ARABIC_WEEKDAYS.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
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
                تأكيد النسخ والتعيين
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>
}

/* ================================ 4. Team Plans Hub ================================ */

function TeamPlansHub({ S, update, nav }) {
  const [plans, setPlans] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [assigningPlan, setAssigningPlan] = useState(null)
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

  function copyTeamPlanToPersonal(teamPlan, assignDayId = null) {
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
      if (assignDayId !== null) {
        s.week[assignDayId] = [newRoutine.id]
      }
    })
    toast(`تم نسخ خطة "${teamPlan.name}" إلى خططك المنفردة بنجاح!`)
  }

  async function handleAssignPlanToTeamSchedule(plan, dayId) {
    try {
      const schedRes = await fetch(`/api/teams/schedule?teamId=${plan.team_id}`)
      if (schedRes.ok) {
        const d = await schedRes.json()
        const curSched = d.schedule || {}
        let exercises = []
        if (Array.isArray(plan.days_json)) {
          plan.days_json.forEach(dayObj => {
            if (Array.isArray(dayObj.exercises)) exercises.push(...dayObj.exercises)
          })
        }
        curSched[dayId] = {
          name: plan.name,
          exercises,
          notes: plan.description || 'معتمد من خطة الفريق',
          plan_id: plan.id,
          rest: false
        }
        await fetch('/api/teams/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_id: plan.team_id, schedule: curSched })
        })
        const dayObj = ARABIC_WEEKDAYS.find(w => w.id === dayId)
        toast(`تم تعيين الخطة في جدول الفريق ليوم ${dayObj?.name || ''}!`)
        setAssigningPlan(null)
      }
    } catch (e) {
      toast('خطأ في تعيين الخطة بالجدول')
    }
  }

  async function handleDeleteTeamPlan(planId) {
    if (!window.confirm('هل أنت متأكد من حذف هذه الخطة؟')) return
    try {
      const res = await fetch(`/api/teams/plan?planId=${planId}`, { method: 'DELETE' })
      if (res.ok) {
        toast('تم حذف خطة الفريق بنجاح')
        loadData()
      } else {
        toast('تعذر حذف الخطة')
      }
    } catch (e) {
      toast('خطأ في الاتصال بالخادم')
    }
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
            خطط وقوالب الفرق
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
            إدارة القوالب الجماعية وإمكانية تعيينها في جدول الفريق أو نسخها للخطط الشخصية
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
                  borderRadius: 14,
                  border: '1px solid var(--sep-op)',
                  padding: 16
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--label)' }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 4 }}>
                      الفريق: <b>{p.team_name}</b> • {daysCount} أيام تدريبية • {exCountTotal} تمرين
                    </div>
                    {p.description && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 4 }}>
                        {p.description}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setAssigningPlan(p)}
                      title="تعيين في جدول الفريق"
                      style={{
                        padding: '6px 12px', borderRadius: 8, background: 'var(--surface-2)',
                        color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer',
                        fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6
                      }}
                    >
                      <Icon name="calendar" /> تعيين بجدول الفريق
                    </button>

                    <button
                      type="button"
                      onClick={() => copyTeamPlanToPersonal(p)}
                      title="نسخ إلى خططي المنفردة"
                      style={{
                        padding: '6px 12px', borderRadius: 8, background: 'var(--surface-2)',
                        color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer',
                        fontSize: '0.8rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4
                      }}
                    >
                      <Icon name="copy" /> نسخ للشخصي
                    </button>

                    <button
                      type="button"
                      onClick={() => nav(`/teams/plan?teamId=${p.team_id}&planId=${p.id}`)}
                      style={{
                        padding: '6px 14px', borderRadius: 8, background: 'var(--acc)',
                        color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600
                      }}
                    >
                      تعديل وتخصيص الخطة
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteTeamPlan(p.id)}
                      style={{
                        padding: '6px 10px', borderRadius: 8, background: 'transparent',
                        color: 'var(--label-3)', border: 'none', cursor: 'pointer', fontSize: '0.8rem'
                      }}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL: ASSIGN PLAN TO TEAM SCHEDULE DAY */}
      {assigningPlan && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: 'var(--surface)', padding: 20, borderRadius: 16,
            maxWidth: 420, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
                تعيين الخطة في جدول الفريق
              </h3>
              <button onClick={() => setAssigningPlan(null)} style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 12 }}>
              الخطة: <b>{assigningPlan.name}</b> • اختر اليوم المراد تعيين هذه الخطة فيه ضمن جدول الفريق:
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 16 }}>
              {ARABIC_WEEKDAYS.map(day => (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => handleAssignPlanToTeamSchedule(assigningPlan, day.id)}
                  style={{
                    padding: '12px 10px', borderRadius: 8, background: 'var(--surface-2)',
                    color: 'var(--label)', border: '1px solid var(--sep-op)', fontWeight: 600,
                    fontSize: '0.85rem', cursor: 'pointer', textAlign: 'center'
                  }}
                >
                  {day.name}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setAssigningPlan(null)}
              style={{
                width: '100%', padding: '10px', borderRadius: 8, background: 'var(--surface-2)',
                color: 'var(--label)', border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
              }}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* CREATE TEAM PLAN MODAL */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: 'var(--surface)', padding: 20, borderRadius: 16,
            maxWidth: 440, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--label)' }}>
                إنشاء خطة وقالب فريق جديد
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
