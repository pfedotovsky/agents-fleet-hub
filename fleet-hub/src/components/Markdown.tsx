import { memo, useState } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-ink-700 bg-ink-900/80 px-1.5 py-0.5 text-[10px] text-ink-400 opacity-0 transition-opacity hover:text-ink-100 group-hover:opacity-100"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function CodeBlock({ className, children }: ComponentPropsWithoutRef<'code'>) {
  const text = String(children ?? '').replace(/\n$/, '')
  const match = /language-(\w+)/.exec(className ?? '')
  // Inline code (no language, single line) → plain styled <code>.
  if (!match && !text.includes('\n')) {
    return (
      <code className="rounded border border-ink-700/60 bg-ink-800/60 px-1 py-0.5 font-mono text-[0.85em] text-ink-200">
        {children}
      </code>
    )
  }
  const language = match?.[1] ?? 'text'
  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border border-ink-800">
      {language !== 'text' && (
        <span className="absolute left-3 top-2 z-10 text-[10px] uppercase tracking-wide text-ink-500">
          {language}
        </span>
      )}
      <CopyButton text={text} />
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: language !== 'text' ? '1.75rem 1rem 1rem' : '1rem',
          background: '#18181b',
          fontSize: '13.5px',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
      >
        {text}
      </SyntaxHighlighter>
    </div>
  )
}

const COMPONENTS = {
  code: CodeBlock,
  a: (props: ComponentPropsWithoutRef<'a'>) => (
    <a {...props} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline" />
  ),
  ul: (props: ComponentPropsWithoutRef<'ul'>) => (
    <ul {...props} className="my-2 list-disc space-y-1 pl-5" />
  ),
  ol: (props: ComponentPropsWithoutRef<'ol'>) => (
    <ol {...props} className="my-2 list-decimal space-y-1 pl-5" />
  ),
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote {...props} className="my-2 border-l-2 border-ink-700 pl-3 italic text-ink-400" />
  ),
  h1: (props: ComponentPropsWithoutRef<'h1'>) => <h1 {...props} className="mb-2 mt-3 text-lg font-semibold" />,
  h2: (props: ComponentPropsWithoutRef<'h2'>) => <h2 {...props} className="mb-2 mt-3 text-base font-semibold" />,
  h3: (props: ComponentPropsWithoutRef<'h3'>) => <h3 {...props} className="mb-1 mt-2 text-[15px] font-semibold" />,
  table: (props: ComponentPropsWithoutRef<'table'>) => (
    <div className="my-2 overflow-x-auto">
      <table {...props} className="min-w-full border-collapse text-[13px]" />
    </div>
  ),
  th: (props: ComponentPropsWithoutRef<'th'>) => (
    <th {...props} className="border border-ink-800 bg-ink-900 px-2 py-1 text-left font-medium" />
  ),
  td: (props: ComponentPropsWithoutRef<'td'>) => (
    <td {...props} className="border border-ink-800 px-2 py-1" />
  ),
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] leading-7 text-ink-200 [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
