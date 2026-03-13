import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CENTRAL_DB_NAME = "cpaas-platform";
const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const BACKUP_DIR = path.join(__dirname_local, "..", "backups");
const COLLECTIONS = ["messages", "conversations", "customers", "whatsapptemplates", "templatetags"];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI environment variable is not set");
    process.exit(1);
  }

  console.log("Connecting to Central DB...");
  await mongoose.connect(uri, { dbName: CENTRAL_DB_NAME });
  console.log("Connected to Central DB");

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summary: Record<string, number> = {};

  for (const collectionName of COLLECTIONS) {
    console.log(`\nBacking up collection: ${collectionName}...`);

    try {
      const collection = mongoose.connection.collection(collectionName);
      const docs = await collection.find({}).toArray();

      const fileName = `${collectionName}_${timestamp}.json`;
      const filePath = path.join(BACKUP_DIR, fileName);

      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));

      const fileSize = fs.statSync(filePath).size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      summary[collectionName] = docs.length;
      console.log(`  ✓ ${collectionName}: ${docs.length} documents → ${fileName} (${fileSizeMB} MB)`);
    } catch (err: any) {
      if (err.message?.includes("ns not found") || err.codeName === "NamespaceNotFound") {
        summary[collectionName] = 0;
        console.log(`  ⊘ ${collectionName}: collection does not exist (0 documents)`);
      } else {
        console.error(`  ✗ ${collectionName}: ERROR — ${err.message}`);
        summary[collectionName] = -1;
      }
    }
  }

  console.log("\n═══════════════════════════════════");
  console.log("BACKUP SUMMARY");
  console.log("═══════════════════════════════════");
  for (const [col, count] of Object.entries(summary)) {
    const status = count === -1 ? "FAILED" : count === 0 ? "EMPTY" : `${count} docs`;
    console.log(`  ${col}: ${status}`);
  }
  console.log(`\nBackup directory: ${BACKUP_DIR}`);
  console.log("═══════════════════════════════════");

  await mongoose.disconnect();
  console.log("\nDone. Central DB connection closed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal backup error:", err);
  process.exit(1);
});
