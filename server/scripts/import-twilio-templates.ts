import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WhatsAppTemplateModel } from "../models/whatsapp-template.model";
import { TeamModel } from "../models/team.model";
import { TenantModel } from "../models/tenant.model";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TENANT_SLUG = "impact-networks";
const CSV_PATH = path.resolve(__dirname, "../../attached_assets/wa_templates_1772628878066.csv");

const DEPT_CODE_TO_NAME: Record<number, string> = {
  10: "מכירות",
  15: "חידושים",
  20: "שירות לקוחות",
  30: "תביעות",
  40: "גביה",
  50: "חברות ניהול",
  90: "כללי",
};

const FRIENDLY_LABELS: Record<string, string> = {
  ContactPersonName: "שם איש קשר",
  CustomerName: "שם לקוח",
  CustomerPhone: "טלפון לקוח",
  CustomerAddress: "כתובת לקוח",
  UserName: "שם משתמש",
  UserEmail: "דואל משתמש",
  UserPhone: "טלפון משתמש",
  FormLink: "קישור לטופס",
  FormPassword: "סיסמא לטופס",
  EndDate: "תאריך סיום",
  StartDate: "תאריך התחלה",
  DebtAmount: "סכום חוב",
  Amount: "סכום",
  ClaimNumber: "מספר תביעה",
  AppraiserName: "שם שמאי",
  ClaimDamageDate: "תאריך נזק",
  ClaimPlaintiffName: "שם תובע",
  PolicyNumber: "מספר פוליסה",
  Link: "קישור",
  Content: "תוכן",
  CustomerNumber: "מספר לקוח",
  InsCompanyName: "שם חברת ביטוח",
  DynamicField1: "שדה דינמי 1",
  DynamicFiedl1: "שדה דינמי 1",
  DynamicFiedl2: "שדה דינמי 2",
  DynamicFiedl3: "שדה דינמי 3",
  CanceledDate: "תאריך ביטול",
};

const AUTO_FILL: Record<string, { source: string; keyword: string }> = {
  ContactPersonName: { source: "customer.fullName", keyword: "CUSTOMER_FULL_NAME" },
  CustomerName: { source: "customer.fullName", keyword: "CUSTOMER_FULL_NAME" },
  CustomerPhone: { source: "customer.phone", keyword: "CUSTOMER_PHONE" },
  UserName: { source: "user.name", keyword: "USER_NAME" },
  UserEmail: { source: "user.email", keyword: "USER_EMAIL" },
  UserPhone: { source: "user.phone", keyword: "USER_PHONE" },
};

const NUMBER_FIELDS = ["Amount", "DebtAmount"];
const DATE_FIELDS = ["EndDate", "StartDate", "CanceledDate", "ClaimDamageDate"];

