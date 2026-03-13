import { ReplitConnectors } from "@replit/connectors-sdk";
import { execSync } from "child_process";

const connectors = new ReplitConnectors();

const FOLDER_NAME = "Replit_Logs";

async function findOrCreateFolder(): Promise<string> {
  const searchRes = await connectors.proxy(
    "google-drive",
    `/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    { method: "GET" }
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    console.log(`[sync] Found folder "${FOLDER_NAME}" (${searchData.files[0].id})`);
    return searchData.files[0].id;
  }

  const createRes = await connectors.proxy(
    "google-drive",
    "/drive/v3/files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      }),
    }
  );
  const createData = await createRes.json();
  console.log(`[sync] Created folder "${FOLDER_NAME}" (${createData.id})`);
  return createData.id;
}

async function findExistingFile(folderId: string, fileName: string): Promise<string | null> {
  const searchRes = await connectors.proxy(
    "google-drive",
    `/drive/v3/files?q=name='${fileName}' and '${folderId}' in parents and trashed=false&fields=files(id,name)`,
    { method: "GET" }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }
  return null;
}

async function uploadFile(folderId: string, fileName: string, content: string): Promise<void> {
  const existingFileId = await findExistingFile(folderId, fileName);

  if (existingFileId) {
    await connectors.proxy(
      "google-drive",
      `/upload/drive/v3/files/${existingFileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: { "Content-Type": "text/plain" },
        body: content,
      }
    );
    console.log(`[sync] Updated "${fileName}" (${existingFileId})`);
  } else {
    const metadata = {
      name: fileName,
      parents: [folderId],
    };
    const boundary = "replit_sync_boundary";
    const multipartBody =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    const res = await connectors.proxy(
      "google-drive",
      "/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipartBody,
      }
    );
    const data = await res.json();
    console.log(`[sync] Created "${fileName}" (${data.id})`);
  }
}

async function main() {
  const commitRange = process.argv[2] || "HEAD~1";

  console.log(`[sync] Generating diff for: ${commitRange}`);

  let diff: string;
  try {
    diff = execSync(`git diff ${commitRange}`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    diff = execSync(`git diff HEAD~1`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  }

  if (!diff.trim()) {
    console.log("[sync] No changes detected. Nothing to upload.");
    return;
  }

  let stat: string;
  try {
    stat = execSync(`git diff ${commitRange} --stat`, { encoding: "utf-8" });
  } catch {
    stat = execSync(`git diff HEAD~1 --stat`, { encoding: "utf-8" });
  }

  let logLine: string;
  try {
    logLine = execSync(`git log --oneline -1`, { encoding: "utf-8" }).trim();
  } catch {
    logLine = "unknown commit";
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const header = [
    `=== CPAAS Code Changes ===`,
    `Date: ${now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}`,
    `Commit: ${logLine}`,
    `Range: ${commitRange}`,
    ``,
    `--- Files Changed ---`,
    stat,
    `--- Full Diff ---`,
    ``,
  ].join("\n");

  const content = header + diff;

  const folderId = await findOrCreateFolder();

  await uploadFile(folderId, `diff_${timestamp}.txt`, content);
  await uploadFile(folderId, `latest_code_changes.txt`, content);

  console.log(`[sync] Done! Check Google Drive → ${FOLDER_NAME}`);
}

main().catch((err) => {
  console.error("[sync] Error:", err);
  process.exit(1);
});
