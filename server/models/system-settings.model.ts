import mongoose, { Schema, Document } from "mongoose";

export interface IStandardFieldLayout {
  fieldKey: string;
  uiWidth: 3 | 4 | 6 | 9 | 12;
  forceNewRow: boolean;
  order: number;
}

export interface ISystemSettings extends Document {
  key: string;
  tenantFormFieldsLayout: IStandardFieldLayout[];
}

const FieldLayoutSchema = new Schema<IStandardFieldLayout>(
  {
    fieldKey: { type: String, required: true },
    uiWidth: { type: Number, enum: [3, 4, 6, 9, 12], default: 6 },
    forceNewRow: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const SystemSettingsSchema = new Schema<ISystemSettings>(
  {
    key: { type: String, required: true, unique: true },
    tenantFormFieldsLayout: { type: [FieldLayoutSchema], default: [] },
  },
  { timestamps: false }
);

export const SystemSettingsModel = mongoose.model<ISystemSettings>("SystemSettings", SystemSettingsSchema);
