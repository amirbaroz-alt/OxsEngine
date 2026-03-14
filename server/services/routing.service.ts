import mongoose from "mongoose";
import { log } from "../lib/logger";

const STICKINESS_WINDOW_DAYS = 7;

export interface RoutingResult {
  assignedTo: string | null;
  assignedName: string | null;
  rule: "stickiness" | "load_balance" | "pool";
  groupId?: string;
}

export async function routeConversation(
  tenantId: string,
  customerId: string,
  channel: string,
  customerGroupId?: string,
  channelId?: string
): Promise<RoutingResult> {
  const { ConversationModel } = await import("../models/conversation.model");
  const { CustomerModel } = await import("../models/customer.model");
  const { UserModel } = await import("../models/user.model");
  const { MessageModel } = await import("../models/message.model");
  const { ChannelModel } = await import("../models/channel.model");

  const tenantObjId = new mongoose.Types.ObjectId(tenantId);
  const customerObjId = new mongoose.Types.ObjectId(customerId);

  let channelTeamIds: string[] = [];
  if (channelId) {
    const channelDoc = await ChannelModel.findById(channelId).select("teamIds").lean();
    if (channelDoc?.teamIds && channelDoc.teamIds.length > 0) {
      channelTeamIds = channelDoc.teamIds.map((id: any) => String(id));
    }
  }

  // ── Rule 1: Stickiness ──
  // Did this customer talk to a specific agent in the last 7 days?
  // Check both active/snoozed conversations (which still have assignedTo)
  // and also check outbound messages from agents on resolved conversations
  const stickinessDate = new Date();
  stickinessDate.setDate(stickinessDate.getDate() - STICKINESS_WINDOW_DAYS);

  let stickyAgentId: string | null = null;

  const recentConv = await ConversationModel.findOne({
    tenantId: tenantObjId,
    customerId: customerObjId,
    assignedTo: { $exists: true, $ne: null },
    lastMessageAt: { $gte: stickinessDate },
    status: { $in: ["ACTIVE", "SNOOZED"] },
  })
    .sort({ lastMessageAt: -1 })
    .select("assignedTo assignedName")
    .lean();

  if (recentConv?.assignedTo) {
    stickyAgentId = String(recentConv.assignedTo);
  }

  if (!stickyAgentId) {
    const recentResolvedConvs = await ConversationModel.find({
      tenantId: tenantObjId,
      customerId: customerObjId,
      status: "RESOLVED",
      lastMessageAt: { $gte: stickinessDate },
    })
      .sort({ lastMessageAt: -1 })
      .limit(5)
      .select("_id")
      .lean();

    if (recentResolvedConvs.length > 0) {
      const convIds = recentResolvedConvs.map((c) => c._id);
      const lastOutbound = await MessageModel.findOne({
        conversationId: { $in: convIds },
        direction: "OUTBOUND",
        isInternal: { $ne: true },
        createdAt: { $gte: stickinessDate },
      })
        .sort({ createdAt: -1 })
        .select("metadata")
        .lean();

      if (lastOutbound?.metadata?.senderUserId) {
        stickyAgentId = String(lastOutbound.metadata.senderUserId);
      }
    }
  }

  if (stickyAgentId) {
    const agent = await UserModel.findOne({
      _id: stickyAgentId,
      tenantId: tenantObjId,
      active: true,
      isOnline: true,
    })
      .select("_id name")
      .lean();

    if (agent) {
      log(`Routing [stickiness]: customer ${customerId} -> agent ${agent.name} (recent conversation)`, "routing");
      return {
        assignedTo: String(agent._id),
        assignedName: agent.name,
        rule: "stickiness",
      };
    }
  }

  // ── Rule 2: Load Balancer (Round Robin) ──
  // Atomic: pick the online agent with the oldest lastRoutedAt and stamp it in one operation
  const agentFilter: any = {
    tenantId: tenantObjId,
    active: true,
    isOnline: true,
    role: { $in: ["businessadmin", "employee"] },
  };

  if (channelTeamIds.length > 0) {
    agentFilter.teamIds = { $in: channelTeamIds };
  } else if (customerGroupId) {
    agentFilter.$or = [
      { groupId: customerGroupId },
      { teamIds: customerGroupId },
    ];
  }

  const nextAgent = await UserModel.findOneAndUpdate(
    agentFilter,
    { $set: { lastRoutedAt: new Date() } },
    { sort: { lastRoutedAt: 1 }, new: true, projection: { _id: 1, name: 1, groupId: 1, teamIds: 1 } }
  ).lean();

  if (nextAgent) {
    log(`Routing [load_balance]: customer ${customerId} -> agent ${nextAgent.name} (round robin)`, "routing");
    return {
      assignedTo: String(nextAgent._id),
      assignedName: nextAgent.name,
      rule: "load_balance",
      groupId: nextAgent.groupId,
    };
  }

  log(`Routing [pool]: customer ${customerId} -> unassigned (no online agents found)`, "routing");
  return {
    assignedTo: null,
    assignedName: null,
    rule: "pool",
    groupId: customerGroupId,
  };
}
