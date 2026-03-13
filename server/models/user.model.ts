import mongoose, { Schema, Document } from "mongoose";

export type PresenceStatus = "active" | "busy" | "break" | "offline";

export interface IUser extends Document {
  name: string;
  phone: string;
  email: string;
  role: "superadmin" | "businessadmin" | "teamleader" | "employee";
  tenantId: mongoose.Types.ObjectId;
  active: boolean;
  groupId?: string;
  teamIds?: string[];
  acwTimeLimit?: number;
  isOnline?: boolean;
  presenceStatus?: PresenceStatus;
  presenceReason?: string;
  allowedBusyReasons?: string[];
  lastSeenAt?: Date;
  lastRoutedAt?: Date;
  passwordHash?: string;
  otpCode?: string;
  otpExpiresAt?: Date;
  otpAttempts?: number;
  lastLoginAt?: Date;
  isLocked?: boolean;
  lockedUntil?: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "businessadmin", "teamleader", "employee"], default: "employee" },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant" },
    active: { type: Boolean, default: true },
    groupId: { type: String },
    teamIds: [{ type: String }],
    acwTimeLimit: { type: Number, default: 3 },
    isOnline: { type: Boolean, default: false },
    presenceStatus: { type: String, enum: ["active", "busy", "break", "offline"], default: "active" },
    presenceReason: { type: String, default: "" },
    allowedBusyReasons: { type: [String], default: [] },
    lastSeenAt: { type: Date },
    lastRoutedAt: { type: Date },
    passwordHash: { type: String },
    otpCode: { type: String },
    otpExpiresAt: { type: Date },
    otpAttempts: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
    isLocked: { type: Boolean, default: false },
    lockedUntil: { type: Date },
  },
  { timestamps: false }
);

UserSchema.index({ phone: 1, tenantId: 1 }, { unique: true });
UserSchema.index({ email: 1, tenantId: 1 }, { unique: true, sparse: true });

export const UserModel = mongoose.model<IUser>("User", UserSchema);
