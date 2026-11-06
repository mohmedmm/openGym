import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

export default function TeamChat() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const targetType = params.get('type') || 'team'
  const targetId = params.get('id') || 'general'
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)

  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    fetchMessages()
    const timer = setInterval(fetchMessages, 5000) // poll every 5s
    return () => clearInterval(timer)
  }, [targetType, targetId])

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/chat?type=${targetType}&id=${targetId}`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      }
    } catch (e) {
      console.warn('Chat fetch error:', e)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    if (!inputText.trim()) return
    const text = inputText.trim()
    setInputText('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          message: text
        })
      })
      if (res.ok) {
        fetchMessages()
      } else {
        toast('فشل إرسال الرسالة')
      }
    } catch (e) {
      toast('حدث خطأ في الاتصال')
    }
  }

  return (
    <div className="page" style={{ padding: '16px', maxWidth: 760, margin: '0 auto', direction: 'rtl', height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <button
            onClick={() => nav('/teams')}
            style={{ background: 'transparent', border: 'none', color: 'var(--label-2)', cursor: 'pointer', fontSize: '0.9rem', marginBottom: 4 }}
          >
            ← العودة للفرق
          </button>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--label)' }}>
            {targetType === 'team' ? '💬 محادثة الفريق' : '👤 محادثة خاصة مع المدرب'}
          </h2>
        </div>
        <span style={{ fontSize: '0.8rem', color: 'var(--label-2)', background: 'var(--surface-2)', padding: '4px 10px', borderRadius: 8 }}>
          متصل 🟢
        </span>
      </div>

      {/* MESSAGES LIST */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--surface)', borderRadius: 16, padding: 16, border: '1px solid var(--sep-op)', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {messages.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--label-2)', fontSize: '0.9rem' }}>
            لا توجد رسائل سابقة. ابدأ المحادثة الآن!
          </div>
        ) : (
          messages.map(m => {
            const isMe = m.sender_uid === user?.id
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: isMe ? 'flex-start' : 'flex-end',
                  maxWidth: '75%',
                  background: isMe ? 'var(--acc)' : 'var(--surface-2)',
                  color: isMe ? 'var(--on-acc)' : 'var(--label)',
                  padding: '10px 14px',
                  borderRadius: 14,
                  fontSize: '0.9rem',
                  lineHeight: 1.4
                }}
              >
                {!isMe && (
                  <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 2, fontWeight: 700 }}>
                    {m.sender_uid}
                  </div>
                )}
                <div>{m.message}</div>
                <div style={{ fontSize: '0.7rem', opacity: 0.7, textAlign: 'left', marginTop: 4 }}>
                  {new Date(m.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* INPUT FORM */}
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="اكتب رسالتك للمجموعة أو المدرب..."
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          style={{ flex: 1, padding: '12px 16px', borderRadius: 12, background: 'var(--surface-2)', color: 'var(--label)', border: '1px solid var(--sep-op)', fontSize: '0.95rem' }}
        />
        <button
          type="submit"
          style={{ background: 'var(--acc)', color: 'var(--on-acc)', border: 'none', padding: '0 22px', borderRadius: 12, fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem' }}
        >
          إرسال
        </button>
      </form>
    </div>
  )
}
