import { useState, useRef, type ReactNode, type TouchEvent, type MouseEvent } from 'react'

interface SwipeableCardProps {
  children: ReactNode
  onSwipeRight?: () => void
  onSwipeLeft?: () => void
  onClick?: () => void
  swipeRightLabel?: string
  swipeRightIcon?: ReactNode
  swipeLeftLabel?: string
  swipeLeftIcon?: ReactNode
  threshold?: number
  disabled?: boolean
  className?: string
}

export function SwipeableCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  onClick,
  swipeRightLabel = 'Avanzar',
  swipeRightIcon,
  swipeLeftLabel = 'Regresar',
  swipeLeftIcon,
  threshold = 85,
  disabled = false,
  className = '',
}: SwipeableCardProps) {
  const [offsetX, setOffsetX] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [exitingDirection, setExitingDirection] = useState<'left' | 'right' | null>(null)

  const startX = useRef(0)
  const startY = useRef(0)
  const isDragging = useRef(false)
  const isHorizontal = useRef<boolean | null>(null)
  const hasVibrated = useRef(false)

  // Handlers para Touch (Tablets / Móviles)
  const handleTouchStart = (e: TouchEvent) => {
    if (disabled || exitingDirection) return
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    isDragging.current = true
    isHorizontal.current = null
    hasVibrated.current = false
    setIsAnimating(false)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging.current || disabled || exitingDirection) return

    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const deltaX = currentX - startX.current
    const deltaY = currentY - startY.current

    // Determinar si es scroll vertical o swipe horizontal
    if (isHorizontal.current === null) {
      if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          isHorizontal.current = true
        } else {
          isHorizontal.current = false
          isDragging.current = false
          return
        }
      } else {
        return
      }
    }

    if (!isHorizontal.current) return

    // Aplicar resistencia si la dirección no está habilitada
    let nextOffset = deltaX
    if (deltaX > 0 && !onSwipeRight) {
      nextOffset = deltaX * 0.15
    } else if (deltaX < 0 && !onSwipeLeft) {
      nextOffset = deltaX * 0.15
    }

    // Vibración háptica al cruzar el umbral
    if (Math.abs(nextOffset) >= threshold && !hasVibrated.current) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(15)
      }
      hasVibrated.current = true
    } else if (Math.abs(nextOffset) < threshold) {
      hasVibrated.current = false
    }

    setOffsetX(nextOffset)
  }

  const handleTouchEnd = () => {
    if (!isDragging.current || disabled || exitingDirection) return
    isDragging.current = false

    const moved = Math.abs(offsetX)

    // Si fue solo un tap leve (< 6px), disparar onClick
    if (moved < 6 && isHorizontal.current === null && onClick) {
      onClick()
      return
    }

    if (offsetX >= threshold && onSwipeRight) {
      // Disparar avance a la derecha
      setExitingDirection('right')
      setIsAnimating(true)
      setOffsetX(450)
      setTimeout(() => {
        onSwipeRight()
        setExitingDirection(null)
        setOffsetX(0)
        setIsAnimating(false)
      }, 190)
    } else if (offsetX <= -threshold && onSwipeLeft) {
      // Disparar retroceso a la izquierda
      setExitingDirection('left')
      setIsAnimating(true)
      setOffsetX(-450)
      setTimeout(() => {
        onSwipeLeft()
        setExitingDirection(null)
        setOffsetX(0)
        setIsAnimating(false)
      }, 190)
    } else {
      // Regresar al centro con animación elástica
      setIsAnimating(true)
      setOffsetX(0)
    }
  }

  // Soporte Mouse Drag para pruebas en desktop
  const handleMouseDown = (e: MouseEvent) => {
    if (disabled || exitingDirection || (e.target as HTMLElement).closest('button, a')) return
    startX.current = e.clientX
    startY.current = e.clientY
    isDragging.current = true
    isHorizontal.current = true
    hasVibrated.current = false
    setIsAnimating(false)

    const onMouseMove = (me: globalThis.MouseEvent) => {
      if (!isDragging.current) return
      const deltaX = me.clientX - startX.current
      let nextOffset = deltaX
      if (deltaX > 0 && !onSwipeRight) nextOffset = deltaX * 0.15
      if (deltaX < 0 && !onSwipeLeft) nextOffset = deltaX * 0.15

      if (Math.abs(nextOffset) >= threshold && !hasVibrated.current) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15)
        hasVibrated.current = true
      }
      setOffsetX(nextOffset)
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (!isDragging.current) return
      isDragging.current = false

      setOffsetX((curr) => {
        const moved = Math.abs(curr)
        if (moved < 6 && onClick) {
          onClick()
          return 0
        }
        if (curr >= threshold && onSwipeRight) {
          setExitingDirection('right')
          setIsAnimating(true)
          setTimeout(() => {
            onSwipeRight()
            setExitingDirection(null)
            setOffsetX(0)
            setIsAnimating(false)
          }, 190)
          return 450
        } else if (curr <= -threshold && onSwipeLeft) {
          setExitingDirection('left')
          setIsAnimating(true)
          setTimeout(() => {
            onSwipeLeft()
            setExitingDirection(null)
            setOffsetX(0)
            setIsAnimating(false)
          }, 190)
          return -450
        } else {
          setIsAnimating(true)
          return 0
        }
      })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const isRightActive = offsetX >= threshold
  const isLeftActive = offsetX <= -threshold
  const rotation = offsetX * 0.02

  return (
    <div className={`relative overflow-hidden rounded-2xl select-none ${className}`}>
      {/* Fondo de acción al deslizar a la DERECHA (Avanzar) */}
      {onSwipeRight && offsetX > 10 && (
        <div
          className={`absolute inset-0 flex items-center justify-start pl-5 pr-4 transition-colors rounded-2xl ${
            isRightActive
              ? 'bg-emerald-600 text-white shadow-inner'
              : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
          }`}
        >
          <div
            className={`flex items-center gap-2.5 font-mono font-bold tracking-wider text-xs md:text-sm uppercase transition-transform ${
              isRightActive ? 'scale-110' : 'scale-95 opacity-80'
            }`}
          >
            {swipeRightIcon}
            <span>{swipeRightLabel}</span>
          </div>
        </div>
      )}

      {/* Fondo de acción al deslizar a la IZQUIERDA (Regresar) */}
      {onSwipeLeft && offsetX < -10 && (
        <div
          className={`absolute inset-0 flex items-center justify-end pr-5 pl-4 transition-colors rounded-2xl ${
            isLeftActive
              ? 'bg-amber-600 text-white shadow-inner'
              : 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
          }`}
        >
          <div
            className={`flex items-center gap-2.5 font-mono font-bold tracking-wider text-xs md:text-sm uppercase transition-transform ${
              isLeftActive ? 'scale-110' : 'scale-95 opacity-80'
            }`}
          >
            <span>{swipeLeftLabel}</span>
            {swipeLeftIcon}
          </div>
        </div>
      )}

      {/* Tarjeta principal deslizable */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        style={{
          transform: `translateX(${offsetX}px) rotate(${rotation}deg)`,
          transition: isAnimating ? 'transform 0.22s cubic-bezier(0.18, 0.89, 0.32, 1.15), opacity 0.2s' : 'none',
          opacity: exitingDirection ? 0 : 1,
          touchAction: 'pan-y',
        }}
        className="w-full relative z-10 cursor-grab active:cursor-grabbing"
      >
        {children}
      </div>
    </div>
  )
}
