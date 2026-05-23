import type { ComponentType, CSSProperties } from "react";
import type { LucideProps } from "lucide-react";
import {
  AudioWaveformIcon,
  BookOpenIcon,
  CloudIcon,
  DiamondIcon,
  HeartIcon,
  LeafIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react";
import type { ThreadIdentity, ThreadIdentityIcon } from "@t3tools/contracts";
import { cn } from "~/lib/utils";

const ICONS = {
  cloud: CloudIcon,
  diamond: DiamondIcon,
  heart: HeartIcon,
  leaf: LeafIcon,
  waveform: AudioWaveformIcon,
  shield: ShieldIcon,
  book: BookOpenIcon,
} as const satisfies Record<ThreadIdentityIcon, ComponentType<LucideProps>>;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : `rgba(127, 140, 141, ${alpha})`;
}

export function ThreadIdentityAvatar({
  identity,
  size = "sm",
  className,
  onClick,
}: {
  readonly identity: ThreadIdentity;
  readonly size?: "xs" | "sm" | "md";
  readonly className?: string;
  readonly onClick?: () => void;
}) {
  const Icon = ICONS[identity.icon] ?? UserIcon;
  const sizeClassName =
    size === "xs"
      ? "size-5 [&>svg]:size-3"
      : size === "md"
        ? "size-7 [&>svg]:size-4"
        : "size-6 [&>svg]:size-3.5";
  const commonClassName = cn(
    "inline-flex shrink-0 items-center justify-center rounded-md border transition-colors",
    sizeClassName,
    onClick &&
      "cursor-pointer hover:bg-[var(--thread-identity-hover-bg)] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
    className,
  );
  const style = {
    color: identity.color,
    borderColor: rgba(identity.color, 0.38),
    backgroundColor: rgba(identity.color, 0.12),
    "--thread-identity-hover-bg": rgba(identity.color, 0.18),
  } as CSSProperties;

  if (onClick) {
    return (
      <button
        type="button"
        aria-label={`Change ${identity.name} icon/color`}
        className={commonClassName}
        style={style}
        onClick={onClick}
      >
        <Icon strokeWidth={2.2} />
      </button>
    );
  }

  return (
    <span aria-label={identity.name} className={commonClassName} role="img" style={style}>
      <Icon strokeWidth={2.2} />
    </span>
  );
}
