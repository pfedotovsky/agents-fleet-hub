import { useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { FileNode } from '../types'

interface Props {
  nodes: FileNode[]
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  depth?: number
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
  depth,
}: {
  node: FileNode
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  depth: number
}) {
  const [open, setOpen] = useState(depth === 0)
  const isDir = node.type === 'directory'
  const selected = node.path === selectedPath

  return (
    <div>
      <button
        type="button"
        onClick={() => (isDir ? setOpen((v) => !v) : onSelect(node))}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[13px] transition-colors ${
          selected ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:bg-ink-900'
        }`}
      >
        {isDir ? (
          <>
            <ChevronRight
              size={12}
              className={`shrink-0 text-ink-600 transition-transform ${open ? 'rotate-90' : ''}`}
            />
            {open ? (
              <FolderOpen size={13} className="shrink-0 text-sky-500/80" />
            ) : (
              <Folder size={13} className="shrink-0 text-sky-500/80" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <File size={13} className="shrink-0 text-ink-600" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && open && node.children && (
        <FileTree
          nodes={node.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </div>
  )
}

export function FileTree({ nodes, selectedPath, onSelect, depth = 0 }: Props) {
  return (
    <>
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </>
  )
}
