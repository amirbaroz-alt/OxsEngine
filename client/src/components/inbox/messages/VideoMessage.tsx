import { InlineVideo } from "../media-components";

interface VideoMessageProps {
  msgId: string;
  fileName: string;
  isVideoNote: boolean;
}

export function VideoMessage({ msgId, fileName, isVideoNote }: VideoMessageProps) {
  return (
    <InlineVideo fileName={fileName} messageId={msgId} isVideoNote={isVideoNote} />
  );
}
