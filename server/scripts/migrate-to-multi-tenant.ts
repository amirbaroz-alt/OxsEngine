import mongoose from "mongoose";
import { TenantModel } from "../models/tenant.model";
import { MessageModel } from "../models/message.model";
import { getMessageModel } from "../models/message.model";
import { ConversationModel } from "../models/conversation.model";
import { getConversationModel } from "../models/conversation.model";
import { CustomerModel } from "../models/customer.model";
import { getCustomerModel } from "../models/customer.model";
import { WhatsAppTemplateModel } from "../models/whatsapp-template.model";
import { getWhatsAppTemplateModel } from "../models/whatsapp-template.model";
import { TemplateTagModel } from "../models/template-tag.model";
import { getTemplateTagModel } from "../models/template-tag.model";

const CENTRAL_DB_NAME = "cpaas-platform";
const BATCH_SIZE = 500;

interface MigrationResult {
  tenantId: string;
  tenantName: string;
  customers: number;
  conversations: number;
  messages: number;
  templates: number;
  templateTags: number;
  errors: string[];
}

async function getTenantConnection(tenantId: string, tenantDbUri: string | null | undefined): Promise<mongoose.Connection> {
  const uri = tenantDbUri || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(`No DB URI available for tenant ${tenantId}`);
  }

  const conn = mongoose.createConnection(uri, {
    maxPoolSize: 5,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    retryWrites: true,
    w: "majority",
  });

  await conn.asPromise();
  return conn;
}

