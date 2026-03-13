import mongoose, { Schema, Document } from "mongoose";

export interface ITeam extends Document {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  color: string;
  active: boolean;
  managerId?: mongoose.Types.ObjectId;
  managerIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const TeamSchema = new Schema<ITeam>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    color: { type: String, default: "#6B7280" },
    active: { type: Boolean, default: true },
    managerId: { type: Schema.Types.ObjectId, ref: "User" },
    managerIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

TeamSchema.index({ tenantId: 1 });
TeamSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const TeamModel = mongoose.model<ITeam>("Team", TeamSchema);
