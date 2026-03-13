import mongoose, { Schema, Document } from "mongoose";

export interface IQuickReply extends Document {
  tenantId: mongoose.Types.ObjectId;
  title: string;
  content: string;
  category: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuickReplySchema = new Schema<IQuickReply>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    category: { type: String, default: "general", trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

QuickReplySchema.index({ tenantId: 1, category: 1 });
QuickReplySchema.index({ tenantId: 1, title: 1 }, { unique: true });

export const QuickReplyModel = mongoose.model<IQuickReply>("QuickReply", QuickReplySchema);
