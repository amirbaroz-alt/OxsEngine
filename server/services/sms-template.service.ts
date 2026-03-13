import { SmsTemplateModel, type ISmsTemplate } from "../models/sms-template.model";

export class SmsTemplateService {
  async getAll(tenantId?: string): Promise<ISmsTemplate[]> {
    const filter: Record<string, any> = {};
    if (tenantId) {
      filter.$or = [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: null }];
    }
    return SmsTemplateModel.find(filter).sort({ templateType: 1 });
  }

  async getByType(templateType: string, tenantId?: string): Promise<ISmsTemplate | null> {
    if (tenantId) {
      const tenantTemplate = await SmsTemplateModel.findOne({ templateType, tenantId, active: true });
      if (tenantTemplate) return tenantTemplate;
    }
    return SmsTemplateModel.findOne({ templateType, tenantId: { $in: [null, undefined] }, active: true });
  }

  async getById(id: string): Promise<ISmsTemplate | null> {
    return SmsTemplateModel.findById(id);
  }

  async create(data: Partial<ISmsTemplate>): Promise<ISmsTemplate> {
    const template = new SmsTemplateModel(data);
    return template.save();
  }

  async update(id: string, data: Partial<ISmsTemplate>): Promise<ISmsTemplate | null> {
    return SmsTemplateModel.findByIdAndUpdate(id, data, { new: true });
  }

  async delete(id: string): Promise<boolean> {
    const result = await SmsTemplateModel.findByIdAndDelete(id);
    return !!result;
  }

  async seedDefaults(): Promise<void> {
    const count = await SmsTemplateModel.countDocuments();
    if (count > 0) return;

    const defaults = [
      {
        templateType: "welcome_message",
        name: "Welcome Message",
        content: "Hello [name], welcome to [businessName]! We're glad to have you on board.",
        active: true,
      },
      {
        templateType: "notification",
        name: "General Notification",
        content: "Hi [name], you have a new notification from [businessName]: [message]",
        active: true,
      },
    ];

    await SmsTemplateModel.insertMany(defaults);
  }
}

export const smsTemplateService = new SmsTemplateService();
