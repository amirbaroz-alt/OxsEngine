interface ToggleBadgeProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  labels?: { on: string; off: string };
  "data-testid"?: string;
  className?: string;
}

export function ToggleBadge({
  checked,
  onCheckedChange,
  labels = { on: "Active", off: "Inactive" },
  "data-testid": testId,
  className = "",
}: ToggleBadgeProps) {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
        checked
          ? "bg-green-100 text-green-700 hover:bg-green-200"
          : "bg-red-100 text-red-600 hover:bg-red-200"
      } ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${checked ? "bg-green-500" : "bg-red-500"}`} />
      {checked ? labels.on : labels.off}
    </button>
  );
}
