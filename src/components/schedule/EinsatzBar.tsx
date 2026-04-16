import type { Einsatz } from "./scheduleTypes";

interface Props {
  einsatz: Einsatz;
  projectName: string;
  color: string;
  startCol: number;
  endCol: number;
  totalDays: number;
  onClick?: () => void;
}

/**
 * Darken a hex color by a given amount (0–1).
 * Used to derive a subtle border color from the background.
 */
function darkenHex(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  const num = parseInt(raw, 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

export function EinsatzBar({
  einsatz,
  projectName,
  color,
  startCol,
  endCol,
  totalDays,
  onClick,
}: Props) {
  const leftPct = (startCol / totalDays) * 100;
  const widthPct = ((endCol - startCol + 1) / totalDays) * 100;
  const borderColor = darkenHex(color, 0.15);

  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 rounded-md flex items-center px-2 text-xs font-medium truncate transition-shadow ${
        onClick ? "cursor-pointer hover:shadow-md" : ""
      }`}
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        height: 28,
        backgroundColor: color,
        border: `1px solid ${borderColor}`,
        color: "#1e293b",
        minWidth: 0,
      }}
      title={`${projectName}${einsatz.name ? ` — ${einsatz.name}` : ""}`}
      onClick={onClick}
    >
      <span className="truncate">{projectName}</span>
    </div>
  );
}
