import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { VscCopy } from 'react-icons/vsc'

interface Props {
  sessionName: string
  editable?: boolean
  debounceMs?: number
}

export function DraftContentView({ sessionName, editable = true, debounceMs = 1000 }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    invoke<any>('para_core_get_session', { name: sessionName })
      .then((session) => {
        if (!mounted) return
        const text: string = session?.draft_content ?? session?.initial_prompt ?? ''
        setContent(text)
      })
      .catch((e) => {
        if (!mounted) return
        setError(String(e))
      })
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [sessionName])

  // Auto-save
  useEffect(() => {
    if (!editable) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!editable) return
      try {
        setSaving(true)
        await invoke('para_core_update_draft_content', { name: sessionName, content })
      } catch (e) {
        console.error('[DraftContentView] Failed to save draft:', e)
      } finally {
        setSaving(false)
      }
    }, debounceMs)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, editable, debounceMs, sessionName])

  const handleCopy = async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(content)
    } catch (err) {
      console.error('[DraftContentView] Failed to copy content:', err)
    } finally {
      setTimeout(() => setCopying(false), 1000)
    }
  }

  const render = useMemo(() => (
    <div className="prose prose-sm prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  ), [content])

  if (loading) {
    return <div className="h-full flex items-center justify-center text-slate-400">Loading…</div>
  }

  if (editable) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {saving ? 'Saving…' : error ? <span className="text-red-400">{error}</span> : 'Editing draft'}
          </div>
          <button
            onClick={handleCopy}
            disabled={copying || !content}
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copy task content"
          >
            <VscCopy />
            {copying ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <textarea
          className="flex-1 w-full bg-slate-900 text-slate-100 px-3 py-2 outline-none border-0 resize-none font-mono text-sm"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter task description in markdown…"
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs text-slate-400">Task content</div>
        <button
          onClick={handleCopy}
          disabled={copying || !content}
          className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Copy task content"
        >
          <VscCopy />
          {copying ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {render}
      </div>
    </div>
  )
}
