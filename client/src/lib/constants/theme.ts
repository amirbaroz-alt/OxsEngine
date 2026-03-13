export const WA_BG_LIGHT = "#e5ddd5";
export const WA_BG_DARK = "#0b141a";

export const STATUS_COLORS = {
  APPROVED: {
    border: "#22c55e",
    text: "#16a34a",
    bg: "#f0fdf4",
  },
  REJECTED: {
    border: "#ef4444",
    text: "#dc2626",
    bg: "#fef2f2",
  },
  PENDING: {
    border: "#eab308",
    text: "#ca8a04",
    bg: "#fefce8",
  },
  DEFAULT: {
    border: "#6b7280",
  },
} as const;

export const NOTE_COLORS = {
  bg: "#FFF9C4",
  bgDark: "#3a3520",
  text: "#7D6608",
  textDark: "#c9a90c",
  textDarkAlt: "#e0d5a0",
  border: "#F1C40F",
} as const;

export const READ_RECEIPT_BLUE = "#4FC3F7";

export const MSG_GREY = "#667781";
export const MSG_GREY_DARK = "#ffffff99";

export const SENDER_NAME_BLUE = "#1565c0";
export const SENDER_NAME_BLUE_DARK = "#64b5f6";

export const WA_INPUT_BG_DARK = "#2a3942";

export const MANAGER_BUBBLE_BG = "#F3E8FF";

export const ROLE_COLORS = {
  manager: "#A855F7",
  teamleader: "#10B981",
  employee: "#3B82F6",
} as const;

export function getStatusBorderColor(status: string): string {
  return (STATUS_COLORS as any)[status]?.border ?? STATUS_COLORS.DEFAULT.border;
}

export function getStatusBadgeStyle(status: string): React.CSSProperties | undefined {
  const colors = (STATUS_COLORS as any)[status];
  if (!colors?.bg) return undefined;
  return { borderColor: colors.border, color: colors.text, backgroundColor: colors.bg };
}
