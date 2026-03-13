import { isTiffMime, tiffBase64ToPngDataUrl } from "../helpers";
import { LazyMedia } from "../media-components";
import type { Message, MediaCache } from "../types";
import { AudioMessage } from "./AudioMessage";
import { ImageMessage } from "./ImageMessage";
import { VideoMessage } from "./VideoMessage";
import { FileMessage } from "./FileMessage";

interface MessageMediaBlockProps {
  msg: Message;
  mediaData: { base64: string; mimeType: string; fileName?: string } | null;
  playingAudioId: string | null;
  toggleAudio: (id: string, base64: string, mime: string) => void;
  openMediaPreview: (msg: Message) => void;
  mediaCache: MediaCache;
  mediaBatchLoaded: boolean;
  setPreviewMedia: (media: { url: string; type: string; name: string } | null) => void;
}

export function MessageMediaBlock({ msg, mediaData, playingAudioId, toggleAudio, openMediaPreview, mediaCache, mediaBatchLoaded, setPreviewMedia }: MessageMediaBlockProps) {
  const md = mediaData;
  const isInbound = msg.direction === "INBOUND";

  if (msg.type === "AUDIO" && md) {
    return (
      <AudioMessage
        msgId={msg._id}
        isInbound={isInbound}
        base64={md.base64}
        mimeType={md.mimeType}
        fileName={md.fileName}
        playingAudioId={playingAudioId}
        toggleAudio={toggleAudio}
      />
    );
  }

  if (msg.type === "IMAGE" && md) {
    return (
      <ImageMessage
        msgId={msg._id}
        isInbound={isInbound}
        base64={md.base64}
        mimeType={md.mimeType}
        fileName={md.fileName}
        openMediaPreview={() => openMediaPreview(msg)}
      />
    );
  }

  if (msg.type === "VIDEO") {
    return (
      <VideoMessage
        msgId={msg._id}
        fileName={md?.fileName || "video.mp4"}
        isVideoNote={!!(msg as any).metadata?.isVideoNote}
      />
    );
  }

  if (msg.type === "DOCUMENT" && md) {
    return (
      <FileMessage
        base64={md.base64}
        mimeType={md.mimeType}
        fileName={md.fileName}
      />
    );
  }

  if (!md && (msg as any).hasMedia && ["IMAGE", "AUDIO", "VIDEO", "DOCUMENT"].includes(msg.type)) {
    return (
      <LazyMedia
        messageId={msg._id}
        type={msg.type as "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT"}
        mediaCache={mediaCache}
        batchLoaded={mediaBatchLoaded}
        playingAudioId={playingAudioId}
        toggleAudio={toggleAudio}
        onPreview={(b64, mime, fname) => {
          const url = isTiffMime(mime) ? (tiffBase64ToPngDataUrl(b64) || `data:${mime};base64,${b64}`) : `data:${mime};base64,${b64}`;
          setPreviewMedia({ url, type: msg.type, name: fname });
        }}
      />
    );
  }

  return null;
}
