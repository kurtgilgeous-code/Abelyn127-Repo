import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Smallest on-screen text. Change this one number to make the whole site larger or smaller. */
const MIN_FONT_PX = 14
/** Sizes above this are headings and are left as designed. */
const SCALE_UP_TO_PX = 16
const SMALLEST_DESIGN_PX = 7

/** Raises small text while keeping the order of sizes (a label stays smaller than its heading). */
const readableSize = (px: number) => {
  if (px > SCALE_UP_TO_PX) return px
  const scaled = MIN_FONT_PX + (Math.max(px, SMALLEST_DESIGN_PX) - SMALLEST_DESIGN_PX) / 3
  return Math.round(scaled * 100) / 100
}

type CssNode = { type?: string, name?: string, params?: string, parent?: CssNode }

const isPrintRule = (node: CssNode) => {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'atrule' && current.name === 'media' && current.params?.includes('print')) return true
  }
  return false
}

/** Applies readableSize to every px/rem font-size, except printed receipts and reports. */
const readableFonts = {
  postcssPlugin: 'readable-fonts',
  Declaration: {
    'font-size': (declaration: CssNode & { value: string }) => {
      if (isPrintRule(declaration)) return
      const raised = declaration.value.replace(/(?<![\w.-])(\d*\.?\d+)(px|rem)\b/g, (match, size: string, unit: string) => {
        const px = unit === 'rem' ? Number(size) * 16 : Number(size)
        const next = readableSize(px)
        return next === px ? match : `${next}px`
      })
      if (raised !== declaration.value) declaration.value = raised
    },
  },
}

/** Largest corner rounding on boxes, buttons, and inputs. Set to 0 for fully square corners. */
const MAX_CORNER_PX = 3

/** Pills and dots that stay round because they are indicators, not boxes. */
const keepsRoundShape = /dot|indicator/

/**
 * Squares the corners of every box for a sharper, more professional look. Circles (50%) and
 * illustration shapes (other % values) keep their curves, so icons, avatars, and the hero art
 * stay round.
 */
const squareCorners = {
  postcssPlugin: 'square-corners',
  Declaration(declaration: CssNode & { prop: string, value: string, parent?: CssNode & { selector?: string } }) {
    if (!/^border(-[a-z]+)*-radius$/.test(declaration.prop)) return
    const value = declaration.value
    if (/%|var\(|inherit|initial|unset/.test(value)) return
    if (/\b9{3,}px/.test(value) && keepsRoundShape.test(declaration.parent?.selector ?? '')) return
    const squared = value.replace(/(?<![\w.-])(\d*\.?\d+)(px|rem|em)\b/g, (match, size: string, unit: string) => {
      const px = unit === 'px' ? Number(size) : Number(size) * 16
      return px > MAX_CORNER_PX ? `${MAX_CORNER_PX}px` : match
    })
    if (squared !== value) declaration.value = squared
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: { plugins: [readableFonts, squareCorners] },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
