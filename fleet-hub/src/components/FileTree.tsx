import { useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { FileNode } from '../types'

interface Props {
  nodes: FileNode[]
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  onFilesDrop?: (folder: FileNode, files: File[]) => void
  uploadDisabled?: boolean
  depth?: number
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
  onFilesDrop,
  uploadDisabled,
  depth,
}: {
  node: FileNode
  selectedPath: string | null
  onSelect: (node: FileNode) => void
  onFilesDrop?: (folder: FileNode, files: File[]) => void
  uploadDisabled?: boolean
  depth: number
}) {
  const [open, setOpen] = useState(depth === 0)
  const [dropActive, setDropActive] = useState(false)
  const isDir = node.type === 'directory'
  const selected = node.path === selectedPath

  return (
    <div>
      <button
        type="button"
        onClick={() => (isDir ? setOpen((v) => !v) : onSelect(node))}
        onDragOver={(event) => {
          if (!isDir || uploadDisabled || !event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
          setDropActive(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropActive(false)
          }
        }}
        onDrop={(event) => {
          if (!isDir || uploadDisabled) return
          event.preventDefault()
          event.stopPropagation()
          setDropActive(false)
          const files = Array.from(event.dataTransfer.files)
          if (files.length > 0) onFilesDrop?.(node, files)
        }}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[13px] transition-colors ${
          dropActive
            ? 'bg-info/10 text-fg ring-1 ring-inset ring-info/50'
            : selected
              ? 'bg-elevated text-fg'
              : 'text-fg-muted hover:bg-surface'
        }`}
      >
        {isDir ? (
          <>
            <ChevronRight
              size={12}
              className={`shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-90' : ''}`}
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
            <File size={13} className="shrink-0 text-fg-subtle" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && open && node.children && (
        <FileTree
          nodes={node.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onFilesDrop={onFilesDrop}
          uploadDisabled={uploadDisabled}
          depth={depth + 1}
        />
      )}
    </div>
  )
}

export function FileTree({
  nodes,
  selectedPath,
  onSelect,
  onFilesDrop,
  uploadDisabled,
  depth = 0,
}: Props) {
  return (
    <>
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onFilesDrop={onFilesDrop}
          uploadDisabled={uploadDisabled}
          depth={depth}
        />
      ))}
    </>
  )
}
