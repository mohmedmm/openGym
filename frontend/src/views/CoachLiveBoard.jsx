import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'

export default function CoachLiveBoard() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const teamId = params.get('teamId')
  const toast = useUI(s => s.toast)

  const [activeTab, setActiveTab] = useState('active') // 'active' | 'completed' | 'missed'
  const [board, setBoard] = useState({ in_progress: [], completed: [], missed: [] })
  const [loading, setLoading] = useState(false)

  // Review modal
  const [reviewWorkout, setReviewWorkout] = useState(null)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewRating, setReviewRating] = useState(5)
  const [videoFeedbackUrl, setVideoFeedbackUrl] = useState('')

  useEffect(() => {
    fetchBoard()
    const timer = setInterval(fetchBoard, 15000) // auto-refresh every 15s
    return () => clearInterval(timer)
  }, [])

  async function fetchBoard() {
    setLoading(true)
    try {
      const res = await fetch('/api/coach/live-board')
      if (res.ok) {
        const data = await res.json()
        setBoard(data.liveBoard || { in_progress: [], completed: [], missed: [] })
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
          workout_id: reviewWorkout.id,
          comment: reviewComment,
          rating: reviewRating,
          video_feedback_url: videoFeedbackUrl
        })
      })
      if (res.ok) {
        toast('تم إرسال مراجعة وتوجيهات المدرب بنجاح!')
        setReviewWorkout(null)
        setReviewComment('')
        setVideoFeedbackUrl('')
        fetchBoard()
      } else {
        toast('تعذر حفظ المراجعة')
      }
    } catch (e) {
      toast('خطأ في الاتصال')
    }
  }

  return (
    <div className="page" style={{ padding: '16px', maxWidth: 840, margin: '0 auto', direction: 'rtl' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <button
            onClick={() => nav('/teams')}
            style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            ← العودة للفرق
          </button>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: 'var(--label)' }}>
            لوحة المتابعة الحية للمدرب 🔴
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            رصد لحظي لمن يتدرب الآن، من أكمل الحصة، ومن تغيّب عن جدول اليوم
          </div>
        </div>

        <button
          onClick={fetchBoard}
          style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          {loading ? 'جاري التحديث...' : '🔄 تحديث'}
        </button>
      </div>

      {/* METRIC COUNTERS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div
          onClick={() => setActiveTab('active')}
          style={{
            background: activeTab === 'active' ? 'var(--surface-2)' : 'var(--surface)',
            border: activeTab === 'active' ? '1px solid var(--green)' : '1px solid var(--sep-op)',
            padding: 16, borderRadius: 14, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--green)' }}>
            {board.in_progress?.length || 0}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            🟢 يتدرب الآن
          </div>
        </div>

        <div
          onClick={() => setActiveTab('completed')}
          style={{
            background: activeTab === 'completed' ? 'var(--surface-2)' : 'var(--surface)',
            border: activeTab === 'completed' ? '1px solid var(--acc)' : '1px solid var(--sep-op)',
            padding: 16, borderRadius: 14, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--acc)' }}>
            {board.completed?.length || 0}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            ✅ أكملوا التمرين
          </div>
        </div>

        <div
          onClick={() => setActiveTab('missed')}
          style={{
            background: activeTab === 'missed' ? 'var(--surface-2)' : 'var(--surface)',
            border: activeTab === 'missed' ? '1px solid var(--orange)' : '1px solid var(--sep-op)',
            padding: 16, borderRadius: 14, textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--orange)' }}>
            {board.missed?.length || 0}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            ⚠️ لم يبدأوا بعد
          </div>
        </div>
      </div>

      {/* TAB 1: ACTIVE NOW */}
      {activeTab === 'active' && (
        <div>
          {(!board.in_progress || board.in_progress.length === 0) ? (
            <div className="card" style={{ background: 'var(--surface)', padding: 32, borderRadius: 16, textAlign: 'center', border: '1px dashed var(--sep)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏳</div>
              <h4 style={{ margin: '0 0 6px 0', color: 'var(--label)' }}>لا يوجد متدربون في الصالة حالياً</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--label-2)' }}>بمجرد أن يفتح المتدرب تمرين اليوم ويبدأ تسجيل مجموعاته سيظهر هنا بالوقت الفعلي.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {board.in_progress.map(w => (
                <div key={w.id} className="card" style={{ background: 'var(--surface)', padding: 16, borderRadius: 14, border: '1px solid var(--green)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)' }}></span>
                        <h4 style={{ margin: 0, color: 'var(--label)', fontSize: '1.1rem' }}>{w.uid}</h4>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
                        الروتين: <b>{w.routine_name}</b> • بدأ التدريب منذ {Math.round((Date.now() - (w.started_at || Date.now())) / 60000)} دقيقة
                      </div>
                    </div>
                    <button
                      onClick={() => nav(`/chat?type=direct&id=${w.uid}`)}
                      style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      💬 تشجيع أو تعليمات
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: COMPLETED WORKOUTS */}
      {activeTab === 'completed' && (
        <div>
          {(!board.completed || board.completed.length === 0) ? (
            <div className="card" style={{ background: 'var(--surface)', padding: 32, borderRadius: 16, textAlign: 'center', border: '1px dashed var(--sep)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📋</div>
              <h4 style={{ margin: '0 0 6px 0', color: 'var(--label)' }}>لم يكمل أحد التمرين بعد في آخر 24 ساعة</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--label-2)' }}>ستظهر التمارين المكتملة والأوزان المسجلة بمجرد إنهاء المتدربين لحصصهم.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {board.completed.map(w => (
                <div key={w.id} className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 14, border: '1px solid var(--sep-op)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--green)', fontSize: '1.1rem' }}>✓</span>
                        <h4 style={{ margin: 0, color: 'var(--label)', fontSize: '1.1rem' }}>{w.uid}</h4>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
                        {w.routine_name} • المدة: {Math.round((w.duration_seconds || 0) / 60)} دقيقة
                      </div>
                      {w.notes && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--label)' }}>
                          📝 <b>ملاحظة المتدرب:</b> {w.notes}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setReviewWorkout(w)
                        setReviewComment('')
                      }}
                      style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                    >
                      ⭐ تقييم وإضافة ملاحظات المدرب
                    </button>
                  </div>

                  {w.coach_comment && (
                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--surface-3)', borderRadius: 8, fontSize: '0.85rem', color: 'var(--acc)' }}>
                      💬 <b>مراجعتك السابقة:</b> {w.coach_comment}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MISSED / IDLE TRAINEES */}
      {activeTab === 'missed' && (
        <div>
          {(!board.missed || board.missed.length === 0) ? (
            <div className="card" style={{ background: 'var(--surface)', padding: 32, borderRadius: 16, textAlign: 'center', border: '1px dashed var(--sep)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
              <h4 style={{ margin: '0 0 6px 0', color: 'var(--label)' }}>الجميع ملتزم بالتدريب اليوم!</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--label-2)' }}>لا توجد أي غيابات مسجلة بين المتدربين في فرقك.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {board.missed.map(m => (
                <div key={m.uid} className="card" style={{ background: 'var(--surface)', padding: 16, borderRadius: 14, border: '1px solid var(--sep-op)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0, color: 'var(--label)', fontSize: '1rem' }}>{m.uid}</h4>
                    <div style={{ fontSize: '0.8rem', color: 'var(--label-2)', marginTop: 2 }}>
                      الفريق: {m.team_name} • الهدف: {m.primary_goal || 'لياقة عامة'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      nav(`/chat?type=direct&id=${m.uid}`)
                      toast('فتح محادثة لتذكير المتدرب بموعد الحصة')
                    }}
                    style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--orange)', border: '1px solid var(--orange)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                  >
                    🔔 تذكير المتدرب
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: COACH REVIEW */}
      {reviewWorkout && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--surface)', width: '100%', maxWidth: 480, borderRadius: 16, padding: 24, border: '1px solid var(--sep-op)' }}>
            <h3 style={{ margin: '0 0 12px 0', color: 'var(--label)' }}>تقييم أداء المتدرب: {reviewWorkout.uid}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--label-2)', margin: '0 0 16px 0' }}>
              أضف ملاحظاتك الفنية على الأداء، التكرارات، أو رابط فيديو تصحيح التكنيك:
            </p>

            <form onSubmit={handleSubmitReview}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>التقييم (من 5)</label>
                <select
                  value={reviewRating}
                  onChange={e => setReviewRating(parseInt(e.target.value, 10))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                >
                  <option value={5}>⭐⭐⭐⭐⭐ أداء ممتاز ومثالي</option>
                  <option value={4}>⭐⭐⭐⭐ أداء جيد جداً مع ملاحظات بسيطة</option>
                  <option value={3}>⭐⭐⭐ أداء متوسط يحتاج تركيز على التكنيك</option>
                  <option value={2}>⭐⭐ أوزان زائدة أو عدم اكتمال المدى الحركي</option>
                  <option value={1}>⭐ يحتاج إعادة مراجعة كاملة للتكنيك</option>
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>ملاحظات وتوجيهات المدرب</label>
                <textarea
                  rows={3}
                  required
                  placeholder="مثلاً: تحكم ممتاز في النزول السلبي، احرص في الجلسة القادمة على زيادة الراحة لـ 90 ثانية..."
                  value={reviewComment}
                  onChange={e => setReviewComment(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>رابط فيديو الأداء أو التغذية الراجعة (اختياري)</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={videoFeedbackUrl}
                  onChange={e => setVideoFeedbackUrl(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setReviewWorkout(null)}
                  style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', color: 'var(--label-2)', border: 'none', cursor: 'pointer' }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                >
                  إرسال المراجعة للمتدرب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
