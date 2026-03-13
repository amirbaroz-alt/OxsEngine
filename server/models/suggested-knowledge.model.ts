import mongoose, { Schema, Document } from "mongoose";

export type KnowledgeStatus = "pending" | "approved" | "rejected";

export interface ISuggestedKnowledge extends Document {
  tenantId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  messageId: mongoose.Types.ObjectId;
  question: string;
  answer: string;
  status: KnowledgeStatus;
  createdBy: mongoose.Types.ObjectId;
  createdByName: string;
  approvedBy?: mongoose.Types.ObjectId;
  approvedByName?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SuggestedKnowledgeSchema = new Schema<ISuggestedKnowledge>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    messageId: { type: Schema.Types.ObjectId, ref: "Message", required: true },
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedByName: { type: String },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true }
);

SuggestedKnowledgeSchema.index({ tenantId: 1, status: 1 });
SuggestedKnowledgeSchema.index({ teamId: 1, status: 1 });
SuggestedKnowledgeSchema.index({ conversationId: 1 });
SuggestedKnowledgeSchema.index({ createdBy: 1 });

export const SuggestedKnowledgeModel = mongoose.model<ISuggestedKnowledge>(
  "SuggestedKnowledge",
  SuggestedKnowledgeSchema
);
