import { DiffFileList } from './DiffFileList'
import { useSelection } from '../contexts/SelectionContext'
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { VscCopy, VscCheck } from 'react-icons/vsc'

interface SimpleDiffPanelProps {
  onFileSelect: (filePath: string) => void
}

export function SimpleDiffPanel({ onFileSelect }: SimpleDiffPanelProps) {
  const { selection } = useSelection()
  const [dockOpen, setDockOpen] = useState(false)
  const [originalPrompt, setOriginalPrompt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const fetchPrompt = async () => {
      if (selection.kind !== 'session' || !selection.payload) {
        setOriginalPrompt(null)
        return
      }
      setLoading(true)
      try {
        const session = await invoke<any>('para_core_get_session', { name: selection.payload })
        setOriginalPrompt(session?.initial_prompt ?? null)
      } catch (e) {
        console.error('[SimpleDiffPanel] Failed to fetch session prompt:', e)
        setOriginalPrompt(null)
      } finally {
        setLoading(false)
      }
    }
    fetchPrompt()
  }, [selection])

  const canShowDock = selection.kind === 'session' && !!originalPrompt && (originalPrompt?.trim().length ?? 0) > 0
  const sessionLabel = selection.kind === 'session' ? selection.payload : undefined

  const handleCopy = async () => {
    if (!originalPrompt) return
    try {
      await navigator.clipboard.writeText(originalPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      <div className={clsx('flex-1 min-h-0 overflow-hidden transition-[max-height] duration-200')}>
        <DiffFileList onFileSelect={onFileSelect} />
      </div>

      {dockOpen && canShowDock && (
        <div
          className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 flex flex-col"
          style={{ height: '35%' }}
        >
          <div className="px-2 py-1 text-xs text-slate-400 border-b border-slate-800 flex items-center justify-between">
            <span className="flex-1 text-center">
              {sessionLabel ? `Prompt — ${sessionLabel}` : 'Prompt'}
            </span>
            <button
              onClick={handleCopy}
              className="px-2 py-0.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors flex items-center gap-1"
              title="Copy prompt to clipboard"
            >
              {copied ? (
                <>
                  <VscCheck className="text-xs" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <VscCopy className="text-xs" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <div className="session-header-ruler flex-shrink-0" />
          <div className="flex-1 min-h-0 overflow-auto p-3 text-[12px] leading-[1.6] text-slate-300">
            {loading ? (
              <div className="text-slate-500">Loading prompt…</div>
            ) : (
              <div className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: ({ children }) => (
                      <pre className="bg-slate-800 rounded p-2 overflow-x-auto">
                        {children}
                      </pre>
                    ),
                    code: ({ children, ...props }: any) => {
                      const inline = !props.className?.includes('language-')
                      return inline ? (
                        <code className="bg-slate-800 px-1 py-0.5 rounded text-xs" {...props}>
                          {children}
                        </code>
                      ) : (
                        <code className="text-xs" {...props}>
                          {children}
                        </code>
                      )
                    },
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside space-y-1">
                      {children}
                    </ol>
                  ),
                  h1: ({ children }) => (
                    <h1 className="text-lg font-bold mb-2">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-base font-bold mb-2">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-bold mb-1">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="mb-2">
                      {children}
                    </p>
                  ),
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      className="text-blue-400 hover:text-blue-300 underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-slate-600 pl-3 italic text-slate-400">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="border-slate-700 my-3" />,
                  table: ({ children }) => (
                    <table className="border-collapse border border-slate-700">
                      {children}
                    </table>
                  ),
                  th: ({ children }) => (
                    <th className="border border-slate-700 px-2 py-1 bg-slate-800">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-slate-700 px-2 py-1">
                      {children}
                    </td>
                  )
                  }}
                >
                  {originalPrompt}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}

      {selection.kind === 'session' && (
        <button
          className="absolute bottom-3 right-3 px-3 py-1.5 text-xs rounded bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700"
          onClick={() => setDockOpen(v => !v)}
          title={dockOpen ? 'Hide prompt' : 'Show prompt'}
        >
          {dockOpen ? 'Hide prompt' : 'Show prompt'}
        </button>
      )}
    </div>
  )
}