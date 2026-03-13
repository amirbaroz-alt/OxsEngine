import { useTranslation } from "react-i18next";

interface LocationMessageProps {
  metadata?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  content: string;
}

export function LocationMessage({ metadata, content }: LocationMessageProps) {
  const { t } = useTranslation();

  if (metadata?.latitude && metadata?.longitude) {
    const { latitude, longitude, name, address } = metadata;
    const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

    return (
      <div className="mt-1">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors text-sm underline"
          data-testid="link-location-map"
        >
          {name || address || `${latitude}, ${longitude}`}
        </a>
        {address && name && (
          <p className="text-xs text-muted-foreground mt-0.5">{address}</p>
        )}
      </div>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words">
      {content || t("inbox.mediaLocation")}
    </p>
  );
}
