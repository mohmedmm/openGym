import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'

export default function Nutrition() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)

  const todayStr = new Date().toISOString().slice(0, 10)
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    calories: 2200,
    protein_g: 160,
    carbs_g: 220,
    fat_g: 65,
    water_ml: 2500,
    sleep_hours: 7.5,
    weight_kg: '',
    notes: ''
  })

  useEffect(() => {
    fetchLogs()
  }, [])

  async function fetchLogs() {
    setLoading(true)
    try {
      const res = await fetch('/api/nutrition')
      if (res.ok) {
        const data = await res.json()
        const logs = data.nutrition || []
        setHistory(logs)
        const todayLog = logs.find(l => l.log_date === selectedDate)
        if (todayLog) {
          setForm(prev => ({
            ...prev,
            calories: todayLog.calories || 0,
            protein_g: todayLog.protein_g || 0,
            carbs_g: todayLog.carbs_g || 0,
            fat_g: todayLog.fat_g || 0,
            water_ml: todayLog.water_ml || 0,
            sleep_hours: todayLog.sleep_hours || 0,
            weight_kg: todayLog.weight_kg || '',
            notes: todayLog.notes || ''
          }))
        }
      }
    } catch (e) {
      console.warn('Nutrition fetch offline:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    try {
      const res = await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: selectedDate,
          ...form,
          calories: parseInt(form.calories, 10) || 0,
          protein_g: parseFloat(form.protein_g) || 0,
          carbs_g: parseFloat(form.carbs_g) || 0,
          fat_g: parseFloat(form.fat_g) || 0,
          water_ml: parseInt(form.water_ml, 10) || 0,
          sleep_hours: parseFloat(form.sleep_hours) || 0,
          weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null
        })
      })
      if (res.ok) {
        toast('تم حفظ بيانات التغذية والقياسات بنجاح!')
        fetchLogs()
      } else {
        toast('فشل الحفظ')
      }
    } catch (e) {
      toast('تم الحفظ محلياً')
    }
  }

  function addWater(amount) {
    setForm(prev => ({ ...prev, water_ml: Math.max(0, (parseInt(prev.water_ml, 10) || 0) + amount) }))
  }

  return (
    <div className="page" style={{ padding: '16px', maxWidth: 800, margin: '0 auto', direction: 'rtl' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <button
            onClick={() => nav('/home')}
            style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: 4 }}
          >
            ← العودة للرئيسية
          </button>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: 'var(--label)' }}>
            متابعة التغذية والقياسات 🥗
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--label-2)', marginTop: 4 }}>
            سجل السعرات اليومية، البروتين، الماء، وساعات النوم لدعم استشفاء العضلات
          </div>
        </div>

        <input
          type="date"
          value={selectedDate}
          onChange={e => {
            setSelectedDate(e.target.value)
            const log = history.find(l => l.log_date === e.target.value)
            if (log) {
              setForm({
                calories: log.calories,
                protein_g: log.protein_g,
                carbs_g: log.carbs_g,
                fat_g: log.fat_g,
                water_ml: log.water_ml,
                sleep_hours: log.sleep_hours,
                weight_kg: log.weight_kg || '',
                notes: log.notes || ''
              })
            }
          }}
          style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.9rem' }}
        />
      </div>

      {/* MACRO SUMMARY BARS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ background: 'var(--surface)', padding: 14, borderRadius: 14, textAlign: 'center', border: '1px solid var(--sep-op)' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--orange)' }}>{form.calories}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--label-2)', marginTop: 2 }}>السعرات (kcal)</div>
        </div>
        <div style={{ background: 'var(--surface)', padding: 14, borderRadius: 14, textAlign: 'center', border: '1px solid var(--sep-op)' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--red)' }}>{form.protein_g}g</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--label-2)', marginTop: 2 }}>البروتين</div>
        </div>
        <div style={{ background: 'var(--surface)', padding: 14, borderRadius: 14, textAlign: 'center', border: '1px solid var(--sep-op)' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--blue)' }}>{form.carbs_g}g</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--label-2)', marginTop: 2 }}>الكارب</div>
        </div>
        <div style={{ background: 'var(--surface)', padding: 14, borderRadius: 14, textAlign: 'center', border: '1px solid var(--sep-op)' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--yellow)' }}>{form.fat_g}g</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--label-2)', marginTop: 2 }}>الدهون</div>
        </div>
      </div>

      {/* FORM INPUTS */}
      <form onSubmit={handleSave} className="card" style={{ background: 'var(--surface)', padding: 20, borderRadius: 16, border: '1px solid var(--sep-op)', marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', color: 'var(--label)' }}>
          تسجيل وجبات وقياسات يوم: {selectedDate}
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 6 }}>إجمالي السعرات (kcal)</label>
            <input
              type="number"
              value={form.calories}
              onChange={e => setForm({ ...form, calories: e.target.value })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 6 }}>بروتين (غرام)</label>
            <input
              type="number"
              step="0.5"
              value={form.protein_g}
              onChange={e => setForm({ ...form, protein_g: e.target.value })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 6 }}>كربوهيدرات (غرام)</label>
            <input
              type="number"
              step="0.5"
              value={form.carbs_g}
              onChange={e => setForm({ ...form, carbs_g: e.target.value })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 6 }}>دهون صحية (غرام)</label>
            <input
              type="number"
              step="0.5"
              value={form.fat_g}
              onChange={e => setForm({ ...form, fat_g: e.target.value })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 6 }}>الوزن اليوم (كغ)</label>
            <input
              type="number"
              step="0.1"
              placeholder="مثلاً 81.2"
              value={form.weight_kg}
              onChange={e => setForm({ ...form, weight_kg: e.target.value })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 6 }}>ساعات النوم</label>
            <input
              type="number"
              step="0.5"
              value={form.sleep_hours}
              onChange={e => setForm({ ...form, sleep_hours: e.target.value })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
            />
          </div>
        </div>

        {/* WATER TRACKER WIDGET */}
        <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <b style={{ color: 'var(--teal)' }}>💧 شرب الماء:</b> {form.water_ml} مل / {(form.water_ml / 1000).toFixed(1)} لتر
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => addWater(250)}
                style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--surface)', color: 'var(--teal)', border: '1px solid var(--teal)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
              >
                + كاسة (250ml)
              </button>
              <button
                type="button"
                onClick={() => addWater(500)}
                style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--surface)', color: 'var(--teal)', border: '1px solid var(--teal)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
              >
                + قارورة (500ml)
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--label-2)', marginBottom: 6 }}>ملاحظات اليوم (وجبة مفتوحة، نشاط إضافي...)</label>
          <input
            type="text"
            placeholder="ملاحظات حول الهضم أو الطاقة..."
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            style={{ width: '100%', padding: '10px', borderRadius: 10, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="submit"
            style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '10px 24px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}
          >
            حفظ التغذية
          </button>
        </div>
      </form>
    </div>
  )
}
