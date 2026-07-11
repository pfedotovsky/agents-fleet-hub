import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { loadLanguage } from '@uiw/codemirror-extensions-langs'
import type { LanguageName } from '@uiw/codemirror-extensions-langs'

const EXT_TO_LANG: Record<string, LanguageName> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  css: 'css',
  scss: 'sass',
  less: 'less',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rb: 'rb',
  go: 'go',
  rs: 'rs',
  java: 'java',
  kt: 'kt',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'cs',
  php: 'php',
  sh: 'sh',
  bash: 'bash',
  zsh: 'sh',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  xml: 'xml',
  swift: 'swift',
  proto: 'proto',
}

function languageExtensions(filePath: string) {
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  const ext = name.includes('.') ? name.split('.').pop()! : name
  const lang = EXT_TO_LANG[ext]
  const extension = lang ? loadLanguage(lang) : null
  return extension ? [extension] : []
}

interface Props {
  filePath: string
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}

export default function CodeEditor({ filePath, value, onChange, readOnly }: Props) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={oneDark}
      extensions={languageExtensions(filePath)}
      readOnly={readOnly}
      basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true }}
      height="100%"
      style={{ height: '100%', fontSize: '13px' }}
    />
  )
}