function parseCSV(content: string): Record<string, string>[] {
  content = content.replace(/^\uFEFF/, "");
  const rows: Record<string, string>[] = [];
  let pos = 0;

  function parseField(): string {
    if (pos >= content.length) return "";
    if (content[pos] === '"') {
      pos++;
      let val = "";
      while (pos < content.length) {
        if (content[pos] === '"') {
          if (pos + 1 < content.length && content[pos + 1] === '"') {
            val += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          val += content[pos];
          pos++;
        }
      }
      return val;
    } else {
      let val = "";
      while (pos < content.length && content[pos] !== ',' && content[pos] !== '\n' && content[pos] !== '\r') {
        val += content[pos];
        pos++;
      }
      return val;
    }
  }

  function parseLine(): string[] {
    const fields: string[] = [];
    while (pos < content.length) {
      fields.push(parseField());
      if (pos < content.length && content[pos] === ',') {
        pos++;
      } else {
        break;
      }
    }
    if (pos < content.length && content[pos] === '\r') pos++;
    if (pos < content.length && content[pos] === '\n') pos++;
    return fields;
  }

  const headers = parseLine();
  while (pos < content.length) {
    const fields = parseLine();
    if (fields.length === 0 || (fields.length === 1 && fields[0] === "")) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i].trim()] = (fields[i] || "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function getFieldType(varName: string): "TEXT" | "NUMBER" | "DATE" {
  if (NUMBER_FIELDS.includes(varName)) return "NUMBER";
  if (DATE_FIELDS.includes(varName)) return "DATE";
  return "TEXT";
}

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

  const teams = await TeamModel.find({ tenantId });
  const teamNameToId: Record<string, mongoose.Types.ObjectId> = {};
  for (const team of teams) {
    teamNameToId[team.name] = team._id as mongoose.Types.ObjectId;
  }
  console.log(`Found ${teams.length} teams: ${Object.keys(teamNameToId).join(", ")}`);

  const csvContent = fs.readFileSync(CSV_PATH, "utf-8");
  const rows = parseCSV(csvContent);
  console.log(`Parsed ${rows.length} rows from CSV`);

  const nameCounts: Record<string, number> = {};
  for (const row of rows) {
    const enName = row.WA_template_EN_name;
    if (enName) {
      nameCounts[enName] = (nameCounts[enName] || 0) + 1;
    }
  }

  const duplicates = Object.entries(nameCounts).filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    console.log(`\nDuplicate EN names found:`);
    for (const [name, count] of duplicates) {
      console.log(`  ${name}: ${count} occurrences`);
    }
  }

  const nameUsed: Record<string, number> = {};
  let created = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const templateId = row.WA_template_id;
      let enName = row.WA_template_EN_name;
      const friendlyName = row.WA_template_name;
      const waCategory = parseInt(row.WA_category, 10);
      const waContent = row.WA_content;

      if (!enName || !waContent) {
        console.log(`  SKIP row ${templateId}: missing EN name or content`);
        continue;
      }

      if (!nameUsed[enName]) {
        nameUsed[enName] = 1;
      } else {
        nameUsed[enName]++;
        enName = `${enName}_v${nameUsed[enName]}`;
      }

      const rawBodyContent = waContent.replace(/\[(\w+)\]/g, "{{$1}}");

      const varRegex = /\{\{(\w+)\}\}/g;
      const seenVars: string[] = [];
      let match;
      const tmpContent = rawBodyContent;
      const varRegex2 = /\{\{(\w+)\}\}/g;
      while ((match = varRegex2.exec(tmpContent)) !== null) {
        const varName = match[1];
        if (!seenVars.includes(varName)) {
          seenVars.push(varName);
        }
      }

      const variables = seenVars.map((varName, idx) => {
        const autoFill = AUTO_FILL[varName];
        return {
          index: idx + 1,
          fieldName: varName,
          fieldType: getFieldType(varName),
          friendlyLabel: FRIENDLY_LABELS[varName] || varName,
          order: idx + 1,
          hasDefault: !!autoFill,
          defaultValue: autoFill?.keyword || undefined,
        };
      });

      const varNameToIndex: Record<string, number> = {};
      seenVars.forEach((v, i) => { varNameToIndex[v] = i + 1; });

      const bodyText = rawBodyContent.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
        return `{{${varNameToIndex[varName]}}}`;
      });

      const variableMapping: Record<string, { label: string; source: string }> = {};
      for (const varName of seenVars) {
        const idx = varNameToIndex[varName];
        const autoFill = AUTO_FILL[varName];
        variableMapping[String(idx)] = {
          label: FRIENDLY_LABELS[varName] || varName,
          source: autoFill?.source || "manual",
        };
      }

      const deptName = DEPT_CODE_TO_NAME[waCategory];
      const teamId = deptName ? teamNameToId[deptName] || null : null;

      if (!teamId) {
        console.log(`  WARNING: No team found for WA_category=${waCategory} (name=${deptName})`);
      }

      const existing = await WhatsAppTemplateModel.findOne({
        tenantId,
        name: enName,
        language: "he",
      });

      if (existing) {
        console.log(`  SKIP: "${enName}" already exists (ID: ${existing._id})`);
        continue;
      }

      await WhatsAppTemplateModel.create({
        tenantId,
        name: enName,
        friendlyName: friendlyName || "",
        status: "DRAFT" as any,
        category: "MARKETING",
        language: "he",
        components: [],
        bodyText,
        rawBodyContent,
        metaTemplateId: null,
        variableMapping,
        variables,
        buttons: [],
        teamId,
        tagIds: [],
        lastSynced: null,
        rejectedReason: null,
      });

      console.log(`  CREATED: "${enName}" (team: ${deptName || "none"}, vars: ${seenVars.length})`);
      created++;
    } catch (err: any) {
      console.error(`  ERROR on row ${row.WA_template_id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. Created: ${created}, Errors: ${errors}, Total rows: ${rows.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
