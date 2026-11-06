import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'

export default function TeamPlanCustomizer() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const teamId = params.get('teamId')
  const toast = useUI(s => s.toast)

  const [team, setTeam] = useState(null)
  const [selectedMember, setSelectedMember] = useState(null) // null = Master Plan, object = individual trainee
  const [plan, setPlan] = useState({
    name: 'البرنامج الجماعي الأساسي للفريق',
    description: 'خطة تدريبية للمجموعة مع إمكانية التخصيص الفردي لكل متدرب',
    days_json: [
      {
        id: 'day_1',
        name: 'اليوم الأول: دفع وتطوير الصدر والكتف',
        exercises: [
          { id: '0025', name: 'Barbell Bench Press', sets: 4, reps: '8-10', rest: 90, rpe: '8' },
          { id: '0031', name: 'Barbell Overhead Press', sets: 3, reps: '10-12', rest: 60, rpe: '7' },
          { id: '0289', name: 'Dumbbell Incline Bench Press', sets: 3, reps: '10-12', rest: 60, rpe: '8' },
          { id: '0858', name: 'Cable Triceps Pushdown', sets: 3, reps: '12-15', rest: 45, rpe: '8' }
        ]
      },
      {
        id: 'day_2',
        name: 'اليوم الثاني: سحب وتقوية الظهر والبايسبس',
        exercises: [
          { id: '0027', name: 'Barbell Bent Over Row', sets: 4, reps: '8-10', rest: 90, rpe: '8' },
          { id: '0861', name: 'Cable Seated Row', sets: 3, reps: '10-12', rest: 60, rpe: '8' },
          { id: '0294', name: 'Dumbbell Biceps Curl', sets: 3, reps: '10-12', rest: 45, rpe: '8' }
        ]
      }
    ]
  })

  const [overrides, setOverrides] = useState({}) // key: `${day_id}_${exercise_id}` -> override object
  const [aiSuggestions, setAiSuggestions] = useState(null)
  const [loadingAi, setLoadingAi] = useState(false)

  useEffect(() => {
    if (teamId) fetchTeamData()
  }, [teamId])

  useEffect(() => {
    if (selectedMember && plan.id) {
      fetchMemberOverrides(selectedMember.uid)
    } else {
      setOverrides({})
    }
  }, [selectedMember, plan.id])

  async function fetchTeamData() {
    try {
      const res = await fetch(`/api/teams/details?teamId=${teamId}`)
      if (res.ok) {
        const data = await res.json()
        setTeam(data.team)
        if (data.team.plans && data.team.plans.length > 0) {
          const p = data.team.plans[0]
          setPlan({
            id: p.id,
            name: p.name,
            description: p.description,
            days_json: p.days_json || []
          })
        }
      }
    } catch (e) {
      console.warn('Error fetching team:', e)
    }
  }

  async function fetchMemberOverrides(uid) {
    try {
      const res = await fetch(`/api/teams/plan/overrides?planId=${plan.id}&uid=${uid}`)
      if (res.ok) {
        const data = await res.json()
        const map = {}
        for (const ov of (data.overrides || [])) {
          map[`${ov.day_id}_${ov.exercise_id}`] = ov
        }
        setOverrides(map)
      }
    } catch (e) {
      console.warn('Error fetching overrides:', e)
    }
  }

  function handleOverrideChange(dayId, exId, field, value) {
    const key = `${dayId}_${exId}`
    setOverrides(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || { day_id: dayId, exercise_id: exId }),
        [field]: value
      }
    }))
  }

  async function handleSaveIndividualOverrides() {
    if (!selectedMember || !plan.id) return
    try {
      let count = 0
      for (const [key, ov] of Object.entries(overrides)) {
        const [dayId, exId] = key.split('_')
        await fetch('/api/teams/plan/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            team_plan_id: plan.id,
            uid: selectedMember.uid,
            day_id: dayId,
            exercise_id: exId,
            custom_sets: ov.custom_sets ? parseInt(ov.custom_sets, 10) : null,
            custom_reps: ov.custom_reps || null,
            custom_weight: ov.custom_weight ? parseFloat(ov.custom_weight) : null,
            custom_rest_seconds: ov.custom_rest_seconds ? parseInt(ov.custom_rest_seconds, 10) : null,
            custom_intensity: ov.custom_intensity || null,
            alt_exercise_id: ov.alt_exercise_id || null,
            alt_notes: ov.alt_notes || null
          })
        })
        count++
      }
      toast(`تم حفظ التخصيص الفردي لـ (${selectedMember.uid}) بنجاح!`)
    } catch (e) {
      toast('حدث خطأ أثناء حفظ التخصيص')
    }
  }

  async function handleSaveMasterPlan() {
    if (!teamId) return
    try {
      const res = await fetch('/api/teams/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: plan.id,
          team_id: teamId,
          name: plan.name,
          description: plan.description,
          days_json: plan.days_json
        })
      })
      if (res.ok) {
        const data = await res.json()
        setPlan(prev => ({ ...prev, id: data.plan.id }))
        toast('تم حفظ البرنامج الجماعي الأساسي للفريق!')
      } else {
        toast('تعذر حفظ البرنامج')
      }
    } catch (e) {
      toast('خطأ في الاتصال')
    }
  }

  async function requestAiAssistance() {
    setLoadingAi(true)
    try {
      const goal = selectedMember?.primary_goal || 'General Fitness'
      const res = await fetch('/api/ai/coach-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'plan_gen',
          goal,
          experience: selectedMember?.experience_level || 'Beginner'
        })
      })
      if (res.ok) {
        const data = await res.json()
        setAiSuggestions(data)
      }
    } catch (e) {
      toast('تعذر طلب الذكاء الاصطناعي')
    } finally {
      setLoadingAi(false)
    }
  }

  return (
    <div className="page" style={{ padding: '16px', maxWidth: 880, margin: '0 auto', direction: 'rtl' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <button
            onClick={() => nav('/teams')}
            style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: 6 }}
          >
            ← العودة للفرق
          </button>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--label)' }}>
            البرنامج الجماعي مع التخصيص الفردي 📋
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            الفريق: <b>{team?.name || 'فريق التدريب'}</b> • قالب موحد مع مراعاة أهداف كل متدرب
          </div>
        </div>

        <button
          onClick={requestAiAssistance}
          style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--acc)', border: '1px solid var(--acc-line)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          🤖 {loadingAi ? 'جاري التحليل...' : 'اقتراحات الذكاء الاصطناعي'}
        </button>
      </div>

      {/* AI ADVISORY ACCORDION */}
      {aiSuggestions && (
        <div style={{ background: 'var(--surface-2)', padding: 16, borderRadius: 14, marginBottom: 20, border: '1px solid var(--acc-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ margin: 0, color: 'var(--acc)', fontSize: '1rem' }}>
              💡 توصيات الذكاء الاصطناعي العلمية لهدف: {selectedMember?.primary_goal || 'اللياقة العامة'}
            </h4>
            <button onClick={() => setAiSuggestions(null)} style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 10 }}>
            {aiSuggestions.advisory_note}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {aiSuggestions.recommendations?.map((r, i) => (
              <div key={i} style={{ background: 'var(--surface)', padding: 10, borderRadius: 10, fontSize: '0.85rem' }}>
                <b style={{ color: 'var(--label)' }}>{r.phase}:</b>
                <div style={{ color: 'var(--label-2)', marginTop: 4 }}>{r.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TRAINEE SELECTOR BAR */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 8 }}>
          اختر المتدرب لتعديل تمارينه الفردية، أو اختر البرنامج الأساسي:
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
          <button
            onClick={() => setSelectedMember(null)}
            style={{
              padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              background: selectedMember === null ? 'var(--acc)' : 'var(--surface-2)',
              color: selectedMember === null ? 'var(--on-acc)' : 'var(--label)',
              fontWeight: 700, fontSize: '0.9rem'
            }}
          >
            🏛️ قالب الفريق الموحد
          </button>

          {team?.members?.filter(m => m.role === 'trainee').map(m => (
            <button
              key={m.uid}
              onClick={() => setSelectedMember(m)}
              style={{
                padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                background: selectedMember?.uid === m.uid ? 'var(--acc)' : 'var(--surface-2)',
                color: selectedMember?.uid === m.uid ? 'var(--on-acc)' : 'var(--label)',
                fontWeight: selectedMember?.uid === m.uid ? 700 : 500, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              <span>👤 {m.uid}</span>
              <span style={{ fontSize: '0.75rem', opacity: 0.8, background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 6 }}>
                {m.primary_goal || 'عام'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ACTIVE EDITING BANNER */}
      <div style={{ background: selectedMember ? 'var(--surface-3)' : 'var(--surface)', padding: 14, borderRadius: 12, marginBottom: 16, border: '1px solid var(--sep-op)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {selectedMember ? (
            <div>
              <span style={{ color: 'var(--acc)', fontWeight: 700 }}>تخصيص فردي للمتدرب:</span> <b>{selectedMember.uid}</b>
              <span style={{ marginRight: 8, fontSize: '0.85rem', color: 'var(--label-2)' }}>
                (الهدف: {selectedMember.primary_goal || 'لياقة'} • الوزن: {selectedMember.current_weight || 'غير محدد'} كغ)
              </span>
            </div>
          ) : (
            <div>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>تعديل القالب الأساسي:</span> سيتم تطبيقه كقاعدة لكل الفريق
            </div>
          )}
        </div>

        <button
          onClick={selectedMember ? handleSaveIndividualOverrides : handleSaveMasterPlan}
          style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '8px 18px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
        >
          {selectedMember ? 'حفظ تخصيص هذا المتدرب فقط' : 'حفظ القالب الجماعي'}
        </button>
      </div>

      {/* WORKOUT DAYS AND EXERCISES */}
      {plan.days_json.map((day, dIdx) => (
        <div key={day.id || dIdx} className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 16, marginBottom: 16, border: '1px solid var(--sep-op)' }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', color: 'var(--label)' }}>
            {day.name}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {day.exercises.map(ex => {
              const ovKey = `${day.id}_${ex.id}`
              const ov = overrides[ovKey] || {}
              const isOverridden = selectedMember && (ov.custom_sets || ov.custom_reps || ov.custom_weight || ov.alt_exercise_id)

              return (
                <div
                  key={ex.id}
                  style={{
                    background: isOverridden ? 'var(--surface-3)' : 'var(--surface-2)',
                    padding: 14, borderRadius: 12, border: isOverridden ? '1px solid var(--acc)' : '1px solid var(--sep-op)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <b style={{ color: 'var(--label)', fontSize: '0.95rem' }}>{ex.name}</b>
                      {isOverridden && (
                        <span style={{ marginRight: 8, fontSize: '0.75rem', background: 'var(--acc)', color: 'var(--on-acc)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                          مخصص فردياً
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
                      الأساس: {ex.sets} مجموعات × {ex.reps} تكرار (راحة {ex.rest}ث)
                    </div>
                  </div>

                  {selectedMember ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>المجموعات</label>
                        <input
                          type="number"
                          placeholder={ex.sets}
                          value={ov.custom_sets || ''}
                          onChange={e => handleOverrideChange(day.id, ex.id, 'custom_sets', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>التكرار</label>
                        <input
                          type="text"
                          placeholder={ex.reps}
                          value={ov.custom_reps || ''}
                          onChange={e => handleOverrideChange(day.id, ex.id, 'custom_reps', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>الوزن المستهدف (كغ)</label>
                        <input
                          type="number"
                          step="0.5"
                          placeholder="تحدي الوزن"
                          value={ov.custom_weight || ''}
                          onChange={e => handleOverrideChange(day.id, ex.id, 'custom_weight', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>فترة الراحة (ثانية)</label>
                        <input
                          type="number"
                          placeholder={ex.rest}
                          value={ov.custom_rest_seconds || ''}
                          onChange={e => handleOverrideChange(day.id, ex.id, 'custom_rest_seconds', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>تمرين بديل (Alternative)</label>
                        <input
                          type="text"
                          placeholder="مثلاً: Dumbbell Bench"
                          value={ov.alt_exercise_id || ''}
                          onChange={e => handleOverrideChange(day.id, ex.id, 'alt_exercise_id', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>المجموعات الأساسية</label>
                        <input
                          type="number"
                          value={ex.sets}
                          onChange={e => {
                            ex.sets = parseInt(e.target.value, 10)
                            setPlan({ ...plan })
                          }}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>التكرارات الأساسية</label>
                        <input
                          type="text"
                          value={ex.reps}
                          onChange={e => {
                            ex.reps = e.target.value
                            setPlan({ ...plan })
                          }}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>الراحة (ثانية)</label>
                        <input
                          type="number"
                          value={ex.rest}
                          onChange={e => {
                            ex.rest = parseInt(e.target.value, 10)
                            setPlan({ ...plan })
                          }}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 8, background: 'var(--surface)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
