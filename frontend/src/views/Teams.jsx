import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function Teams() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  // Current active mode: 'independent' | 'coach' | 'trainee'
  const [mode, setMode] = useState('independent')
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState({
    primary_goal: 'General Fitness',
    current_weight: '',
    target_weight: '',
    experience_level: 'Beginner',
    days_per_week: 3,
    session_duration_mins: 60,
    available_equipment: ['Dumbbell', 'Barbell']
  })

  // Modals
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [newTeam, setNewTeam] = useState({ name: '', description: '', days: ['الأحد', 'الثلاثاء', 'الخميس'], time: '17:00' })
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [inviteCodeInput, setInviteCodeInput] = useState('')
  const [activeQrTeam, setActiveQrTeam] = useState(null)

  useEffect(() => {
    loadProfileAndTeams()
  }, [])

  async function loadProfileAndTeams() {
    setLoading(true)
    try {
      const pRes = await fetch('/api/profile')
      if (pRes.ok) {
        const pData = await pRes.json()
        if (pData.profile) setProfile(prev => ({ ...prev, ...pData.profile }))
      }

      const tRes = await fetch('/api/teams')
      if (tRes.ok) {
        const tData = await tRes.json()
        setTeams(tData.teams || [])
        // auto-select mode if user is already a coach
        if (tData.teams?.some(t => t.user_role === 'coach')) {
          setMode('coach')
        } else if (tData.teams?.length > 0) {
          setMode('trainee')
        }
      }
    } catch (e) {
      console.warn('Network offline or demo mode:', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveProfile() {
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      })
      if (res.ok) toast('تم حفظ أهدافك الرياضية بنجاح')
    } catch (e) {
      toast('تم حفظ الهدف محلياً')
    }
  }

  async function handleCreateTeam(e) {
    e.preventDefault()
    if (!newTeam.name.trim()) return
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTeam.name,
          description: newTeam.description,
          schedule_json: { days: newTeam.days, time: newTeam.time }
        })
      })
      if (res.ok) {
        const data = await res.json()
        toast('تم إنشاء الفريق بنجاح')
        setShowCreateTeam(false)
        setNewTeam({ name: '', description: '', days: ['الأحد', 'الثلاثاء', 'الخميس'], time: '17:00' })
        loadProfileAndTeams()
      } else {
        toast('فشل إنشاء الفريق')
      }
    } catch (e) {
      toast('حدث خطأ في الاتصال')
    }
  }

  async function handleJoinTeam(e) {
    e.preventDefault()
    if (!inviteCodeInput.trim()) return
    try {
      const res = await fetch('/api/teams/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteCodeInput.trim() })
      })
      const data = await res.json()
      if (res.ok) {
        toast(data.already_member ? 'أنت عضو في هذا الفريق بالفعل' : 'تم الانضمام إلى الفريق بنجاح!')
        setShowJoinModal(false)
        setInviteCodeInput('')
        loadProfileAndTeams()
      } else {
        toast(data.error || 'رمز الدعوة غير صحيح')
      }
    } catch (e) {
      toast('حدث خطأ أثناء الانضمام')
    }
  }

  const coachedTeams = teams.filter(t => t.user_role === 'coach' || t.head_coach_uid === user?.id)
  const joinedTeams = teams.filter(t => t.user_role === 'trainee')

  return (
    <div className="page" style={{ padding: '16px', maxWidth: 840, margin: '0 auto', direction: 'rtl' }}>
      {/* HEADER & BRAND */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: 'var(--label)' }}>
            منظومة التدريب الرياضي
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            gym.nbox.ly — مرونة كاملة للأفراد، المدربين، والمجموعات
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => nav('/coach/live')}
            className="btn-glass"
            style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--acc)', border: '1px solid var(--acc-line)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }}></span>
            المتابعة الحية
          </button>
        </div>
      </div>

      {/* 3-WAY FLEXIBLE ROLE SWITCHER */}
      <div style={{ display: 'flex', background: 'var(--surface-2)', padding: 4, borderRadius: 12, marginBottom: 24 }}>
        <button
          onClick={() => setMode('independent')}
          style={{
            flex: 1, padding: '10px 8px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: mode === 'independent' ? 'var(--surface)' : 'transparent',
            color: mode === 'independent' ? 'var(--label)' : 'var(--label-2)',
            fontWeight: mode === 'independent' ? 700 : 500,
            transition: 'all 0.15s ease'
          }}
        >
          متدرب مستقل
        </button>
        <button
          onClick={() => setMode('coach')}
          style={{
            flex: 1, padding: '10px 8px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: mode === 'coach' ? 'var(--surface)' : 'transparent',
            color: mode === 'coach' ? 'var(--acc)' : 'var(--label-2)',
            fontWeight: mode === 'coach' ? 700 : 500,
            transition: 'all 0.15s ease'
          }}
        >
          مدرب الفرق ({coachedTeams.length})
        </button>
        <button
          onClick={() => setMode('trainee')}
          style={{
            flex: 1, padding: '10px 8px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: mode === 'trainee' ? 'var(--surface)' : 'transparent',
            color: mode === 'trainee' ? 'var(--label)' : 'var(--label-2)',
            fontWeight: mode === 'trainee' ? 700 : 500,
            transition: 'all 0.15s ease'
          }}
        >
          متدرب ضمن فريق ({joinedTeams.length})
        </button>
      </div>

      {/* MODE 1: INDEPENDENT USER */}
      {mode === 'independent' && (
        <div>
          <div className="card" style={{ background: 'var(--surface)', padding: 20, borderRadius: 16, border: '1px solid var(--sep-op)', marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '1.2rem', color: 'var(--label)' }}>
              الملف الرياضي الشخصي والأهداف
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--label-2)', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              حدد هدفك ومستواك والمعدات المتوفرة لديك لتكييف البرامج والتمارين البديلة وفق قدراتك دون فرض أي التزام خارجي.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>الهدف الأساسي</label>
                <select
                  value={profile.primary_goal}
                  onChange={e => setProfile({ ...profile, primary_goal: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.95rem' }}
                >
                  <option value="Weight Loss">خسارة دهون (Weight Loss)</option>
                  <option value="Muscle Gain">زيادة كتلة عضلية (Muscle Gain)</option>
                  <option value="Strength">زيادة القوة البدنية (Strength)</option>
                  <option value="Maintenance">المحافظة على اللياقة (Maintenance)</option>
                  <option value="Endurance">التحمل واللياقة القلبية (Endurance)</option>
                  <option value="Body Recomposition">إعادة تشكيل الجسم (Body Recomposition)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>مستوى الخبرة</label>
                <select
                  value={profile.experience_level}
                  onChange={e => setProfile({ ...profile, experience_level: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.95rem' }}
                >
                  <option value="Beginner">مبتدئ (Beginner)</option>
                  <option value="Intermediate">متوسط (Intermediate)</option>
                  <option value="Advanced">متقدم (Advanced)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>الوزن الحالي (كغ)</label>
                <input
                  type="number"
                  step="0.1"
                  value={profile.current_weight || ''}
                  onChange={e => setProfile({ ...profile, current_weight: parseFloat(e.target.value) || '' })}
                  placeholder="مثلاً: 82.5"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.95rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>الوزن المستهدف (كغ)</label>
                <input
                  type="number"
                  step="0.1"
                  value={profile.target_weight || ''}
                  onChange={e => setProfile({ ...profile, target_weight: parseFloat(e.target.value) || '' })}
                  placeholder="مثلاً: 75.0"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.95rem' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={handleSaveProfile}
                style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '10px 24px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}
              >
                حفظ بيانات الملف الرياضي
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            <div className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 16, border: '1px solid var(--sep-op)' }}>
              <h4 style={{ margin: '0 0 8px 0', color: 'var(--label)' }}>خطة التدريب الشخصية</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--label-2)', margin: '0 0 14px 0' }}>أنشئ روتينك الخاص، حدد أيامك، واختر من مكتبة التمارين المفتوحة (5,600+ تمرين).</p>
              <button onClick={() => nav('/plan')} style={{ width: '100%', padding: '10px', borderRadius: 9, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer' }}>
                فتح جدول الروتين الشخصي
              </button>
            </div>

            <div className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 16, border: '1px solid var(--sep-op)' }}>
              <h4 style={{ margin: '0 0 8px 0', color: 'var(--label)' }}>التغذية ومتابعة التقدم</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--label-2)', margin: '0 0 14px 0' }}>سجل السعرات والماكروز وشرب الماء والنوم وراقب تطور وزنك أسبوعياً.</p>
              <button onClick={() => nav('/nutrition')} style={{ width: '100%', padding: '10px', borderRadius: 9, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer' }}>
                فتح سجل التغذية والقياسات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: COACH HUB */}
      {mode === 'coach' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--label)' }}>الفرق والمجموعات التدريبية</h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--label-2)' }}>إدارة المجموعات، البرامج الجماعية مع التخصيص الفردي</span>
            </div>
            <button
              onClick={() => setShowCreateTeam(true)}
              style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '10px 18px', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              + إنشاء فريق جديد
            </button>
          </div>

          {coachedTeams.length === 0 ? (
            <div className="card" style={{ background: 'var(--surface)', padding: 32, borderRadius: 16, textAlign: 'center', border: '1px dashed var(--sep)' }}>
              <div style={{ width: 48, height: 48, margin: '0 auto 12px', borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <h4 style={{ margin: '0 0 8px 0', color: 'var(--label)' }}>لم تقم بإنشاء أي فريق بعد</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--label-2)', margin: '0 0 16px 0' }}>
                يمكنك إنشاء فريق جديد باسم (مثل: Team Alpha أو أبطال التضخيم) ودعوة المتدربين عبر رابط مباشر أو رمز QR.
              </p>
              <button onClick={() => setShowCreateTeam(true)} style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '10px 20px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
                ابدأ بإنشاء فريقك الأول
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {coachedTeams.map(team => (
                <div key={team.id} className="card" style={{ background: 'var(--surface)', padding: 20, borderRadius: 16, border: '1px solid var(--sep-op)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <h4 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--label)' }}>{team.name}</h4>
                        <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--acc)', border: '1px solid var(--acc-line)' }}>
                          مدرب رئيسي
                        </span>
                      </div>
                      <p style={{ margin: '6px 0 0 0', fontSize: '0.85rem', color: 'var(--label-2)' }}>
                        {team.description || 'لا يوجد وصف للفريق'}
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        onClick={() => {
                          const link = `${window.location.origin}/#/join/${team.invite_code}`
                          navigator.clipboard?.writeText(link)
                          toast('تم نسخ رابط دعوة الفريق!')
                        }}
                        style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        نسخ الرابط
                      </button>
                      <button
                        onClick={() => setActiveQrTeam(activeQrTeam?.id === team.id ? null : team)}
                        style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        رمز QR ({team.invite_code})
                      </button>
                    </div>
                  </div>

                  {/* QR Code toggle */}
                  {activeQrTeam?.id === team.id && (
                    <div style={{ margin: '16px 0', padding: 16, background: 'var(--surface-2)', borderRadius: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: '0.9rem', color: 'var(--label)', marginBottom: 8 }}>
                        امسح رمز QR أو استخدم كود الدعوة للانضمام فوراً:
                      </div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: 4, color: 'var(--acc)', margin: '8px 0' }}>
                        {team.invite_code}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--label-2)' }}>
                        رابط الانضمام: {window.location.origin}/#/join/{team.invite_code}
                      </div>
                    </div>
                  )}

                  <hr style={{ border: 'none', borderTop: '1px solid var(--sep-op)', margin: '16px 0' }} />

                  {/* Actions Bar */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => nav(`/teams/plan?teamId=${team.id}`)}
                      style={{ flex: 1, minWidth: 160, padding: '10px 14px', borderRadius: 10, background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                    >
                      إدارة البرنامج والتخصيص الفردي
                    </button>
                    <button
                      onClick={() => { localStorage.setItem('gym_plan_view', 'team_schedule'); nav('/plan'); }}
                      style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      جدول الفريق
                    </button>
                    <button
                      onClick={() => nav(`/coach/live?teamId=${team.id}`)}
                      style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.5s infinite' }} />
                      المتابعة الحية
                    </button>
                    <button
                      onClick={() => nav(`/chat?type=team&id=${team.id}`)}
                      style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      شات الفريق
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODE 3: TRAINEE IN TEAM */}
      {mode === 'trainee' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, color: 'var(--label)' }}>الفرق التي انضممت إليها</h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--label-2)' }}>تتدرب مع مجموعتك وتحصل على برنامجك المخصص</span>
            </div>
            <button
              onClick={() => setShowJoinModal(true)}
              style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '10px 18px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}
            >
              + انضمام برمز الدعوة
            </button>
          </div>

          {joinedTeams.length === 0 ? (
            <div className="card" style={{ background: 'var(--surface)', padding: 32, borderRadius: 16, textAlign: 'center', border: '1px dashed var(--sep)' }}>
              <div style={{ width: 48, height: 48, margin: '0 auto 12px', borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <h4 style={{ margin: '0 0 8px 0', color: 'var(--label)' }}>لست عضواً في أي فريق حالياً</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--label-2)', margin: '0 0 16px 0' }}>
                اطلب رمز الدعوة أو رابط QR من مدربك للانضمام فوراً واستلام برنامجك المخصص.
              </p>
              <button onClick={() => setShowJoinModal(true)} style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '10px 20px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
                أدخل رمز الدعوة
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {joinedTeams.map(team => (
                <div key={team.id} className="card" style={{ background: 'var(--surface)', padding: 20, borderRadius: 16, border: '1px solid var(--sep-op)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--label)' }}>{team.name}</h4>
                      <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--label-2)' }}>
                        {team.description || 'فريق تدريبي مشترك'}
                      </p>
                    </div>
                    <span style={{ padding: '4px 10px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--green)', fontSize: '0.8rem', fontWeight: 600 }}>
                      عضو متدرب
                    </span>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--sep-op)', margin: '14px 0' }} />

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => nav('/workout')}
                      style={{ flex: 1, minWidth: 160, padding: '10px 14px', borderRadius: 10, background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                    >
                      بدء تمرين اليوم المخصص لي
                    </button>
                    <button
                      onClick={() => { localStorage.setItem('gym_plan_view', 'team_schedule'); nav('/plan'); }}
                      style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      جدول الفريق
                    </button>
                    <button
                      onClick={() => nav(`/chat?type=team&id=${team.id}`)}
                      style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      محادثة المجموعة
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: CREATE TEAM */}
      {showCreateTeam && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--surface)', width: '100%', maxWidth: 460, borderRadius: 16, padding: 24, border: '1px solid var(--sep-op)' }}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--label)' }}>إنشاء فريق تدريبي جديد</h3>
            <form onSubmit={handleCreateTeam}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>اسم الفريق</label>
                <input
                  type="text"
                  required
                  placeholder="مثلاً: Team Power أو أبطال التنشيف"
                  value={newTeam.name}
                  onChange={e => setNewTeam({ ...newTeam, name: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--label-2)', marginBottom: 6 }}>الوصف والهدف</label>
                <textarea
                  rows={2}
                  placeholder="وصف مختصر لمستوى الفريق وهدفه"
                  value={newTeam.description}
                  onChange={e => setNewTeam({ ...newTeam, description: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateTeam(false)}
                  style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', color: 'var(--label-2)', border: 'none', cursor: 'pointer' }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                >
                  تأكيد وإنشاء الفريق
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: JOIN TEAM VIA CODE */}
      {showJoinModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'var(--surface)', width: '100%', maxWidth: 400, borderRadius: 16, padding: 24, border: '1px solid var(--sep-op)' }}>
            <h3 style={{ margin: '0 0 12px 0', color: 'var(--label)' }}>الانضمام إلى فريق تدريبي</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--label-2)', margin: '0 0 16px 0' }}>أدخل رمز الدعوة المكون من 6 خانات الذي أرسله لك المدرب:</p>
            <form onSubmit={handleJoinTeam}>
              <input
                type="text"
                required
                maxLength={10}
                placeholder="مثلاً: A4B9X2"
                value={inviteCodeInput}
                onChange={e => setInviteCodeInput(e.target.value.toUpperCase())}
                style={{ width: '100%', padding: '12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--acc)', fontSize: '1.4rem', fontWeight: 800, textAlign: 'center', letterSpacing: 4, border: '1px solid var(--acc-line)', marginBottom: 16 }}
              />

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', color: 'var(--label-2)', border: 'none', cursor: 'pointer' }}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', fontWeight: 700, cursor: 'pointer' }}
                >
                  انضمام الآن
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

