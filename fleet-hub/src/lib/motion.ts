/**
 * Shared motion vocabulary so animations stay consistent across the app.
 * Enters are ~200-240ms ease-out; exits are shorter ease-in (per the golden
 * rule "exits faster than enters"). Reduced-motion is handled globally by the
 * <MotionConfig reducedMotion="user"> wrapper in main.tsx, so individual call
 * sites don't need to branch.
 */
import type { Transition, Variants } from 'motion/react'

export const EASE_OUT = [0.23, 1, 0.32, 1] as const
export const EASE_IN = [0.32, 0, 0.67, 0] as const

/** Transcript message reveal — spread onto a motion element; plays once on mount. */
export const messageReveal = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: EASE_OUT },
} as const

/** Inline chat cards (permission / question / plan) inside <AnimatePresence>. */
export const cardVariants: Variants = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: EASE_IN } },
}

/** Full-screen overlay scrim fade. */
export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
}

/** Centered modal pop (login, search). */
export const modalVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.15, ease: EASE_IN } },
}

/** Right-docked panel slide (settings). */
export const panelVariants: Variants = {
  initial: { x: '100%' },
  animate: { x: 0, transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { x: '100%', transition: { duration: 0.18, ease: EASE_IN } },
}

/** Spring used for list-row reflow (layout animations). */
export const layoutTransition: Transition = { type: 'spring', stiffness: 500, damping: 42 }
