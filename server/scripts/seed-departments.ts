import mongoose from "mongoose";
import { TeamModel } from "../models/team.model";
import { TenantModel } from "../models/tenant.model";

const TENANT_SLUG = "impact-networks";

const DEPARTMENTS = [
  { code: 10, name: "מכירות", color: "#341381" },
  { code: 15, name: "חידושים", color: "#10B981" },
  { code: 20, name: "שירות לקוחות", color: "#6dca91" },
  { code: 30, name: "תביעות", color: "#EF4444" },
  { code: 40, name: "גביה", color: "#8B5CF6" },
  { code: 50, name: "חברות ניהול", color: "#EC4899" },
  { code: 90, name: "כללי", color: "#64748B" },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI environment variable is not set");
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: "cpaas-platform" });
  console.log("Connected to MongoDB");

  const tenant = await TenantModel.findOne({ slug: TENANT_SLUG });
  if (!tenant) {
    console.error(`Tenant with slug "${TENANT_SLUG}" not found`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const tenantId = tenant._id;
  console.log(`Found tenant "${TENANT_SLUG}" with ID: ${tenantId}`);

  let created = 0;
  let skipped = 0;

  for (const dept of DEPARTMENTS) {
    const existing = await TeamModel.findOne({ tenantId, name: dept.name });
    if (existing) {
      console.log(`  SKIP: "${dept.name}" already exists (ID: ${existing._id})`);
      skipped++;
      continue;
    }

    const team = await TeamModel.create({
      tenantId,
      name: dept.name,
      description: "",
      color: dept.color,
      active: true,
      managerIds: [],
    });
    console.log(`  CREATED: "${dept.name}" (ID: ${team._id})`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped (already existed): ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
