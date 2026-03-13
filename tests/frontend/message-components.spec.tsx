/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

jest.mock("../../client/src/components/inbox/media-components", () => ({
  TiffImage: ({ base64, mimeType, alt, className }: any) => (
    <img
      data-testid="tiff-image"
      src={`data:${mimeType};base64,${base64}`}
      alt={alt}
      className={className}
    />
  ),
  MediaActions: ({ base64, mimeType, fileName, onPreview }: any) => (
    <div data-testid="media-actions">
      <button data-testid="button-download" aria-label={`Download ${fileName}`}>
        Download {fileName}
      </button>
      {onPreview && (
        <button data-testid="button-preview" onClick={onPreview}>
          Preview
        </button>
      )}
    </div>
  ),
  InlineVideo: ({ messageId, fileName, isVideoNote }: any) => (
    <div data-testid={`inline-video-${messageId}`} data-filename={fileName} data-video-note={isVideoNote}>
      Video: {fileName}
    </div>
  ),
  DocumentPreview: ({ base64, mimeType, fileName, downloadLabel }: any) => (
    <div data-testid="document-preview">
      <span data-testid="text-filename">{fileName}</span>
      <span data-testid="text-mimetype">{mimeType}</span>
      <button data-testid="button-download-doc" aria-label={`${downloadLabel} ${fileName}`}>
        {downloadLabel}
      </button>
    </div>
  ),
  LazyMedia: () => <div data-testid="lazy-media" />,
}));

jest.mock("../../client/src/components/inbox/helpers", () => ({
  isTiffMime: (mime?: string) => mime?.includes("tiff") || false,
  tiffBase64ToPngDataUrl: (b64: string) => `data:image/png;base64,${b64}`,
}));

