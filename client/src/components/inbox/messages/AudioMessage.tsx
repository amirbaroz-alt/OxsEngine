import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";
import { MediaActions } from "../media-components";

interface AudioMessageProps {
  msgId: string;
  isInbound: boolean;
  base64: string;
  mimeType: string;
  fileName?: string;
  playingAudioId: string | null;
  toggleAudio: (id: string, base64: string, mime: string) => void;
}

export function AudioMessage({ msgId, isInbound, base64, mimeType, fileName, playingAudioId, toggleAudio }: AudioMessageProps) {
  const { t } = useTranslation();
  const mime = mimeType || "audio/webm";

  return (
    <div>
      <div className="flex items-center gap-2 py-1">
        <Button size="icon" variant="ghost" onClick={() => toggleAudio(msgId, base64, mime)} data-testid={`button-play-audio-${isInbound ? "" : "out-"}${msgId}`}>
          {playingAudioId === msgId ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="flex-1 h-1 bg-current opacity-20 rounded-full" />
        <span className="text-xs opacity-60">{fileName || t("inbox.voiceMessage", "Voice")}</span>
      </div>
      <MediaActions base64={base64} mimeType={mime} fileName={fileName || "audio.webm"} />
    </div>
  );
}
