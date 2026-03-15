import mongoose, { Document, Schema } from "mongoose";

export interface IOTC extends Document {
  code: string;
  token: string;
  createdAt: Date;
}

const OTCSchema = new Schema<IOTC>({
  code:  { type: String, required: true, unique: true, index: true },
  token: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 30 }, // TTL: 30 seconds
});

export const OTCModel =
  (mongoose.models.OTC as mongoose.Model<IOTC>) ||
  mongoose.model<IOTC>("OTC", OTCSchema);
