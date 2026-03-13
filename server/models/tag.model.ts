import mongoose, { Schema, Document } from "mongoose";

export interface ITag extends Document {
  tenantId: mongoose.Types.ObjectId;
  teamId?: mongoose.Types.ObjectId;
  name: string;
  color: string;
  scope: "conversation" | "customer";
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team" },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: "#6B7280" },
    scope: {
      type: String,
      enum: ["conversation", "customer"],
      default: "conversation",
    },
  },
  { timestamps: true }
);

TagSchema.index({ tenantId: 1, scope: 1 });
TagSchema.index({ tenantId: 1, teamId: 1, scope: 1 });
TagSchema.index({ tenantId: 1, teamId: 1, name: 1, scope: 1 }, { unique: true });

export const TagModel = mongoose.model<ITag>("Tag", TagSchema);
