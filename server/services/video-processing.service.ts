import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { PROBE_TIMEOUT_MS, TRANSCODE_TIMEOUT_MS, FASTSTART_TIMEOUT_MS } from "../lib/constants/limits";

function log(msg: string) {
  console.log(`[video-processing] ${msg}`);
}

async function probeCodecs(inputPath: string): Promise<{ videoCodec: string; audioCodec: string; hasMoovAtStart: boolean }> {
  return new Promise((resolve) => {
    execFile("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      inputPath,
    ], { timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
      if (err) {
        resolve({ videoCodec: "unknown", audioCodec: "unknown", hasMoovAtStart: false });
        return;
      }
      try {
        const info = JSON.parse(stdout);
        const streams = info.streams || [];
        const videoStream = streams.find((s: any) => s.codec_type === "video");
        const audioStream = streams.find((s: any) => s.codec_type === "audio");
        const videoCodec = videoStream?.codec_name || "unknown";
        const audioCodec = audioStream?.codec_name || "none";
        resolve({ videoCodec, audioCodec, hasMoovAtStart: false });
      } catch {
        resolve({ videoCodec: "unknown", audioCodec: "unknown", hasMoovAtStart: false });
      }
    });
  });
}

export async function processVideoForBrowserCompat(
  inputBuffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string; wasTranscoded: boolean }> {
  const isVideo = mimeType.startsWith("video/");
  if (!isVideo) {
    return { buffer: inputBuffer, mimeType, wasTranscoded: false };
  }

  const tmpId = randomBytes(8).toString("hex");
  const tmpDir = tmpdir();
  const inputPath = join(tmpDir, `ffmpeg_in_${tmpId}.mp4`);
  const outputPath = join(tmpDir, `ffmpeg_out_${tmpId}.mp4`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    const probe = await probeCodecs(inputPath);
    log(`Probe: video=${probe.videoCodec}, audio=${probe.audioCodec}, size=${(inputBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    const needsVideoTranscode = probe.videoCodec !== "h264";
    const needsAudioTranscode = probe.audioCodec !== "aac" && probe.audioCodec !== "none";

    const args: string[] = [
      "-i", inputPath,
      "-y",
    ];

    if (needsVideoTranscode) {
      args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
      log(`Transcoding video from ${probe.videoCodec} to H.264`);
    } else {
      args.push("-c:v", "copy");
    }

    if (probe.audioCodec === "none") {
      args.push("-an");
    } else if (needsAudioTranscode) {
      args.push("-c:a", "aac", "-b:a", "128k");
      log(`Transcoding audio from ${probe.audioCodec} to AAC`);
    } else {
      args.push("-c:a", "copy");
    }

    args.push("-movflags", "+faststart");
    args.push("-f", "mp4");
    args.push(outputPath);

    if (!needsVideoTranscode && !needsAudioTranscode) {
      log("Codecs OK (h264/aac), applying faststart only");
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = needsVideoTranscode ? TRANSCODE_TIMEOUT_MS : FASTSTART_TIMEOUT_MS;
      execFile("ffmpeg", args, { timeout }, (err, _stdout, stderr) => {
        if (err) {
          log(`FFmpeg error: ${err.message}`);
          if (stderr) log(`FFmpeg stderr: ${stderr.slice(-500)}`);
          reject(err);
          return;
        }
        resolve();
      });
    });

    const outputBuffer = await fs.readFile(outputPath);
    const wasTranscoded = needsVideoTranscode || needsAudioTranscode;
    log(`Done: ${wasTranscoded ? "transcoded" : "faststart applied"}, ${(inputBuffer.length / 1024 / 1024).toFixed(2)}MB → ${(outputBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    return { buffer: outputBuffer, mimeType: "video/mp4", wasTranscoded };
  } catch (err: any) {
    log(`FFmpeg processing failed, using original: ${err.message}`);
    return { buffer: inputBuffer, mimeType, wasTranscoded: false };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
