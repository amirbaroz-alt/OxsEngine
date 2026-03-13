import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Search, Download, ExternalLink, X, FileText, Video, RefreshCw,
  ImageIcon, Mic, Play, Pause,
} from "lucide-react";
import { isTiffMime, tiffBase64ToPngDataUrl, base64ToBlob, base64ToUint8Array } from "./helpers";
import type { MediaCache } from "./types";

export const TiffImage = memo(function TiffImage({ base64, mimeType, alt, className }: { base64: string; mimeType: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (isTiffMime(mimeType)) {
      const url = tiffBase64ToPngDataUrl(base64);
      setSrc(url);
    } else {
      setSrc(`data:${mimeType};base64,${base64}`);
    }
  }, [base64, mimeType]);
  if (!src) return <div className={className + " flex items-center justify-center bg-muted"}><FileText className="h-8 w-8 text-muted-foreground" /></div>;
  return <img src={src} alt={alt} className={className} />;
});

export function MediaActions({ base64, mimeType, fileName, onPreview }: { base64: string; mimeType: string; fileName?: string; onPreview?: () => void }) {
  const { t } = useTranslation();

  const download = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = base64ToBlob(base64, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "file";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [base64, mimeType, fileName]);

  const openNewTab = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = base64ToBlob(base64, mimeType);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, [base64, mimeType]);

  return (
    <div className="flex items-center gap-2 mt-1">
      {onPreview && (
        <button
          className="text-xs flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          title={t("inbox.preview", "Preview")}
          data-testid="button-media-preview"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        className="text-xs flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors cursor-pointer"
        onClick={openNewTab}
        title={t("inbox.openNewTab", "Open in new tab")}
        data-testid="button-media-newtab"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <button
        className="text-xs flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors cursor-pointer"
        onClick={download}
        title={t("inbox.download", "Download")}
        data-testid="button-media-download"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function PdfCanvasViewer({ base64, fileName }: { base64: string; fileName: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const PDFJS_VERSION = "3.11.174";
    const CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

    function loadScript(src: string): Promise<void> {
      return new Promise((resolve, reject) => {
        if ((window as any).pdfjsLib) { resolve(); return; }
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { resolve(); return; }
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load pdf.js"));
        document.head.appendChild(s);
      });
    }

    async function renderPdf() {
      try {
        await loadScript(`${CDN_BASE}/pdf.min.js`);
        const lib = (window as any).pdfjsLib;
        if (!lib) throw new Error("pdf.js not available");
        lib.GlobalWorkerOptions.workerSrc = `${CDN_BASE}/pdf.worker.min.js`;
        const data = base64ToUint8Array(base64);
        const pdf = await lib.getDocument({ data }).promise;
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        const totalPages = pdf.numPages;
        for (let i = 1; i <= totalPages; i++) {
          const page = await pdf.getPage(i);
          const containerWidth = containerRef.current ? containerRef.current.clientWidth - 16 : 600;
          const defaultViewport = page.getViewport({ scale: 1 });
          const scale = Math.max(containerWidth / defaultViewport.width, 1);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          if (i > 1) canvas.style.marginTop = "8px";
          containerRef.current?.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setLoading(false);
      } catch (err: any) {
        console.error("PDF render error:", err);
        if (!cancelled) {
          setError(err?.message || "Failed to render PDF");
          setLoading(false);
        }
      }
    }
    renderPdf();
    return () => { cancelled = true; };
  }, [base64]);

  if (error) return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 h-full">
      <FileText className="h-16 w-16 text-muted-foreground" />
      <span className="text-foreground">{fileName}</span>
      <span className="text-sm text-muted-foreground">{error}</span>
    </div>
  );

  return (
    <div className="relative h-full overflow-auto bg-neutral-100 dark:bg-neutral-900 p-2">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
}

export function DocumentPreview({ base64, mimeType, fileName, downloadLabel }: { base64: string; mimeType: string; fileName: string; downloadLabel: string }) {
  const [showPreview, setShowPreview] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [tiffSrc, setTiffSrc] = useState<string | null>(null);
  const isPdf = mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const isTiff = isTiffMime(mimeType) || /\.tiff?$/i.test(fileName);
  const isImage = isTiff || /^image\//i.test(mimeType) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);

  const openPreview = useCallback(() => {
    if (!tiffSrc && isTiff) {
      const converted = tiffBase64ToPngDataUrl(base64);
      if (converted) setTiffSrc(converted);
    }
    setShowPreview(true);
  }, [base64, mimeType, isTiff, tiffSrc]);

  const openInNewTab = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const blob = base64ToBlob(base64, mimeType || "application/octet-stream");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, [base64, mimeType]);

  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  const dataUrl = `data:${mimeType};base64,${base64}`;
  const previewImageSrc = isTiff ? tiffSrc : (isImage ? dataUrl : null);

  return (
    <>
      <div className="flex items-center gap-2 p-2 rounded-md bg-black/5 dark:bg-white/5 mt-1">
        <FileText className="h-5 w-5 shrink-0" />
        <span className="text-sm flex-1 truncate">{fileName}</span>
        <button
          className="shrink-0 cursor-pointer text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
          onClick={openPreview}
          title="Preview"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          className="shrink-0 cursor-pointer text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
          onClick={openInNewTab}
          title="Open in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <a
          href={dataUrl}
          download={fileName || "file"}
          className="shrink-0 text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors"
          onClick={(e) => e.stopPropagation()}
          title="Download"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
      {showPreview && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="relative bg-card rounded-md shadow-2xl border overflow-hidden flex flex-col"
            style={{ width: "min(720px, 90vw)", height: "min(80vh, 800px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 p-3 border-b">
              <span className="text-sm font-medium truncate flex-1">{fileName}</span>
              <div className="flex items-center gap-1">
                <button onClick={openInNewTab} title="Open in new tab" className="text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors">
                  <ExternalLink className="h-4 w-4" />
                </button>
                <a href={dataUrl} download={fileName || "file"} onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon">
                    <Download className="h-4 w-4" />
                  </Button>
                </a>
                <Button variant="ghost" size="icon" onClick={() => setShowPreview(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {isPdf ? (
                <PdfCanvasViewer base64={base64} fileName={fileName} />
              ) : previewImageSrc ? (
                <div className="flex items-center justify-center h-full p-4 bg-black/5 dark:bg-white/5">
                  <img
                    src={previewImageSrc}
                    alt={fileName}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 p-8 h-full">
                  <FileText className="h-16 w-16 text-muted-foreground" />
                  <span className="text-foreground">{fileName}</span>
                  <a href={dataUrl} download={fileName || "file"} className="inline-flex">
                    <Button variant="default">
                      <Download className="h-4 w-4 me-2" />
                      {downloadLabel}
                    </Button>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function VideoUnsupportedFallback({ base64, mimeType, fileName, messageId }: { base64: string; mimeType: string; fileName: string; messageId: string }) {
  const { t } = useTranslation();

  const downloadFile = useCallback(() => {
    const blob = base64ToBlob(base64, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [base64, mimeType, fileName]);

  const openInTab = useCallback(() => {
    const blob = base64ToBlob(base64, mimeType);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, [base64, mimeType]);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-md bg-black/5 dark:bg-white/5">
      <div className="flex items-center gap-2">
        <Video className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">{t("inbox.videoFormatUnsupported", "Video format not supported in browser")}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={downloadFile}
          className="w-fit"
          data-testid={`button-download-video-${messageId}`}
        >
          <Download className="h-3 w-3 me-1" />
          {t("inbox.downloadToPlay", "Download to play on computer")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={openInTab}
          className="w-fit"
          data-testid={`button-opentab-video-${messageId}`}
        >
          <ExternalLink className="h-3 w-3 me-1" />
          {t("inbox.openNewTab", "Open in new tab")}
        </Button>
      </div>
    </div>
  );
}

export function PasteImagePreview({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!src) return null;
  return (
    <div className="p-4 flex items-center justify-center bg-muted/30">
      <img src={src} alt="Preview" className="max-h-[400px] max-w-full object-contain rounded-lg" data-testid="img-paste-preview" />
    </div>
  );
}

export function useInView(rootMargin = "200px") {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    if (!node || inView) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { rootMargin });
    obs.observe(node);
    observerRef.current = obs;
  }, [inView, rootMargin]);
  useEffect(() => { return () => { observerRef.current?.disconnect(); }; }, []);
  return { ref, inView };
}

export function InlineVideo({ messageId, fileName, onPreview, isVideoNote }: { base64?: string; mimeType?: string; fileName: string; messageId: string; onPreview?: () => void; streamUrl?: string; isVideoNote?: boolean }) {
  const { ref: viewRef, inView } = useInView();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    setBlobUrl(null);
    setLoading(true);
    setError(false);
    setAuthError(false);
  }, [messageId]);

  useEffect(() => {
    if (!inView) return;
    let revoked = false;
    let retryCount = 0;
    const token = localStorage.getItem("auth_token") || "";
    const attemptFetch = () => {
      fetch(`/api/inbox/messages/${messageId}/media/stream`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          if (res.status === 202 && retryCount < 10) {
            retryCount++;
            setTimeout(() => { if (!revoked) attemptFetch(); }, 3000);
            return;
          }
          if (!res.ok) {
            let detail = "";
            let errorCode = "";
            try { const j = await res.json(); detail = j.message || JSON.stringify(j); errorCode = j.error || ""; } catch {}
            console.error(`[media-stream] ${res.status} for message ${messageId}: ${detail}`);
            if (errorCode === "token_expired") {
              if (!revoked) { setAuthError(true); setError(true); setLoading(false); }
              return;
            }
            throw new Error(`${res.status}: ${detail}`);
          }
          return res.blob();
        })
        .then((blob) => {
          if (!blob || revoked) return;
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
          setLoading(false);
        })
        .catch((err) => {
          console.error(`[media-stream] Error loading media for ${messageId}:`, err.message);
          if (!revoked) { setError(true); setLoading(false); }
        });
    };
    attemptFetch();
    return () => { revoked = true; };
  }, [messageId, inView]);

  useEffect(() => {
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [blobUrl]);

  const handleDownload = useCallback(() => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    a.click();
  }, [blobUrl, fileName]);

  const handleOpenNewTab = useCallback(() => {
    if (!blobUrl) return;
    window.open(blobUrl, "_blank");
  }, [blobUrl]);

  const circularCls = isVideoNote ? "w-[200px] h-[200px] rounded-full" : "w-[240px] aspect-video rounded-md";

  if (!inView || loading) {
    return (
      <div ref={viewRef} className={`mt-1 ${circularCls} bg-black/10 dark:bg-white/10 flex items-center justify-center overflow-hidden`}>
        {inView ? <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /> : <Video className="h-4 w-4 text-muted-foreground" />}
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div ref={viewRef} className="flex flex-col gap-2 p-3 rounded-md bg-black/5 dark:bg-white/5">
        <div className="flex items-center gap-2">
          <Video className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{fileName}</span>
        </div>
        {authError ? (
          <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-media-auth-error">Media unavailable — Please refresh channel connection</span>
        ) : (
          <span className="text-xs text-muted-foreground">Video unavailable</span>
        )}
      </div>
    );
  }

  return (
    <div ref={viewRef} className="mt-1">
      <div className={onPreview ? "cursor-pointer" : undefined} onClick={onPreview} data-testid={onPreview ? `button-preview-video-${messageId}` : undefined}>
        <div className={`${circularCls} overflow-hidden bg-black/10 dark:bg-white/10`}>
          <video
            src={blobUrl}
            className={`w-full h-full ${isVideoNote ? "object-cover" : "object-contain"} ${isVideoNote ? "rounded-full" : "rounded-md"}`}
            controls
            preload="metadata"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button onClick={handleDownload} className="text-xs flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors" data-testid="button-media-download">
          <Download className="h-3.5 w-3.5" />
        </button>
        <button onClick={handleOpenNewTab} className="text-xs flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 transition-colors" data-testid="button-media-newtab">
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function LazyMedia({ messageId, type, mediaCache, batchLoaded, onPreview, playingAudioId, toggleAudio }: {
  messageId: string;
  type: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";
  mediaCache: MediaCache;
  batchLoaded?: boolean;
  onPreview?: (base64: string, mimeType: string, fileName: string) => void;
  playingAudioId?: string | null;
  toggleAudio?: (id: string, base64: string, mime: string) => void;
}) {
  const { t } = useTranslation();
  const { ref: viewRef, inView } = useInView();
  const media = mediaCache[messageId] || null;
  const [retryMedia, setRetryMedia] = useState<{ base64: string; mimeType: string; fileName?: string; streamUrl?: string } | null>(null);
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_AUTO_RETRIES = 6;

  const fetchFromStream = useCallback(async (): Promise<{ base64: string; mimeType: string; fileName?: string } | "pending" | "token_expired"> => {
    const token = localStorage.getItem("auth_token") || "";
    const streamRes = await fetch(`/api/inbox/messages/${messageId}/media/stream`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (streamRes.status === 202) return "pending";
    if (streamRes.status === 404) {
      try {
        const errData = await streamRes.json();
        if (errData.error === "token_expired") return "token_expired";
      } catch {}
      throw new Error("Stream 404");
    }
    if (!streamRes.ok) throw new Error(`Stream ${streamRes.status}`);
    const blob = await streamRes.blob();
    const reader = new FileReader();
    const b64 = await new Promise<string>((resolve) => {
      reader.onloadend = () => resolve((reader.result as string).split(",")[1] || "");
      reader.readAsDataURL(blob);
    });
    return { base64: b64, mimeType: blob.type || "image/png" };
  }, [messageId]);

  useEffect(() => {
    if (media || retryMedia || !batchLoaded || type === "VIDEO" || autoRetryCount >= MAX_AUTO_RETRIES) return;
    autoRetryTimerRef.current = setTimeout(async () => {
      try {
        const result = await fetchFromStream();
        if (result === "token_expired") {
          setAutoRetryCount(MAX_AUTO_RETRIES);
          setRetryFailed(true);
        } else if (result === "pending") {
          setAutoRetryCount((c) => c + 1);
        } else {
          setRetryMedia(result);
        }
      } catch {
        setAutoRetryCount((c) => c + 1);
      }
    }, autoRetryCount === 0 ? 2000 : 3000);
    return () => { if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current); };
  }, [media, retryMedia, batchLoaded, type, autoRetryCount, fetchFromStream]);

  const doRetry = useCallback(async () => {
    if (type === "VIDEO") {
      setRetryMedia({ base64: "", mimeType: "video/mp4", fileName: "video.mp4" });
      return;
    }
    setRetryLoading(true);
    setRetryFailed(false);
    try {
      const result = await fetchFromStream();
      if (typeof result === "object") {
        setRetryMedia(result);
      } else {
        setRetryFailed(true);
      }
    } catch {
      setRetryFailed(true);
    } finally {
      setRetryLoading(false);
    }
  }, [messageId, type, fetchFromStream]);

  const resolved = media || retryMedia;

  const icon = type === "IMAGE" ? <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
    : type === "AUDIO" ? <Mic className="h-5 w-5 shrink-0 text-muted-foreground" />
    : type === "VIDEO" ? <Video className="h-5 w-5 shrink-0 text-muted-foreground" />
    : <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />;

  if (!inView) {
    return (
      <div ref={viewRef} className="mt-1 flex items-center gap-2 p-3 rounded-md bg-black/5 dark:bg-white/5 min-h-[48px]" data-testid={`lazy-media-${messageId}`}>
        {icon}
      </div>
    );
  }

  if (resolved) {
    if (type === "IMAGE") return (
      <div ref={viewRef} className="mt-1">
        <div className="cursor-pointer" onClick={() => onPreview?.(resolved.base64, resolved.mimeType, resolved.fileName || "image")} data-testid={`button-preview-image-${messageId}`}>
          <TiffImage base64={resolved.base64} mimeType={resolved.mimeType || "image/png"} alt={resolved.fileName || "image"} className="max-w-[240px] max-h-[240px] rounded-md object-cover" />
        </div>
        <MediaActions base64={resolved.base64} mimeType={resolved.mimeType || "image/png"} fileName={resolved.fileName || "image.png"} onPreview={() => onPreview?.(resolved.base64, resolved.mimeType, resolved.fileName || "image")} />
      </div>
    );
    if (type === "AUDIO") return (
      <div ref={viewRef}>
        <div className="flex items-center gap-2 py-1">
          <Button size="icon" variant="ghost" onClick={() => toggleAudio?.(messageId, resolved.base64, resolved.mimeType || "audio/webm")} data-testid={`button-play-audio-${messageId}`}>
            {playingAudioId === messageId ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <div className="flex-1 h-1 bg-current opacity-20 rounded-full" />
          <span className="text-xs opacity-60">{resolved.fileName || t("inbox.voiceMessage", "Voice")}</span>
        </div>
        <MediaActions base64={resolved.base64} mimeType={resolved.mimeType || "audio/webm"} fileName={resolved.fileName || "audio.webm"} />
      </div>
    );
    if (type === "VIDEO") return (
      <div ref={viewRef}>
        <InlineVideo fileName={resolved.fileName || "video.mp4"} messageId={messageId} />
      </div>
    );
    if (type === "DOCUMENT") return (
      <div ref={viewRef}>
        <DocumentPreview base64={resolved.base64} mimeType={resolved.mimeType || "application/octet-stream"} fileName={resolved.fileName || t("inbox.document", "Document")} downloadLabel={t("inbox.download", "Download")} />
      </div>
    );
  }

  if (batchLoaded) {
    const isAutoRetrying = autoRetryCount > 0 && autoRetryCount < MAX_AUTO_RETRIES && !retryFailed;
    const showLoading = retryLoading || isAutoRetrying;
    const showUnavailable = !showLoading && (retryFailed || autoRetryCount >= MAX_AUTO_RETRIES);
    return (
      <div ref={viewRef} className="mt-1 flex items-center gap-2 p-3 rounded-md bg-black/5 dark:bg-white/5" data-testid={`lazy-media-unavailable-${messageId}`}>
        {icon}
        <span className="text-sm text-muted-foreground">
          {showLoading ? t("inbox.loadingMedia", "Loading...") : showUnavailable ? t("inbox.mediaUnavailable", "Media unavailable") : t("inbox.loadingMedia", "Loading...")}
        </span>
        {showUnavailable && !retryLoading && (
          <Button size="sm" variant="ghost" onClick={doRetry} data-testid={`button-retry-media-${messageId}`}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
        {showLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  return (
    <div ref={viewRef} className="mt-1 flex items-center gap-2 p-3 rounded-md bg-black/5 dark:bg-white/5" data-testid={`lazy-media-${messageId}`}>
      {icon}
      <span className="text-sm text-muted-foreground animate-pulse">{t("inbox.loadingMedia", "Loading...")}</span>
    </div>
  );
}
