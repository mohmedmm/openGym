import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'

export default function SuperAdmin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMetrics()
  }, [])

  async function fetchMetrics() {
    try {
      const res = await fetch('/api/superadmin/metrics')
      if (res.ok) {
        const data = await res.json()
        setMetrics(data.metrics)
      }
    } catch (e) {
      console.warn('Superadmin fetch failed:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page" style={{ padding: '16px', maxWidth: 840, margin: '0 auto', direction: 'rtl' }}>
      <button
        onClick={() => nav('/home')}
        style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: 12 }}
      >
        ← العودة للرئيسية
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: 'var(--label)' }}>
            لوحة الإدارة العامة للمنصة 🛡️
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            نطاق الخدمة: <b>https://gym.nbox.ly</b> • رصد شامل للحسابات، الفرق، وأداء النظام
          </div>
        </div>
        <span style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--green)', fontSize: '0.85rem', fontWeight: 700 }}>
          {metrics?.storage_engine || 'PostgreSQL'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
        <div className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 14, border: '1px solid var(--sep-op)', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--label)' }}>{metrics?.total_profiles || 0}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>إجمالي المشتركين</div>
        </div>

        <div className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 14, border: '1px solid var(--sep-op)', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--acc)' }}>{metrics?.total_coaches || 0}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>عدد المدربين</div>
        </div>

        <div className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 14, border: '1px solid var(--sep-op)', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--blue)' }}>{metrics?.total_teams || 0}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>الفرق والمجموعات</div>
        </div>

        <div className="card" style={{ background: 'var(--surface)', padding: 18, borderRadius: 14, border: '1px solid var(--sep-op)', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--green)' }}>{metrics?.total_workouts_logged || 0}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>الحصص المكتملة</div>
        </div>
      </div>

      <div className="card" style={{ background: 'var(--surface)', padding: 20, borderRadius: 16, border: '1px solid var(--sep-op)' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: 'var(--label)' }}>
          ⚙️ إعدادات النشر وعزل الاستضافة
        </h3>
        <ul style={{ margin: 0, paddingRight: 20, fontSize: '0.85rem', color: 'var(--label-2)', lineHeight: 1.8 }}>
          <li><b>النطاق:</b> https://gym.nbox.ly (SSL Let's Encrypt نشط وآمن).</li>
          <li><b>عزل المنفذ:</b> الخادم يعمل على منفذ داخلي مخصص <code>5080</code> دون أي تضارب مع مشاريع nbox.ly الأخرى.</li>
          <li><b>قاعدة البيانات:</b> حاوية PostgreSQL مستقلة مع شبكة Docker معزولة <code>gym_net</code>.</li>
          <li><b>الوسائط:</b> جلب خارجي CDN / Raw دون تخزين وسائط ضخمة ترهق مساحة السيرفر.</li>
          <li><b>PWA:</b> دعم التثبيت على الهاتف والكمبيوتر والعمل دون اتصال بالإنترنت.</li>
        </ul>
      </div>
    </div>
  )
}
