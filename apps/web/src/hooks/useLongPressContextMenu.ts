import {
  useCallback,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
} from "react";

const DEFAULT_LONG_PRESS_DELAY_MS = 520;
const DEFAULT_MOVE_TOLERANCE_PX = 10;

export interface LongPressContextMenuPosition {
  x: number;
  y: number;
}

export function useLongPressContextMenu<T extends HTMLElement>({
  disabled = false,
  delayMs = DEFAULT_LONG_PRESS_DELAY_MS,
  moveTolerancePx = DEFAULT_MOVE_TOLERANCE_PX,
  onLongPress,
}: {
  disabled?: boolean;
  delayMs?: number;
  moveTolerancePx?: number;
  onLongPress: (position: LongPressContextMenuPosition) => void;
}): Pick<
  HTMLAttributes<T>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onPointerLeave"
  | "onClickCapture"
> {
  const timeoutRef = useRef<number | null>(null);
  const startRef = useRef<LongPressContextMenuPosition | null>(null);
  const suppressClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    startRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<T>) => {
      if (disabled || event.button !== 0) return;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;

      clearTimer();
      const position = { x: event.clientX, y: event.clientY };
      startRef.current = position;
      suppressClickRef.current = false;

      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        suppressClickRef.current = true;
        onLongPress(position);
      }, delayMs);
    },
    [clearTimer, delayMs, disabled, onLongPress],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<T>) => {
      const start = startRef.current;
      if (!start) return;

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (Math.hypot(deltaX, deltaY) > moveTolerancePx) {
        clearTimer();
      }
    },
    [clearTimer, moveTolerancePx],
  );

  const handleClickCapture = useCallback((event: MouseEvent<T>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: clearTimer,
    onPointerCancel: clearTimer,
    onPointerLeave: clearTimer,
    onClickCapture: handleClickCapture,
  };
}
