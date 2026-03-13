import mongoose from "mongoose";
import { log } from "./index";

export const CENTRAL_DB_NAME = "cpaas-platform";

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  mongoose.connection.on("connected", () => {
    log("MongoDB connection established", "mongodb");
  });
  mongoose.connection.on("disconnected", () => {
    log("MongoDB connection lost", "mongodb");
  });
  mongoose.connection.on("error", (err) => {
    log(`MongoDB connection error: ${err.message}`, "mongodb");
  });

  try {
    await mongoose.connect(uri, {
      dbName: CENTRAL_DB_NAME,
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 30000,
      retryWrites: true,
      w: "majority",
    });
    log("Connected to MongoDB Atlas (pool: 5-50)", "mongodb");

    try {
      const usersCollection = mongoose.connection.collection("users");
      try {
        const userIndexes = await usersCollection.indexes();
        const oldEmailIdx = userIndexes.find((idx: any) =>
          idx.key?.email === 1 && !idx.key?.tenantId && idx.unique === true
        );
        if (oldEmailIdx && oldEmailIdx.name) {
          await usersCollection.dropIndex(oldEmailIdx.name);
          log(`Migration: dropped old global unique index '${oldEmailIdx.name}' on email (now scoped to tenantId)`, "mongodb");
        }
      } catch (idxErr: any) {
        if (!idxErr.message?.includes("index not found")) {
          log(`Migration: email index cleanup note: ${idxErr.message}`, "mongodb");
        }
      }

      const convCollection = mongoose.connection.collection("conversations");

      try {
        const indexes = await convCollection.indexes();
        const oldIdx = indexes.find((idx: any) =>
          idx.key?.tenantId === 1 && idx.key?.customerId === 1 &&
          idx.key?.channelId === 1 && idx.key?.status === 1 && idx.unique === true
        );
        if (oldIdx && oldIdx.name) {
          await convCollection.dropIndex(oldIdx.name);
          log(`Migration: dropped old unique index '${oldIdx.name}' (tenantId+customerId+channelId+status)`, "mongodb");
        }
      } catch (idxErr: any) {
        if (!idxErr.message?.includes("index not found")) {
          log(`Migration: index cleanup note: ${idxErr.message}`, "mongodb");
        }
      }

      const openNoAssignee = await convCollection.updateMany(
        { status: "OPEN", assignedTo: { $exists: false } },
        { $set: { status: "UNASSIGNED" } }
      );
      if (openNoAssignee.modifiedCount > 0) {
        log(`Migration: converted ${openNoAssignee.modifiedCount} OPEN (unassigned) conversations to UNASSIGNED`, "mongodb");
      }
      const openWithAssignee = await convCollection.updateMany(
        { status: "OPEN", assignedTo: { $exists: true } },
        { $set: { status: "ACTIVE" } }
      );
      if (openWithAssignee.modifiedCount > 0) {
        log(`Migration: converted ${openWithAssignee.modifiedCount} OPEN (assigned) conversations to ACTIVE`, "mongodb");
      }
      const pendingResult = await convCollection.updateMany(
        { status: "PENDING" },
        { $set: { status: "SNOOZED" } }
      );
      if (pendingResult.modifiedCount > 0) {
        log(`Migration: converted ${pendingResult.modifiedCount} PENDING conversations to SNOOZED`, "mongodb");
      }
    } catch (migErr) {
      log(`Migration warning: ${migErr}`, "mongodb");
    }
  } catch (error) {
    log(`Failed to connect to MongoDB: ${error}`, "mongodb");
    throw error;
  }
}
