import mongoose from "mongoose";

const URI = process.env.MONGODB_URI || "";
async function run() {
  const conn = await mongoose.createConnection(URI).asPromise();
  const db = conn.useDb("cpaas-platform").db!;

  const TenantColl = db.collection("tenants");
  const herz = await TenantColl.findOne({ slug: "herz" });
  const barozservice = await TenantColl.findOne({ slug: "barozservice" });
  if (!herz || !barozservice) { console.log("Missing tenants"); await conn.close(); process.exit(1); }

  const herzId = herz._id;
  const bsId = barozservice._id;
  console.log("herz ID: " + herzId);
  console.log("barozservice ID: " + bsId);

  // --- SystemAuditLogs ---
  const SAL = db.collection("systemauditlogs");
  const salHerz3042 = await SAL.countDocuments({ tenantId: herzId, phoneNumberId: "3042895055784924" });
  console.log("\nsystemauditlogs: herz + phone 3042: " + salHerz3042);

  let salMoved = 0;
  if (salHerz3042 > 0) {
    const r = await SAL.updateMany(
      { tenantId: herzId, phoneNumberId: "3042895055784924" },
      { $set: { tenantId: bsId } }
    );
    salMoved = r.modifiedCount;
    console.log("Moved systemauditlogs: " + salMoved);
  }

  // --- AuditLogs ---
  const AL = db.collection("auditlogs");
  const alHerz3042 = await AL.countDocuments({ tenantId: herzId, phoneNumberId: "3042895055784924" });
  console.log("\nauditlogs: herz + phone 3042: " + alHerz3042);

  let alMoved = 0;
  if (alHerz3042 > 0) {
    const r = await AL.updateMany(
      { tenantId: herzId, phoneNumberId: "3042895055784924" },
      { $set: { tenantId: bsId } }
    );
    alMoved = r.modifiedCount;
    console.log("Moved auditlogs: " + alMoved);
  }

  // --- CommunicationLogs ---
  const CL = db.collection("communicationlogs");
  const clHerz3042 = await CL.countDocuments({
    tenantId: herzId,
    $or: [{ sender: "3042895055784924" }, { "metadata.phoneNumberId": "3042895055784924" }, { phoneNumberId: "3042895055784924" }]
  });
  console.log("\ncommunicationlogs: herz + phone 3042: " + clHerz3042);

  let clMoved = 0;
  if (clHerz3042 > 0) {
    const r = await CL.updateMany(
      { tenantId: herzId, $or: [{ sender: "3042895055784924" }, { "metadata.phoneNumberId": "3042895055784924" }, { phoneNumberId: "3042895055784924" }] },
      { $set: { tenantId: bsId } }
    );
    clMoved = r.modifiedCount;
    console.log("Moved communicationlogs: " + clMoved);
  }

  console.log("\n=== SUMMARY ===");
  console.log("SystemAuditLogs moved: " + salMoved);
  console.log("AuditLogs moved: " + alMoved);
  console.log("CommunicationLogs moved: " + clMoved);
  console.log("TOTAL moved from herz -> barozservice: " + (salMoved + alMoved + clMoved));

  // Verify nothing remains
  const remSal = await SAL.countDocuments({ tenantId: herzId, phoneNumberId: "3042895055784924" });
  const remAl = await AL.countDocuments({ tenantId: herzId, phoneNumberId: "3042895055784924" });
  const remCl = await CL.countDocuments({ tenantId: herzId, $or: [{ sender: "3042895055784924" }, { "metadata.phoneNumberId": "3042895055784924" }, { phoneNumberId: "3042895055784924" }] });
  console.log("\nRemaining under herz with phone 3042: SAL=" + remSal + " AL=" + remAl + " CL=" + remCl);

  await conn.close();
  console.log("Done.");
}
run().catch((err) => { console.error(err); process.exit(1); });
