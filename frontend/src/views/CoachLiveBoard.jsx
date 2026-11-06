import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'

export default function CoachLiveBoard() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const teamIdParam = params.get('teamId') || ''
  const toast = useUI(s => s.toast)

  const [selectedTeam, setSelectedTeam] = useState(teamIdParam)
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'active' | 'completed' | 'missed'
  const [board, setBoard] = useState({ in_progress: [], completed: [], missed: [], teams: [], roster: [] })
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(Date.now())

  // Review modal
  const [reviewWorkout, setReviewWorkout] = useState(null)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [videoFeedbackUrl, setVideoFeedbackUrl] = useState('')

  useEffect(() => {
    fetchBoard()
    const timer = setInterval(fetchBoard, 6000) // auto-refresh every 6 seconds
    return () => clearInterval(timer)
  }, [selectedTeam])

  async function fetchBoard() {
    try {
      const url = selectedTeam
        ? `/api/coach/live-board?teamId=${encodeURIComponent(selectedTeam)}`
        : '/api/coach/live-board'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setBoard(data.liveBoard || { in_progress: [], completed: [], missed: [], teams: [], roster: [] })
        setLastUpdated(Date.now())
      }
    } catch (e) {
      console.warn('Live board fetch error:', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmitReview(e) {
    e.preventDefault()
    if (!reviewWorkout || !reviewComment.trim()) return
    try {
      const res = await fetch('/api/coach/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trainee_uid: reviewWorkout.uid,
          workout_id: reviewWorkout.workout_id || reviewWorkout.id,
          comment: reviewComment.trim(),
          rating: reviewRating,
          video_feedback_url: videoFeedbackUrl.trim()
        })
      })
      if (res.ok) {
        toast('تم إرسال مراجعة المدرب بنجاح')
        setReviewWorkout(null)
        setReviewComment('')
        setVideoFeedbackUrl('')
        fetchBoard()
      } else {
        toast('تعذر حفظ المراجعة')
      }
    } catch (e) {
      toast('خطأ في الاتصال بالخادم')
    }
  }

  const rosterList = board.roster || []
  const filteredRoster = rosterList.filter(row => {
    if (activeTab === 'active') return row.status === 'in_progress'
    if (activeTab === 'completed') return row.status === 'completed'
    if (activeTab === 'missed') return row.status === 'not_started'
    return true
  })

  const inProgressCount = rosterList.filter(r => r.status === 'in_progress').length
  const completedCount = rosterList.filter(r => r.status === 'completed').length
  const notStartedCount = rosterList.filter(r => r.status === 'not_started').length

  function formatTime(timestamp) {
    if (!timestamp) return '-'
    const d = new Date(Number(timestamp))
    return d.toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' })
  }

  function getDurationText(seconds) {
    if (!seconds) return '-'
    const mins = Math.floor(seconds / 60)
    if (mins < 60) return `${mins} دقيقة`
    const hrs = Math.floor(mins / 60)
    const remMins = mins % 60
    return `${hrs} س ${remMins} د`
  }

  function getLiveElapsed(startedAt) {
    if (!startedAt) return '-'
    const elapsedSec = Math.max(0, Math.floor((Date.now() - Number(startedAt)) / 1000))
    return getDurationText(elapsedSec)
  }

  return (
    <div className="page" style={{ padding: '16px', maxWidth: 960, margin: '0 auto', direction: 'rtl' }}>
      {/* TOP BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <button
            onClick={() => nav('/teams')}
            style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', fontSize: '0.85rem', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="chevronRight" /> العودة للفرق
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--label)' }}>
              لوحة المتابعة الحية
            </h1>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(52, 199, 89, 0.12)',
              color: '#34c759',
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 20,
              border: '1px solid rgba(52, 199, 89, 0.3)'
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34c759', display: 'inline-block' }} />
              مباشر
            </span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--label-2)', marginTop: 4 }}>
            رصد فوري لحضور المتدربين والتمارين المنجزة والأوزان المسجلة
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {board.teams && board.teams.length > 0 && (
            <select
              value={selectedTeam}
              onChange={e => setSelectedTeam(e.target.value)}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                background: 'var(--surface-2)',
                color: 'var(--label)',
                border: '1px solid var(--sep-op)',
                fontSize: '0.85rem'
              }}
            >
              <option value="">كافة الفرق</option>
              {board.teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => { setLoading(true); fetchBoard(); }}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              background: 'var(--surface-2)',
              color: 'var(--label)',
              border: '1px solid var(--sep-op)',
              cursor: 'pointer',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Icon name="refresh" />
            تحديث
          </button>
        </div>
      </div>

      {/* METRIC COUNTERS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        <div
          onClick={() => setActiveTab('all')}
          style={{
            background: activeTab === 'all' ? 'var(--surface-2)' : 'var(--surface)',
            border: activeTab === 'all' ? '1px solid var(--acc)' : '1px solid var(--sep-op)',
            padding: '12px 14px', borderRadius: 12, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--label)' }}>
            {rosterList.length}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 2 }}>
            إجمالي المشتركين
          </div>
        </div>

        <div
          onClick={() => setActiveTab('active')}
          style={{
            background: activeTab === 'active' ? 'var(--surface-2)' : 'var(--surface)',
            border: activeTab === 'active' ? '1px solid #34c759' : '1px solid var(--sep-op)',
            padding: '12px 14px', borderRadius: 12, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#34c759' }}>
            {inProgressCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 2 }}>
            يتدربون الآن
          </div>
        </div>

        <div
          onClick={() => setActiveTab('completed')}
          style={{
            background: activeTab === 'completed' ? 'var(--surface-2)' : 'var(--surface)',
            border: activeTab === 'completed' ? '1px solid var(--acc)' : '1px solid var(--sep-op)',
            padding: '12px 14px', borderRadius: 12, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--acc)' }}>
            {completedCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 2 }}>
            أكملوا الحصة
          </div>
        </div>

        <div
          onClick={() => setActiveTab('missed')}
          style={{
            background: activeTab === 'missed' ? 'var(--surface-2)' : 'var(--surface)',
            border: activeTab === 'missed' ? '1px solid var(--orange)' : '1px solid var(--sep-op)',
            padding: '12px 14px', borderRadius: 12, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--orange)' }}>
            {notStartedCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 2 }}>
            لم يدخلوا بعد
          </div>
        </div>
      </div>

      {/* DRAWN ATTENDANCE & TRACKING TABLE */}
      <div style={{
        background: 'var(--surface)',
        borderRadius: 14,
        border: '1px solid var(--sep-op)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--sep-op)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--surface-2)'
        }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--label)' }}>
            جدول متابعة الحضور والنشاط اليومي
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--label-2)' }}>
            {filteredRoster.length} مشترك مسجل
          </span>
        </div>

        {filteredRoster.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--label-2)' }}>
            لا يوجد متدربون مسجلون ضمن هذا التصنيف
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--sep-op)', color: 'var(--label-2)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>المتدرب</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>الفريق</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>الحالة</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>التوقيت</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>النشاط الحالي</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>الحجم المسجل</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'center' }}>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoster.map(row => {
                  const isActive = row.status === 'in_progress'
                  const isDone = row.status === 'completed'
                  const isNotStarted = row.status === 'not_started'

                  return (
                    <tr
                      key={row.uid}
                      style={{
                        borderBottom: '1px solid var(--sep-op)',
                        background: isActive ? 'rgba(52, 199, 89, 0.03)' : 'transparent',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      {/* TRAINEE INFO */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 34,
                            height: 34,
                            borderRadius: '50%',
                            background: isActive ? 'rgba(52, 199, 89, 0.15)' : 'var(--surface-2)',
                            color: isActive ? '#34c759' : 'var(--label)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.85rem'
                          }}>
                            {(row.display_name || row.uid).slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--label)' }}>
                              {row.display_name || row.uid}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>
                              {row.primary_goal || 'اللياقة العامة'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* TEAM */}
                      <td style={{ padding: '12px 16px', color: 'var(--label-2)' }}>
                        {row.team_name || '-'}
                      </td>

                      {/* STATUS BADGE */}
                      <td style={{ padding: '12px 16px' }}>
                        {isActive && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'rgba(52, 199, 89, 0.12)',
                            color: '#34c759',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 12
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34c759' }} />
                            يتدرب الآن
                          </span>
                        )}
                        {isDone && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'rgba(10, 132, 255, 0.12)',
                            color: 'var(--acc)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 12
                          }}>
                            أكمل الحصة
                          </span>
                        )}
                        {isNotStarted && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'rgba(255, 159, 10, 0.12)',
                            color: 'var(--orange)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 12
                          }}>
                            لم يبدأ اليوم
                          </span>
                        )}
                      </td>

                      {/* TIME / DURATION */}
                      <td style={{ padding: '12px 16px', color: 'var(--label)' }}>
                        {isActive && (
                          <div>
                            <div>{formatTime(row.started_at)}</div>
                            <div style={{ fontSize: '0.72rem', color: '#34c759' }}>
                              مدة: {getLiveElapsed(row.started_at)}
                            </div>
                          </div>
                        )}
                        {isDone && (
                          <div>
                            <div>{formatTime(row.finished_at)}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--label-2)' }}>
                              المدة: {getDurationText(row.duration_seconds)}
                            </div>
                          </div>
                        )}
                        {isNotStarted && (
                          <span style={{ color: 'var(--label-3)' }}>-</span>
                        )}
                      </td>

                      {/* CURRENT EXERCISE & SETS */}
                      <td style={{ padding: '12px 16px' }}>
                        {isActive && (
                          <div>
                            <div style={{ fontWeight: 500, color: 'var(--label)' }}>
                              {row.current_exercise || row.routine_name || 'تمرين جارٍ'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--label-2)', marginTop: 2 }}>
                              المجموعات: {row.sets_done || 0} من {row.total_sets || 0}
                            </div>
                            {row.total_sets > 0 && (
                              <div style={{ width: 100, height: 4, background: 'var(--surface-3)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                                <div style={{
                                  width: `${Math.min(100, Math.round(((row.sets_done || 0) / row.total_sets) * 100))}%`,
                                  height: '100%',
                                  background: '#34c759'
                                }} />
                              </div>
                            )}
                          </div>
                        )}
                        {isDone && (
                          <div>
                            <div style={{ fontWeight: 500, color: 'var(--label)' }}>
                              {row.routine_name || 'حصة تدريبية'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>
                              {row.sets_done || 0} مجموعات منجزة
                            </div>
                          </div>
                        )}
                        {isNotStarted && (
                          <span style={{ color: 'var(--label-3)' }}>في انتظار البدء</span>
                        )}
                      </td>

                      {/* TOTAL VOLUME */}
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--label)' }}>
                        {row.total_volume_kg ? `${row.total_volume_kg} كجم` : '-'}
                      </td>

                      {/* ACTION */}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        {isDone && (
                          <button
                            onClick={() => {
                              setReviewWorkout(row)
                              setReviewComment(row.coach_comment || '')
                              setReviewRating(row.coach_rating || 5)
                            }}
                            style={{
                              padding: '5px 12px',
                              borderRadius: 6,
                              background: row.coach_comment ? 'var(--surface-3)' : 'var(--acc)',
                              color: row.coach_comment ? 'var(--label)' : '#fff',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: 600
                            }}
                          >
                            {row.coach_comment ? 'تعديل التقييم' : 'تقييم الحصة'}
                          </button>
                        )}
                        {isActive && (
                          <span style={{ fontSize: '0.75rem', color: '#34c759', fontWeight: 500 }}>
                            مباشر الآن
                          </span>
                        )}
                        {isNotStarted && (
                          <button
                            onClick={() => nav(`/chat?type=trainee&id=${row.uid}`)}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              background: 'var(--surface-2)',
                              color: 'var(--label-2)',
                              border: '1px solid var(--sep-op)',
                              cursor: 'pointer',
                              fontSize: '0.75rem'
                            }}
                          >
                            تواصل
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* REVIEW MODAL */}
      {reviewWorkout && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: 'var(--surface)', padding: 20, borderRadius: 14,
            maxWidth: 480, width: '100%', border: '1px solid var(--sep-op)', direction: 'rtl'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--label)' }}>
                تقييم أداء المتدرب ({reviewWorkout.display_name || reviewWorkout.uid})
              </h3>
              <button onClick={() => setReviewWorkout(null)} style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <form onSubmit={handleSubmitReview}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  درجة التقييم (1 إلى 5):
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewRating(star)}
                      style={{
                        padding: '6px 14px', borderRadius: 8,
                        background: reviewRating >= star ? 'var(--acc)' : 'var(--surface-2)',
                        color: reviewRating >= star ? '#fff' : 'var(--label)',
                        border: '1px solid var(--sep-op)', cursor: 'pointer', fontWeight: 600
                      }}
                    >
                      {star}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  ملاحظات المدرب وتصحيح التكنيك:
                </label>
                <textarea
                  value={reviewComment}
                  onChange={e => setReviewComment(e.target.value)}
                  placeholder="اكتب ملاحظاتك على الجولات، الوزن، والتركيز على العضلة المستهدفة..."
                  rows={3}
                  required
                  style={{
                    width: '100%', padding: '10px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--sep-op)',
                    color: 'var(--label)', fontSize: '0.85rem', resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>
                  رابط فيديو توضيحي للمتدرب (اختياري):
                </label>
                <input
                  type="url"
                  value={videoFeedbackUrl}
                  onChange={e => setVideoFeedbackUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
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
                  onClick={() => setReviewWorkout(null)}
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
                  إرسال التقييم
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