async function migrateCollection<T extends mongoose.Document>(
  label: string,
  centralModel: mongoose.Model<T>,
  tenantModel: mongoose.Model<T>,
  tenantId: string,
): Promise<{ migrated: number; error?: string }> {
  try {
    const docs = await centralModel.find({ tenantId } as any).lean();
    if (docs.length === 0) {
      console.log(`    ${label}: 0 records (nothing to migrate)`);
      return { migrated: 0 };
    }

    let totalMigrated = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = docs.slice(i, i + BATCH_SIZE);
      try {
        await tenantModel.insertMany(batch as any[], { ordered: false });
        totalMigrated += batch.length;
      } catch (err: any) {
        if (err.code === 11000) {
          const inserted = err.insertedDocs?.length || err.result?.nInserted || 0;
          const dupes = batch.length - inserted;
          totalMigrated += inserted;
          console.log(`    ${label}: batch ${Math.floor(i / BATCH_SIZE) + 1} — ${inserted} inserted, ${dupes} duplicates skipped`);
        } else {
          throw err;
        }
      }
    }

    console.log(`    ✓ ${label}: ${totalMigrated} / ${docs.length} records migrated`);
    return { migrated: totalMigrated };
  } catch (err: any) {
    console.error(`    ✗ ${label}: ERROR — ${err.message}`);
    return { migrated: 0, error: err.message };
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI environment variable is not set");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════");
  console.log("MULTI-TENANT DATA MIGRATION");
  console.log("═══════════════════════════════════════════");
  console.log("Mode: READ from Central DB → WRITE to Tenant DBs");
  console.log("Safety: Central DB is NOT modified\n");

  console.log("Connecting to Central DB...");
  await mongoose.connect(uri, { dbName: CENTRAL_DB_NAME });
  console.log("Connected to Central DB\n");

  const tenants = await TenantModel.find({ active: true }).select("+tenantDbUri").lean();
  console.log(`Found ${tenants.length} active tenant(s)\n`);

  if (tenants.length === 0) {
    console.log("No tenants to migrate. Exiting.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const results: MigrationResult[] = [];
  const connections: mongoose.Connection[] = [];

  for (const tenant of tenants) {
    const tenantId = String(tenant._id);
    const tenantName = tenant.nameEn || tenant.nameHe || tenantId;

    console.log(`───────────────────────────────────────────`);
    console.log(`Tenant: ${tenantName} (${tenantId})`);
    console.log(`  DB URI: ${tenant.tenantDbUri ? "(custom tenantDbUri)" : "(default — MONGODB_URI)"}`);

    const result: MigrationResult = {
      tenantId,
      tenantName,
      customers: 0,
      conversations: 0,
      messages: 0,
      templates: 0,
      templateTags: 0,
      errors: [],
    };

    let tenantConn: mongoose.Connection;
    try {
      tenantConn = await getTenantConnection(tenantId, tenant.tenantDbUri);
      connections.push(tenantConn);
      console.log(`  Connected to tenant DB`);
    } catch (err: any) {
      console.error(`  ✗ FAILED to connect to tenant DB: ${err.message}`);
      result.errors.push(`DB connection failed: ${err.message}`);
      results.push(result);
      continue;
    }

    const TenantCustomerModel = getCustomerModel(tenantConn);
    const TenantConversationModel = getConversationModel(tenantConn);
    const TenantMessageModel = getMessageModel(tenantConn);
    const TenantTemplateModel = getWhatsAppTemplateModel(tenantConn);
    const TenantTagModel = getTemplateTagModel(tenantConn);

    const custResult = await migrateCollection("Customers", CustomerModel as any, TenantCustomerModel as any, tenantId);
    result.customers = custResult.migrated;
    if (custResult.error) result.errors.push(`Customers: ${custResult.error}`);

    const convResult = await migrateCollection("Conversations", ConversationModel as any, TenantConversationModel as any, tenantId);
    result.conversations = convResult.migrated;
    if (convResult.error) result.errors.push(`Conversations: ${convResult.error}`);

    const msgResult = await migrateCollection("Messages", MessageModel as any, TenantMessageModel as any, tenantId);
    result.messages = msgResult.migrated;
    if (msgResult.error) result.errors.push(`Messages: ${msgResult.error}`);

    const tplResult = await migrateCollection("Templates", WhatsAppTemplateModel as any, TenantTemplateModel as any, tenantId);
    result.templates = tplResult.migrated;
    if (tplResult.error) result.errors.push(`Templates: ${tplResult.error}`);

    const tagResult = await migrateCollection("TemplateTags", TemplateTagModel as any, TenantTagModel as any, tenantId);
    result.templateTags = tagResult.migrated;
    if (tagResult.error) result.errors.push(`TemplateTags: ${tagResult.error}`);

    results.push(result);
    console.log(`  Done with tenant: ${tenantName}\n`);
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("MIGRATION SUMMARY");
  console.log("═══════════════════════════════════════════");

  let totalCustomers = 0, totalConversations = 0, totalMessages = 0, totalTemplates = 0, totalTags = 0;
  let failedTenants = 0;

  for (const r of results) {
    const status = r.errors.length > 0 ? "⚠ PARTIAL" : "✓ OK";
    console.log(`\n  ${status} ${r.tenantName} (${r.tenantId})`);
    console.log(`      Customers:     ${r.customers}`);
    console.log(`      Conversations: ${r.conversations}`);
    console.log(`      Messages:      ${r.messages}`);
    console.log(`      Templates:     ${r.templates}`);
    console.log(`      TemplateTags:  ${r.templateTags}`);
    if (r.errors.length > 0) {
      failedTenants++;
      for (const e of r.errors) {
        console.log(`      ERROR: ${e}`);
      }
    }
    totalCustomers += r.customers;
    totalConversations += r.conversations;
    totalMessages += r.messages;
    totalTemplates += r.templates;
    totalTags += r.templateTags;
  }

  console.log("\n───────────────────────────────────────────");
  console.log(`  TOTALS:`);
  console.log(`    Tenants processed: ${results.length} (${failedTenants} with errors)`);
  console.log(`    Customers:         ${totalCustomers}`);
  console.log(`    Conversations:     ${totalConversations}`);
  console.log(`    Messages:          ${totalMessages}`);
  console.log(`    Templates:         ${totalTemplates}`);
  console.log(`    TemplateTags:      ${totalTags}`);
  console.log("═══════════════════════════════════════════");

  console.log("\nClosing connections...");
  for (const conn of connections) {
    await conn.close().catch(() => {});
  }
  await mongoose.disconnect();
  console.log("Done. All connections closed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal migration error:", err);
  process.exit(1);
});
