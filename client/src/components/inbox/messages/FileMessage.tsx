import { useTranslation } from "react-i18next";
import { DocumentPreview } from "../media-components";

interface FileMessageProps {
  base64: string;
  mimeType: string;
  fileName?: string;
}

export function FileMessage({ base64, mimeType, fileName }: FileMessageProps) {
  const { t } = useTranslation();

  return (
    <DocumentPreview
      base64={base64}
      mimeType={mimeType || "application/octet-stream"}
      fileName={fileName || t("inbox.document", "Document")}
      downloadLabel={t("inbox.download", "Download")}
    />
  );
}
