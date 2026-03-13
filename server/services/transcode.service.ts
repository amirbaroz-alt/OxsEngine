import { execFile } from "child_process";
import { writeFile, unlink, stat, readdir } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const WHATSAPP_VIDEO_LIMIT = 16 * 1024 * 1024;
const COMPRESSION_TARGET = 15.5 * 1024 * 1024;
const DOCUMENT_LIMIT = 100 * 1024 * 1024;
const MIN_VIABLE_BITRATE_KBPS = 200;

export interface TranscodeResultPart {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  size: number;
}

export interface TranscodeResult {
  parts: TranscodeResultPart[];
  originalSize: number;
  sendAsDocument: boolean;
  totalParts: number;
}

const VIDEO_TRANSCODE_TYPES = new Set([
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/webm",
  "video/3gpp",
  "video/mp4",
]);

const AUDIO_TRANSCODE_TYPES = new Set([
  "audio/webm",
  "audio/mpeg",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
]);

export function needsTranscoding(mimeType: string): boolean {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return VIDEO_TRANSCODE_TYPES.has(base) || AUDIO_TRANSCODE_TYPES.has(base);
}

function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

function runFFmpeg(args: string[], timeoutMs = 120_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`FFmpeg failed: ${error.message}\nstderr: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { timeout: 15_000 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`ffprobe failed: ${error.message}`));
        } else {
          const dur = parseFloat(stdout.trim());
          resolve(isNaN(dur) ? 0 : dur);
        }
      }
    );
  });
}

async function splitVideo(inputPath: string, duration: number, numParts: number, id: string): Promise<string[]> {
  const segmentTime = Math.ceil(duration / numParts);
  const segmentPattern = join("/tmp", `split_${id}_part_%03d.mp4`);

  console.log(`[FFmpeg] Splitting into ${numParts} parts, ~${segmentTime}s each`);

  await runFFmpeg([
    "-i", inputPath, "-y",
    "-f", "segment",
    "-segment_time", `${segmentTime}`,
    "-reset_timestamps", "1",
    "-c", "copy",
    segmentPattern,
  ], 300_000);

  const tmpFiles = await readdir("/tmp");
  const partFiles = tmpFiles
    .filter(f => f.startsWith(`split_${id}_part_`) && f.endsWith(".mp4"))
    .sort()
    .map(f => join("/tmp", f));

  console.log(`[FFmpeg] Split produced ${partFiles.length} part files`);
  return partFiles;
}

export async function transcodeMedia(
  inputBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<TranscodeResult> {
  const baseMime = mimeType.split(";")[0].trim().toLowerCase();
  const id = randomUUID().slice(0, 8);
  const inputExt = fileName.match(/\.([^.]+)$/)?.[1] || "bin";
  const inputPath = join("/tmp", `transcode_in_${id}.${inputExt}`);

  const isVideo = isVideoType(baseMime);
  const outputExt = isVideo ? "mp4" : "ogg";
  const outputPath = join("/tmp", `transcode_out_${id}.${outputExt}`);

  const baseName = fileName.replace(/\.[^.]+$/, "") || `media_${Date.now()}`;

  console.log(`[FFmpeg] Transcoding started for ${isVideo ? "video" : "audio"}: ${fileName} (${baseMime}, ${inputBuffer.length} bytes)`);

  const cleanupPaths: string[] = [inputPath, outputPath];

  try {
    await writeFile(inputPath, inputBuffer);

    if (!isVideo) {
      const ffmpegArgs = [
        "-i", inputPath, "-y",
        "-vn",
        "-c:a", "libopus",
        "-b:a", "64k",
        "-application", "voip",
        "-f", "ogg",
        outputPath,
      ];
      await runFFmpeg(ffmpegArgs);

      const outStat = await stat(outputPath);
      const outputBuffer = readFileSync(outputPath);

      console.log(`[FFmpeg] Result: ${outStat.size} bytes. Mode: audio/ogg; codecs=opus`);

      return {
        parts: [{
          buffer: outputBuffer,
          mimeType: "audio/ogg; codecs=opus",
          fileName: `${baseName}.ogg`,
          size: outStat.size,
        }],
        originalSize: inputBuffer.length,
        sendAsDocument: false,
        totalParts: 1,
      };
    }

    let duration = 0;
    try {
      duration = await probeDuration(inputPath);
    } catch (e: any) {
      console.warn(`[FFmpeg] Could not probe duration: ${e.message}. Will attempt compression anyway.`);
    }

    let sendAsDocument = false;

    if (duration > 0) {
      const audioBitrateKbps = 96;
      const overheadFactor = 0.92;
      const totalBitrateKbps = Math.floor((COMPRESSION_TARGET * 8 * overheadFactor) / (duration * 1000));
      const videoBitrateKbps = totalBitrateKbps - audioBitrateKbps;
      console.log(`[FFmpeg] Duration: ${duration.toFixed(1)}s, total bitrate: ${totalBitrateKbps}kbps, video bitrate: ${videoBitrateKbps}kbps`);

      if (videoBitrateKbps < MIN_VIABLE_BITRATE_KBPS) {
        console.log(`[FFmpeg] Video bitrate ${videoBitrateKbps}kbps < ${MIN_VIABLE_BITRATE_KBPS}kbps minimum. Will send as document.`);
        sendAsDocument = true;
      }
    }

    const ffmpegArgs = ["-i", inputPath, "-y",
      "-vcodec", "libx264",
      "-acodec", "aac",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-preset", "fast",
    ];

    if (!sendAsDocument) {
      ffmpegArgs.push("-fs", `${Math.floor(COMPRESSION_TARGET)}`);
      if (duration > 0) {
        const audioBitrateKbps = 96;
        const overheadFactor = 0.92;
        const videoBitrateKbps = Math.max(100, Math.floor(
          ((COMPRESSION_TARGET * 8 * overheadFactor) / (duration * 1000)) - audioBitrateKbps
        ));
        ffmpegArgs.push("-b:v", `${videoBitrateKbps}k`);
        ffmpegArgs.push("-maxrate", `${Math.floor(videoBitrateKbps * 1.2)}k`);
        ffmpegArgs.push("-bufsize", `${Math.floor(videoBitrateKbps * 2)}k`);
        ffmpegArgs.push("-b:a", "96k");
      } else {
        ffmpegArgs.push("-crf", "28");
      }
    } else {
      ffmpegArgs.push("-crf", "23");
    }

    ffmpegArgs.push("-f", "mp4", outputPath);

    const timeoutMs = sendAsDocument ? 300_000 : 120_000;
    await runFFmpeg(ffmpegArgs, timeoutMs);

    const outStat = await stat(outputPath);

    if (!sendAsDocument && outStat.size > WHATSAPP_VIDEO_LIMIT) {
      console.log(`[FFmpeg] Compressed to ${outStat.size} bytes but still > 16MB. Falling back to document mode.`);
      sendAsDocument = true;
    }

    if (outStat.size <= DOCUMENT_LIMIT) {
      const outputBuffer = readFileSync(outputPath);
      const mode = sendAsDocument ? "document" : "video";
      console.log(`[FFmpeg] Result: ${outStat.size} bytes. Mode: ${mode} (single file)`);

      return {
        parts: [{
          buffer: outputBuffer,
          mimeType: "video/mp4",
          fileName: sendAsDocument ? "video.mp4" : `${baseName}.mp4`,
          size: outStat.size,
        }],
        originalSize: inputBuffer.length,
        sendAsDocument,
        totalParts: 1,
      };
    }

    console.log(`[FFmpeg] Transcoded file ${(outStat.size / 1024 / 1024).toFixed(1)}MB exceeds 100MB. Splitting required.`);

    if (duration <= 0) {
      throw new Error(`Cannot split video: duration unknown and file exceeds 100MB (${outStat.size} bytes)`);
    }

    let numParts = Math.floor(outStat.size / DOCUMENT_LIMIT) + 1;
    const MAX_SPLIT_ATTEMPTS = 3;
    let parts: TranscodeResultPart[] = [];

    for (let attempt = 1; attempt <= MAX_SPLIT_ATTEMPTS; attempt++) {
      parts = [];
      const partPaths = await splitVideo(outputPath, duration, numParts, id);
      cleanupPaths.push(...partPaths);

      let allPartsOk = true;
      for (let i = 0; i < partPaths.length; i++) {
        const partStat = await stat(partPaths[i]);
        if (partStat.size > DOCUMENT_LIMIT) {
          console.warn(`[FFmpeg] Part ${i + 1} is ${(partStat.size / 1024 / 1024).toFixed(1)}MB (> 100MB). Retrying with more parts.`);
          allPartsOk = false;
          break;
        }
        const partBuffer = readFileSync(partPaths[i]);
        parts.push({
          buffer: partBuffer,
          mimeType: "video/mp4",
          fileName: `video_part${i + 1}.mp4`,
          size: partStat.size,
        });
        console.log(`[FFmpeg] Part ${i + 1}/${partPaths.length}: ${(partStat.size / 1024 / 1024).toFixed(1)}MB`);
      }

      if (allPartsOk) break;

      numParts = numParts + Math.max(1, Math.floor(numParts * 0.5));
      console.log(`[FFmpeg] Split attempt ${attempt} failed. Retrying with ${numParts} parts.`);
      parts = [];
    }

    if (parts.length === 0) {
      throw new Error(`Failed to split video into parts ≤ 100MB after ${MAX_SPLIT_ATTEMPTS} attempts`);
    }

    console.log(`[FFmpeg] Result: ${parts.length} parts, total ${(parts.reduce((s, p) => s + p.size, 0) / 1024 / 1024).toFixed(1)}MB. Mode: document (split)`);

    return {
      parts,
      originalSize: inputBuffer.length,
      sendAsDocument: true,
      totalParts: parts.length,
    };
  } finally {
    for (const p of cleanupPaths) {
      await unlink(p).catch(() => {});
    }
    const tmpFiles = await readdir("/tmp").catch(() => []);
    for (const f of tmpFiles) {
      if (f.startsWith(`split_${id}_`) || f.startsWith(`transcode_in_${id}`) || f.startsWith(`transcode_out_${id}`)) {
        await unlink(join("/tmp", f)).catch(() => {});
      }
    }
  }
}
