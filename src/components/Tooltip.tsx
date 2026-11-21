import {
  FloatingArrow,
  FloatingPortal,
  type Placement,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react'
import { type ReactElement, type ReactNode, type Ref, cloneElement, isValidElement, useState } from 'react'
import './Tooltip.css'

interface TooltipProps {
  /** Tooltip text. When empty, the child renders on its own with no tooltip. */
  label: ReactNode
  placement?: Placement
  /**
   * Wrap the child in a focusable span. Needed for disabled buttons, which don't
   * fire hover or focus events, so the tooltip can still explain why they're disabled.
   */
  wrap?: boolean
  children: ReactElement<{ ref?: Ref<HTMLElement> }>
}

/** Small hover / focus tooltip, positioned with Floating UI so it never runs off-screen. */
export default function Tooltip({ label, placement = 'top', wrap = false, children }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [arrowElement, setArrowElement] = useState<SVGSVGElement | null>(null)
  const { refs: { setReference, setFloating }, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowElement })],
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false, delay: { open: 120, close: 0 } }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' }),
  ])
  const { isMounted, styles } = useTransitionStyles(context, {
    duration: { open: 180, close: 120 },
    initial: ({ side }) => ({
      opacity: 0,
      transform: side === 'top' ? 'translateY(4px) scale(.96)' : side === 'bottom' ? 'translateY(-4px) scale(.96)' : 'scale(.96)',
    }),
  })
  const childRef = isValidElement(children) ? children.props.ref : undefined
  const mergedRef = useMergeRefs([setReference, childRef])

  if (!label) return children

  const reference = wrap
    ? <span className="tooltip-anchor" tabIndex={0} ref={setReference} {...getReferenceProps()}>{children}</span>
    : cloneElement(children, getReferenceProps({ ...children.props, ref: mergedRef }) as object)

  return (
    <>
      {reference}
      {isMounted && (
        <FloatingPortal>
          <div className="floating-tooltip-position" ref={setFloating} style={floatingStyles} {...getFloatingProps()}>
            <div className="floating-tooltip" style={styles}>
              {label}
              <FloatingArrow ref={setArrowElement} context={context} className="floating-tooltip-arrow" width={12} height={6} />
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
