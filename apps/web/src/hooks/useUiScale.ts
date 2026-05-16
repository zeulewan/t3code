import { useEffect } from "react";
import type { UiScale } from "@t3tools/contracts/settings";

export function applyUiScale(scale: UiScale) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.uiScale = scale;
}

export function useApplyUiScale(scale: UiScale) {
  useEffect(() => {
    applyUiScale(scale);
  }, [scale]);
}