jest.mock("../../client/src/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

jest.mock("lucide-react", () => ({
  Play: () => <span data-testid="icon-play">▶</span>,
  Pause: () => <span data-testid="icon-pause">⏸</span>,
}));

import { ImageMessage } from "../../client/src/components/inbox/messages/ImageMessage";
import { VideoMessage } from "../../client/src/components/inbox/messages/VideoMessage";
import { AudioMessage } from "../../client/src/components/inbox/messages/AudioMessage";
import { FileMessage } from "../../client/src/components/inbox/messages/FileMessage";
import { LocationMessage } from "../../client/src/components/inbox/messages/LocationMessage";
import { MessageMediaBlock } from "../../client/src/components/inbox/messages/MessageMediaBlock";

describe("ImageMessage", () => {
  const defaultProps = {
    msgId: "msg_img_1",
    isInbound: true,
    base64: "aW1hZ2VkYXRh",
    mimeType: "image/jpeg",
    fileName: "photo.jpg",
    openMediaPreview: jest.fn(),
  };

  it("should render the image with correct alt text", () => {
    render(<ImageMessage {...defaultProps} />);
    const img = screen.getByTestId("tiff-image");
    expect(img).toHaveAttribute("alt", "photo.jpg");
  });

  it("should render with src containing base64 data", () => {
    render(<ImageMessage {...defaultProps} />);
    const img = screen.getByTestId("tiff-image");
    expect(img).toHaveAttribute("src", expect.stringContaining("base64"));
  });

  it("should default mimeType to image/png when empty", () => {
    render(<ImageMessage {...defaultProps} mimeType="" />);
    const img = screen.getByTestId("tiff-image");
    expect(img).toHaveAttribute("src", expect.stringContaining("image/png"));
  });

  it("should default fileName to image.png when not provided", () => {
    render(<ImageMessage {...defaultProps} fileName={undefined} />);
    const img = screen.getByTestId("tiff-image");
    expect(img).toHaveAttribute("alt", "image.png");
  });

  it("should call openMediaPreview when image is clicked", () => {
    render(<ImageMessage {...defaultProps} />);
    const clickable = screen.getByTestId(`button-preview-image-${defaultProps.msgId}`);
    fireEvent.click(clickable);
    expect(defaultProps.openMediaPreview).toHaveBeenCalledTimes(1);
  });

  it("should render MediaActions with download capability", () => {
    render(<ImageMessage {...defaultProps} />);
    const actions = screen.getByTestId("media-actions");
    expect(actions).toBeInTheDocument();
    const downloadBtn = screen.getByTestId("button-download");
    expect(downloadBtn).toHaveAttribute("aria-label", "Download photo.jpg");
  });

  it("should use correct data-testid for outbound messages", () => {
    render(<ImageMessage {...defaultProps} isInbound={false} />);
    expect(screen.getByTestId(`button-preview-image-out-${defaultProps.msgId}`)).toBeInTheDocument();
  });
});

describe("VideoMessage", () => {
  it("should render InlineVideo with correct props", () => {
    render(<VideoMessage msgId="msg_vid_1" fileName="clip.mp4" isVideoNote={false} />);
    const video = screen.getByTestId("inline-video-msg_vid_1");
    expect(video).toHaveAttribute("data-filename", "clip.mp4");
    expect(video).toHaveAttribute("data-video-note", "false");
  });

  it("should pass isVideoNote=true for video notes", () => {
    render(<VideoMessage msgId="msg_vid_2" fileName="note.mp4" isVideoNote={true} />);
    const video = screen.getByTestId("inline-video-msg_vid_2");
    expect(video).toHaveAttribute("data-video-note", "true");
  });
});

describe("AudioMessage", () => {
  const defaultProps = {
    msgId: "msg_aud_1",
    isInbound: true,
    base64: "YXVkaW9kYXRh",
    mimeType: "audio/ogg",
    fileName: "voice.ogg",
    playingAudioId: null as string | null,
    toggleAudio: jest.fn(),
  };

  it("should render play button when not playing", () => {
    render(<AudioMessage {...defaultProps} />);
    expect(screen.getByTestId("icon-play")).toBeInTheDocument();
  });

  it("should render pause button when playing this message", () => {
    render(<AudioMessage {...defaultProps} playingAudioId="msg_aud_1" />);
    expect(screen.getByTestId("icon-pause")).toBeInTheDocument();
  });

  it("should call toggleAudio with correct args when play/pause clicked", () => {
    const toggleAudio = jest.fn();
    render(<AudioMessage {...defaultProps} toggleAudio={toggleAudio} />);
    const playBtn = screen.getByTestId(`button-play-audio-${defaultProps.msgId}`);
    fireEvent.click(playBtn);
    expect(toggleAudio).toHaveBeenCalledWith("msg_aud_1", "YXVkaW9kYXRh", "audio/ogg");
  });

  it("should default mimeType to audio/webm when empty", () => {
    const toggleAudio = jest.fn();
    render(<AudioMessage {...defaultProps} mimeType="" toggleAudio={toggleAudio} />);
    const playBtn = screen.getByTestId(`button-play-audio-${defaultProps.msgId}`);
    fireEvent.click(playBtn);
    expect(toggleAudio).toHaveBeenCalledWith("msg_aud_1", "YXVkaW9kYXRh", "audio/webm");
  });

  it("should display fileName when provided", () => {
    render(<AudioMessage {...defaultProps} />);
    expect(screen.getByText("voice.ogg")).toBeInTheDocument();
  });

  it("should display fallback text when no fileName", () => {
    render(<AudioMessage {...defaultProps} fileName={undefined} />);
    expect(screen.getByText("Voice")).toBeInTheDocument();
  });

  it("should render MediaActions with download capability", () => {
    render(<AudioMessage {...defaultProps} />);
    expect(screen.getByTestId("media-actions")).toBeInTheDocument();
  });

  it("should use correct testid for outbound audio", () => {
    render(<AudioMessage {...defaultProps} isInbound={false} />);
    expect(screen.getByTestId(`button-play-audio-out-${defaultProps.msgId}`)).toBeInTheDocument();
  });
});

describe("FileMessage", () => {
  it("should render DocumentPreview with correct props", () => {
    render(<FileMessage base64="cGRm" mimeType="application/pdf" fileName="report.pdf" />);
    expect(screen.getByTestId("text-filename")).toHaveTextContent("report.pdf");
    expect(screen.getByTestId("text-mimetype")).toHaveTextContent("application/pdf");
  });

  it("should default mimeType to application/octet-stream", () => {
    render(<FileMessage base64="data" mimeType="" />);
    expect(screen.getByTestId("text-mimetype")).toHaveTextContent("application/octet-stream");
  });

  it("should default fileName using translation fallback", () => {
    render(<FileMessage base64="data" mimeType="text/plain" />);
    expect(screen.getByTestId("text-filename")).toHaveTextContent("Document");
  });

  it("should have a download button with accessible label", () => {
    render(<FileMessage base64="data" mimeType="application/pdf" fileName="invoice.pdf" />);
    const btn = screen.getByTestId("button-download-doc");
    expect(btn).toHaveAttribute("aria-label", "Download invoice.pdf");
  });
});

describe("LocationMessage", () => {
  it("should render a Google Maps link with correct coordinates", () => {
    render(
      <LocationMessage
        metadata={{ latitude: 32.0853, longitude: 34.7818, name: "Tel Aviv", address: "Tel Aviv-Yafo, Israel" }}
        content=""
      />
    );
    const link = screen.getByTestId("link-location-map");
    expect(link).toHaveAttribute("href", "https://www.google.com/maps?q=32.0853,34.7818");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("should display location name as link text", () => {
    render(
      <LocationMessage
        metadata={{ latitude: 32.0853, longitude: 34.7818, name: "Tel Aviv", address: "Israel" }}
        content=""
      />
    );
    expect(screen.getByTestId("link-location-map")).toHaveTextContent("Tel Aviv");
  });

  it("should display address below name when both present", () => {
    render(
      <LocationMessage
        metadata={{ latitude: 32.0853, longitude: 34.7818, name: "Tel Aviv", address: "Tel Aviv-Yafo, Israel" }}
        content=""
      />
    );
    expect(screen.getByText("Tel Aviv-Yafo, Israel")).toBeInTheDocument();
  });

  it("should fall back to address as link text when name is missing", () => {
    render(
      <LocationMessage
        metadata={{ latitude: 32.0853, longitude: 34.7818, address: "Tel Aviv-Yafo" }}
        content=""
      />
    );
    expect(screen.getByTestId("link-location-map")).toHaveTextContent("Tel Aviv-Yafo");
  });

  it("should fall back to coordinates as link text when name and address are missing", () => {
    render(
      <LocationMessage
        metadata={{ latitude: 32.0853, longitude: 34.7818 }}
        content=""
      />
    );
    expect(screen.getByTestId("link-location-map")).toHaveTextContent("32.0853, 34.7818");
  });

  it("should render content text when no coordinates are provided", () => {
    render(<LocationMessage metadata={{}} content="Shared location" />);
    expect(screen.getByText("Shared location")).toBeInTheDocument();
  });

  it("should render fallback text when no metadata and no content", () => {
    render(<LocationMessage content="" />);
    expect(screen.getByText("inbox.mediaLocation")).toBeInTheDocument();
  });

  it("should handle zero coordinates (equator/prime meridian)", () => {
    render(
      <LocationMessage
        metadata={{ latitude: 0, longitude: 0 }}
        content=""
      />
    );
    expect(screen.queryByTestId("link-location-map")).not.toBeInTheDocument();
    expect(screen.getByText("inbox.mediaLocation")).toBeInTheDocument();
  });
});

describe("MessageMediaBlock", () => {
  const baseMsgProps = {
    playingAudioId: null as string | null,
    toggleAudio: jest.fn(),
    openMediaPreview: jest.fn(),
    mediaCache: {} as any,
    mediaBatchLoaded: true,
    setPreviewMedia: jest.fn(),
  };

  it("should render AudioMessage for AUDIO type", () => {
    const msg = { _id: "a1", type: "AUDIO", direction: "INBOUND" } as any;
    const mediaData = { base64: "audio", mimeType: "audio/ogg" };
    render(<MessageMediaBlock msg={msg} mediaData={mediaData} {...baseMsgProps} />);
    expect(screen.getByTestId("icon-play")).toBeInTheDocument();
  });

  it("should render ImageMessage for IMAGE type", () => {
    const msg = { _id: "i1", type: "IMAGE", direction: "INBOUND" } as any;
    const mediaData = { base64: "img", mimeType: "image/jpeg" };
    render(<MessageMediaBlock msg={msg} mediaData={mediaData} {...baseMsgProps} />);
    expect(screen.getByTestId("tiff-image")).toBeInTheDocument();
  });

  it("should render VideoMessage for VIDEO type", () => {
    const msg = { _id: "v1", type: "VIDEO", direction: "INBOUND" } as any;
    render(<MessageMediaBlock msg={msg} mediaData={{ base64: "vid", mimeType: "video/mp4", fileName: "clip.mp4" }} {...baseMsgProps} />);
    expect(screen.getByTestId("inline-video-v1")).toBeInTheDocument();
  });

  it("should render FileMessage for DOCUMENT type", () => {
    const msg = { _id: "d1", type: "DOCUMENT", direction: "INBOUND" } as any;
    const mediaData = { base64: "doc", mimeType: "application/pdf", fileName: "file.pdf" };
    render(<MessageMediaBlock msg={msg} mediaData={mediaData} {...baseMsgProps} />);
    expect(screen.getByTestId("document-preview")).toBeInTheDocument();
  });

  it("should render LazyMedia when media is not loaded and hasMedia is true", () => {
    const msg = { _id: "l1", type: "IMAGE", direction: "INBOUND", hasMedia: true } as any;
    render(<MessageMediaBlock msg={msg} mediaData={null} {...baseMsgProps} />);
    expect(screen.getByTestId("lazy-media")).toBeInTheDocument();
  });

  it("should return null when no media and hasMedia is false", () => {
    const msg = { _id: "n1", type: "IMAGE", direction: "INBOUND" } as any;
    const { container } = render(<MessageMediaBlock msg={msg} mediaData={null} {...baseMsgProps} />);
    expect(container.innerHTML).toBe("");
  });

  it("should use default fileName for VIDEO when mediaData is null", () => {
    const msg = { _id: "v2", type: "VIDEO", direction: "INBOUND" } as any;
    render(<MessageMediaBlock msg={msg} mediaData={null} {...baseMsgProps} />);
    expect(screen.getByTestId("inline-video-v2")).toHaveAttribute("data-filename", "video.mp4");
  });
});
