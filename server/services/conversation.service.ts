import { ConversationModel } from "../models/conversation.model";

class ConversationService {
  async verifyTenantAccess(conversationId: string, tenantIds: string[]): Promise<boolean> {
    const conv = await ConversationModel.findById(conversationId).select("tenantId").lean();
    if (!conv) return false;
    return tenantIds.includes(String(conv.tenantId));
  }
}

export const conversationService = new ConversationService();
