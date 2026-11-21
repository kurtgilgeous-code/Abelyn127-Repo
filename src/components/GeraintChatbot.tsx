import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { PawPrint, Send, X } from 'lucide-react'
import GeraintAvatar from './GeraintAvatar'
import { askGeraint, MAX_USER_MESSAGE_LENGTH, type ChatTurn } from '../api/chat'
import './GeraintChatbot.css'

interface ChatMessage extends ChatTurn {
  id: string
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: "Woof! Welcome to Tampisawan 927! I'm **Geraint**, your resort concierge. 🐾\n\nI can help you with:\n- Cabins with exclusive, whole-resort use\n- Overnight, Day Tour, and Night Tour packages\n- Reserving with GCash or visiting as a walk-in\n\nWhat would you like to know?",
}

const QUICK_QUESTIONS = [
  'Which cabins include solo whole-resort use?',
  'How do I reserve via GCash?',
  'Day Tour vs. Overnight packages?',
  'Pwede ba walk-in?',
]

/** Renders **bold** spans inside a line of text. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <Fragment key={index}>{part}</Fragment>,
  )
}

/** Minimal, safe formatter for Geraint's replies: paragraphs, bullet and numbered lists, bold. */
function renderMessage(content: string): ReactNode[] {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean, items: string[] } | null = null
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{paragraph.flatMap((line, index) => index ? [<br key={`b${index}`} />, ...renderInline(line)] : renderInline(line))}</p>)
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
      list = null
    }
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (!list || list.ordered !== ordered) {
        flushList()
        list = { ordered, items: [] }
      }
      list.items.push((bullet ?? numbered)![1])
    } else if (!line) {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(line.replace(/^#+\s*/, ''))
    }
  }
  flushParagraph()
  flushList()
  return blocks
}

export default function GeraintChatbot() {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const hasGuestMessage = messages.some((message) => message.role === 'user')

  const close = useCallback(() => {
    setOpen(false)
    window.setTimeout(() => launcherRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, error, open])

  useEffect(() => () => requestRef.current?.abort(), [])

  const send = useCallback(async (text: string) => {
    const content = text.trim().slice(0, MAX_USER_MESSAGE_LENGTH)
    if (!content || sending) return
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content }
    const history = [...messages.filter((message) => message.id !== WELCOME_MESSAGE.id), userMessage]
    setMessages((current) => [...current, userMessage])
    setInput('')
    setError('')
    setSending(true)
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const reply = await askGeraint(history.map(({ role, content: turn }) => ({ role, content: turn })), controller.signal)
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', content: reply }])
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Geraint could not reply right now. Please try again.')
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setSending(false)
      }
    }
  }, [messages, sending])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void send(input)
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(input)
    }
  }

  return (
    <div className={`geraint ${open ? 'is-open' : ''}`}>
      {open && (
        <section
          id={panelId}
          className="geraint-panel"
          role="dialog"
          aria-label="Chat with Geraint, the resort concierge"
          onKeyDown={(event) => { if (event.key === 'Escape') close() }}
        >
          <header className="geraint-header">
            <span className="geraint-header-avatar">
              <GeraintAvatar size={44} />
              <span className="geraint-online-dot" aria-hidden="true" />
            </span>
            <span className="geraint-header-text">
              <b>Geraint • Resort Concierge</b>
              <small>Tampisawan 927 Virtual Guide</small>
            </span>
            <button type="button" className="geraint-close" onClick={close} aria-label="Close chat">
              <X size={18} />
            </button>
          </header>

          <div className="geraint-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
            {messages.map((message) => (
              <div key={message.id} className={`geraint-row is-${message.role}`}>
                {message.role === 'assistant' && <GeraintAvatar size={30} className="geraint-row-avatar" />}
                <div className="geraint-bubble">
                  {message.role === 'assistant' && <span className="geraint-sr-only">Geraint: </span>}
                  {message.role === 'user' && <span className="geraint-sr-only">You: </span>}
                  {message.role === 'assistant' ? renderMessage(message.content) : <p>{message.content}</p>}
                </div>
              </div>
            ))}

            {!hasGuestMessage && (
              <div className="geraint-chips" aria-label="Quick questions">
                {QUICK_QUESTIONS.map((question) => (
                  <button key={question} type="button" className="geraint-chip" onClick={() => void send(question)} disabled={sending}>
                    {question}
                  </button>
                ))}
              </div>
            )}

            {sending && (
              <div className="geraint-row is-assistant">
                <GeraintAvatar size={30} className="geraint-row-avatar" />
                <div className="geraint-bubble geraint-typing" role="status">
                  <span className="geraint-paws" aria-hidden="true">
                    <PawPrint size={13} /><PawPrint size={13} /><PawPrint size={13} />
                  </span>
                  <span>Geraint is typing…</span>
                </div>
              </div>
            )}

            {error && <p className="geraint-error" role="alert">{error}</p>}
          </div>

          <form className="geraint-composer" onSubmit={submit}>
            <label className="geraint-sr-only" htmlFor={`${panelId}-input`}>Message Geraint</label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={MAX_USER_MESSAGE_LENGTH}
              placeholder="Ask about cabins, packages, or GCash…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <button type="submit" className="geraint-send" disabled={sending || !input.trim()} aria-label="Send message">
              <Send size={17} />
            </button>
          </form>
          <p className="geraint-disclaimer">Geraint is an AI guide. Check rates and dates in the booking calculator.</p>
        </section>
      )}

      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className="geraint-launcher"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls={panelId}
        >
          <span className="geraint-launcher-avatar">
            <GeraintAvatar size={38} />
            <span className="geraint-online-dot" aria-hidden="true" />
          </span>
          <span className="geraint-launcher-label">Ask Geraint 🐾</span>
        </button>
      )}
    </div>
  )
}
