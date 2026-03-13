import mongoose from "mongoose";
import { TenantModel } from "./server/models/tenant.model";
import { getConversationModel } from "./server/models/conversation.model";
import { getCustomerModel } from "./server/models/customer.model";

async function debugActiveSessions() {
  console.log("--------------------------------------------------");
  console.log("🔍 בדיקת שיחות פעילות — כל הטנאנטים");
  console.log("--------------------------------------------------");

  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error("🛑 MONGODB_URI not set"); process.exit(1); }

    await mongoose.connect(uri);

    const tenants = await TenantModel.find({ active: true }).select("+tenantDbUri slug name").lean();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const fmt = (d: any) => d ? new Date(d).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" }) : "?";

    console.log(`⏰ Server now (IL): ${fmt(new Date())}`);
    console.log(`⏰ Cutoff (24h ago): ${fmt(twentyFourHoursAgo)}`);
    console.log(`📋 ${tenants.length} active tenant(s)\n`);

    for (const tenant of tenants) {
      const tenantId = String(tenant._id);
      const tenantName = (tenant as any).slug || (tenant as any).name || tenantId;
      const dbUri = (tenant as any).tenantDbUri || process.env.DATABASE_URL || uri;

      console.log(`\n========== Tenant: ${tenantName} (${tenantId}) ==========`);

      let conn: mongoose.Connection;
      try {
        conn = mongoose.createConnection(dbUri);
        await conn.asPromise();
      } catch (e: any) {
        console.log(`  🛑 Failed to connect: ${e.message}`);
        continue;
      }

      const ConversationModel = getConversationModel(conn);
      const CustomerModel = getCustomerModel(conn);

      const totalConvs = await ConversationModel.countDocuments({});
      const recent24h = await ConversationModel.countDocuments({ lastMessageAt: { $gte: twentyFourHoursAgo } });

      console.log(`  📦 Total conversations: ${totalConvs} | In last 24h: ${recent24h}`);

      const allConvs = await ConversationModel.find({})
        .sort({ lastMessageAt: -1 })
        .limit(30)
        .select("customerId lastMessageAt lastInboundAt status channel tenantId")
        .lean();

      if (allConvs.length === 0) {
        console.log("  ❌ No conversations at all.");
        await conn.close();
        continue;
      }

      const customerIds = [...new Set(allConvs.map((c: any) => String(c.customerId)).filter(Boolean))];
      const customers = await CustomerModel.find({ _id: { $in: customerIds } })
        .select("firstName lastName phone")
        .lean();
      const customerMap = new Map(customers.map((c: any) => [String(c._id), c]));

      console.log(`  👥 ${customers.length} customer records\n`);

      console.log("  #  | טלפון               | שם                  | סטטוס      | ערוץ      | lastMessageAt          | בתוך 24ש?");
      console.log("  " + "-".repeat(110));

      allConvs.forEach((conv: any, i: number) => {
        const cust = customerMap.get(String(conv.customerId));
        const phone = (cust as any)?.phone || "ללא טלפון ⚠️";
        const name = cust
          ? ([(cust as any).firstName, (cust as any).lastName].filter(Boolean).join(" ").trim() || "ללא שם")
          : "לקוח חסר";
        const status = conv.status || "?";
        const channel = conv.channel || "?";
        const lastMsg = fmt(conv.lastMessageAt);
        const isRecent = conv.lastMessageAt && new Date(conv.lastMessageAt) >= twentyFourHoursAgo;

        console.log(
          `  ${String(i + 1).padStart(2)} | ${phone.padEnd(20)} | ${name.padEnd(19)} | ${status.padEnd(10)} | ${channel.padEnd(9)} | ${lastMsg.padEnd(22)} | ${isRecent ? "✅ כן" : "❌ לא"}`
        );
      });

      console.log("  " + "-".repeat(110));

      const statusCounts: Record<string, number> = {};
      allConvs.forEach((c: any) => { statusCounts[c.status || "?"] = (statusCounts[c.status || "?"] || 0) + 1; });
      console.log(`  📊 סטטוסים: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

      if (allConvs.length > 0) {
        const newest = allConvs[0];
        const oldest = allConvs[allConvs.length - 1];
        console.log(`  📊 הודעה אחרונה (newest): ${fmt(newest.lastMessageAt)}`);
        console.log(`  📊 הודעה ישנה ביותר (oldest in top ${allConvs.length}): ${fmt(oldest.lastMessageAt)}`);
      }

      await conn.close();
    }

    console.log("\n--------------------------------------------------");
    console.log("✅ הבדיקה הסתיימה.");
  } catch (error) {
    console.error("🛑 שגיאה:", error);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

debugActiveSessions();
