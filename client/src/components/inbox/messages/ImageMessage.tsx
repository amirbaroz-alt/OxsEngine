import { TiffImage, MediaActions } from "../media-components";

interface ImageMessageProps {
  msgId: string;
  isInbound: boolean;
  base64: string;
  mimeType: string;
  fileName?: string;
  openMediaPreview: () => void;
}

export function ImageMessage({ msgId, isInbound, base64, mimeType, fileName, openMediaPreview }: ImageMessageProps) {
  const mime = mimeType || "image/png";
  const name = fileName || "image.png";

  return (
    <div className="mt-1">
      <div className="cursor-pointer" onClick={openMediaPreview} data-testid={`button-preview-image-${isInbound ? "" : "out-"}${msgId}`}>
        <TiffImage base64={base64} mimeType={mime} alt={name} className="max-w-[240px] max-h-[240px] rounded-md object-cover" />
      </div>
      <MediaActions base64={base64} mimeType={mime} fileName={name} onPreview={openMediaPreview} />
    </div>
  );
}
