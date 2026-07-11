declare module 'react-syntax-highlighter/dist/esm/prism-async' {
  import type { ComponentType } from 'react'
  import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'
  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps>
  export default SyntaxHighlighter
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  const styles: { [key: string]: { [key: string]: React.CSSProperties } }
  export const oneDark: { [key: string]: React.CSSProperties }
  export default styles
}
