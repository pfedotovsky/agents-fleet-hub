import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ModelOption } from '../types'

/**
 * Model picker that shows each model's exact-version description inline (like the
 * Claude CLI `/model` list), instead of a native <select> that can only render
 * labels. Opens upward from the composer footer and works on touch, where the
 * OS <select> sheet and hover tooltips cannot surface the description.
 */
export function ModelSelect({
  options,
  value,
  onChange,
}: {
  options: ModelOption[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  // Close on outside pointer / Escape while open.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // When opening, highlight the current selection and scroll it into view.
  useLayoutEffect(() => {
    if (!open) return
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0)
    const active = menuRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex])

  function commit(index: number) {
    const option = options[index]
    if (option) onChange(option.value)
    setOpen(false)
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((index) => Math.min(index + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(highlight)
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={onTriggerKeyDown}
        title="Model"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-40 items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg-muted outline-none hover:bg-elevated"
      >
        <span className="truncate">{selected?.label ?? 'Model'}</span>
        <ChevronsUpDown size={11} className="shrink-0 text-fg-faint" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-72 max-w-[80vw] overflow-y-auto rounded-xl border border-line-strong bg-surface py-1 shadow-2xl"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-active={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => commit(index)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                  index === highlight ? 'bg-elevated' : ''
                }`}
              >
                <Check
                  size={13}
                  className={`mt-0.5 shrink-0 ${isSelected ? 'text-fg' : 'text-transparent'}`}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-fg">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-xs text-fg-faint">{option.description}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
