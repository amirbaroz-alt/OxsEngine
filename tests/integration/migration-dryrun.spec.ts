import "../setup";
import mongoose from "mongoose";

jest.mock("../../server/index", () => ({
  log: jest.fn(),
}));

describe("Migration Dry-Run: Channel & Token Verification", () => {
  it("creates mock tenant, runs migration simulation, and verifies channel token integrity", async () => {
    const { TenantModel } = await import("../../server/models/tenant.model");
    const { ChannelModel } = await import("../../server/models/channel.model");
    const { CustomerModel } = await import("../../server/models/customer.model");
    const { ConversationModel } = await import("../../server/models/conversation.model");
    const { MessageModel } = await import("../../server/models/message.model");
    const { getCustomerModel } = await import("../../server/models/customer.model");
    const { getConversationModel } = await import("../../server/models/conversation.model");
    const { getMessageModel } = await import("../../server/models/message.model");
    const { encryptChannelFields, decryptChannelFields, findChannelByPhoneNumberId } = await import("../../server/services/channel.service");

    const TEST_ACCESS_TOKEN = "EAAMzB7kx1ZABOVK9Xmf2LsJk5ZCqHfake_token_for_migration_test_" + Date.now();
    const TEST_PHONE_NUMBER_ID = "109876543210_" + Date.now();
    const TEST_WABA_ID = "100200300400";
    const TEST_VERIFY_TOKEN = "migration_verify_token_" + Date.now();
    const dbName = `tenant_migration_dryrun_${Date.now()}`;
    const tenantDbUri = process.env.MONGODB_URI!;
    const fullUri = tenantDbUri.replace(/\/?(\?|$)/, `/${dbName}$1`);

    const tenant = await TenantModel.create({
      nameHe: "Migration DryRun Tenant",
      nameEn: "Migration DryRun Tenant",
      slug: "migration-dryrun-" + Date.now(),
      tenantDbUri: fullUri,
      active: true,
    });
    const tenantId = String(tenant._id);

    const encrypted = encryptChannelFields({
      accessToken: TEST_ACCESS_TOKEN,
      verifyToken: TEST_VERIFY_TOKEN,
    });

    const channel = await ChannelModel.create({
      tenantId: tenant._id,
      type: "WHATSAPP",
      name: "DryRun WhatsApp Channel",
      phoneNumberId: TEST_PHONE_NUMBER_ID,
      wabaId: TEST_WABA_ID,
      accessToken: encrypted.accessToken,
      verifyToken: encrypted.verifyToken,
      status: "active",
      isActive: true,
    });
    const channelId = String(channel._id);

    const customer = await CustomerModel.create({
      tenantId: tenant._id,
      firstName: "Migration",
      lastName: "TestUser",
      phone: "+972501234567",
    });

    const conv = await ConversationModel.create({
      tenantId: tenant._id,
      customerId: customer._id,
      channel: "WHATSAPP",
      status: "UNASSIGNED",
      lastInboundAt: new Date(),
    });

    await MessageModel.create({
      conversationId: conv._id,
      tenantId: tenant._id,
      direction: "INBOUND",
      content: "Hello from migration test",
      type: "TEXT",
      channel: "WHATSAPP",
    });

    console.log(`\n  ── STEP 1: SETUP ──`);
    console.log(`  Tenant ID: ${tenantId}`);
    console.log(`  Channel ID: ${channelId}`);
    console.log(`  Created: 1 tenant, 1 channel, 1 customer, 1 conversation, 1 message`);

    console.log(`\n  ── STEP 2: MIGRATION SIMULATION ──`);
    const tenantConn = mongoose.createConnection(tenantDbUri, { dbName });
    await tenantConn.asPromise();

    try {
      const TenantCustomerModel = getCustomerModel(tenantConn);
      const TenantConvModel = getConversationModel(tenantConn);
      const TenantMsgModel = getMessageModel(tenantConn);

      const customers = await CustomerModel.find({ tenantId }).lean();
      if (customers.length > 0) {
        await TenantCustomerModel.insertMany(customers as any[], { ordered: false }).catch((e: any) => {
          if (e.code !== 11000) throw e;
        });
      }

      const conversations = await ConversationModel.find({ tenantId }).lean();
      if (conversations.length > 0) {
        await TenantConvModel.insertMany(conversations as any[], { ordered: false }).catch((e: any) => {
          if (e.code !== 11000) throw e;
        });
      }

      const messages = await MessageModel.find({ tenantId }).lean();
      if (messages.length > 0) {
        await TenantMsgModel.insertMany(messages as any[], { ordered: false }).catch((e: any) => {
          if (e.code !== 11000) throw e;
        });
      }

      const migratedCustomers = await TenantCustomerModel.countDocuments();
      const migratedConvs = await TenantConvModel.countDocuments();
      const migratedMsgs = await TenantMsgModel.countDocuments();

      console.log(`  Migrated: ${migratedCustomers} customers, ${migratedConvs} conversations, ${migratedMsgs} messages`);
      expect(migratedCustomers).toBe(1);
      expect(migratedConvs).toBe(1);
      expect(migratedMsgs).toBe(1);

      console.log(`\n  ── STEP 3: CHANNEL & TOKEN VERIFICATION ──`);

      const channelDoc = await ChannelModel.findById(channelId).lean();
      expect(channelDoc).not.toBeNull();
      expect(String(channelDoc!.tenantId)).toBe(tenantId);
      expect(channelDoc!.type).toBe("WHATSAPP");
      expect(channelDoc!.phoneNumberId).toBe(TEST_PHONE_NUMBER_ID);
      expect(channelDoc!.wabaId).toBe(TEST_WABA_ID);
      expect(channelDoc!.status).toBe("active");
      expect(channelDoc!.isActive).toBe(true);

      const decrypted = decryptChannelFields(channelDoc);
      expect(decrypted.accessToken).toBe(TEST_ACCESS_TOKEN);
      expect(decrypted.verifyToken).toBe(TEST_VERIFY_TOKEN);
      console.log(`  Token decryption: PASS (accessToken matches original)`);

      const looked = await findChannelByPhoneNumberId(TEST_PHONE_NUMBER_ID);
      expect(looked).not.toBeNull();
      expect(looked!._decrypted.tenantId).toBe(tenantId);
      expect(looked!._decrypted.accessToken).toBe(TEST_ACCESS_TOKEN);
      expect(looked!._decrypted.phoneNumberId).toBe(TEST_PHONE_NUMBER_ID);
      console.log(`  findChannelByPhoneNumberId lookup: PASS`);

      console.log(`\n  ── STEP 4: TENANT DB DATA INTEGRITY ──`);

      const tenantCustomer = await TenantCustomerModel.findOne({}).lean();
      expect(tenantCustomer).not.toBeNull();
      expect(tenantCustomer!.firstName).toBe("Migration");

      const tenantConv = await TenantConvModel.findOne({}).lean();
      expect(tenantConv).not.toBeNull();
      expect(tenantConv!.channel).toBe("WHATSAPP");

      const tenantMsg = await TenantMsgModel.findOne({}).lean();
      expect(tenantMsg).not.toBeNull();
      expect(tenantMsg!.content).toBe("Hello from migration test");

      const channelStillExists = await ChannelModel.findById(channelId).lean();
      expect(channelStillExists).not.toBeNull();
      console.log(`  Tenant DB: 1 customer, 1 conversation, 1 message — intact`);
      console.log(`  Central DB channel: still exists, linked to tenant`);

      console.log(`\n  ── CHANNEL OBJECT STRUCTURE (Tenant DB perspective) ──`);
      console.log(JSON.stringify({
        _id: channelId,
        tenantId,
        type: channelDoc!.type,
        name: channelDoc!.name,
        phoneNumberId: channelDoc!.phoneNumberId,
        wabaId: channelDoc!.wabaId,
        accessToken: "(encrypted in DB, decrypts to original — VERIFIED)",
        verifyToken: "(encrypted in DB, decrypts to original — VERIFIED)",
        status: channelDoc!.status,
        isActive: channelDoc!.isActive,
        createdAt: channelDoc!.createdAt,
        updatedAt: channelDoc!.updatedAt,
      }, null, 2));

      console.log(`\n  ══ RESULT: TOKEN MIGRATION SUCCESSFUL ══`);
      console.log(`  The WhatsApp access token was stored encrypted in the Central DB Channel`);
      console.log(`  collection, correctly linked to the tenant. After migration, the token`);
      console.log(`  decrypts to the exact original value. The channel lookup by phoneNumberId`);
      console.log(`  resolves correctly to the tenant.`);

      console.log(`\n  ── CLEANUP ──`);
      const collections = await tenantConn.db.listCollections().toArray();
      for (const col of collections) {
        await tenantConn.db.dropCollection(col.name).catch(() => {});
      }
      console.log(`  Dropped ${collections.length} tenant DB collections`);
    } finally {
      await tenantConn.close().catch(() => {});
    }
  });
});
