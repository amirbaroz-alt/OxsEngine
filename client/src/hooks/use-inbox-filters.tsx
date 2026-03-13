import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface UseInboxFiltersParams {
  currentRole: string;
  currentTenantId: string | undefined;
  authUser: { _id?: string } | null;
}

interface TagItem { _id: string; name: string; color: string; teamId?: string; }

export function useInboxFilters({ currentRole, currentTenantId, authUser }: UseInboxFiltersParams) {
  const [search, setSearch] = useState("");
  const [filterTenantId, setFilterTenantId] = useState<string>(() => currentTenantId || "__all__");
  const [filterTab, setFilterTab] = useState<"mine" | "pool" | "closed" | "spam" | "snoozed">("pool");
  const [filterAgentId, setFilterAgentId] = useState<string>(() => currentRole === "employee" ? (authUser?._id || "") : "");
  const [filterChannels, setFilterChannels] = useState<Set<string>>(new Set());
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [filterStarred, setFilterStarred] = useState(false);
  const [channelsInitialized, setChannelsInitialized] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (currentTenantId) setFilterTenantId(currentTenantId);
    else setFilterTenantId("__all__");
    setFilterChannels(new Set());
    setFilterStatuses(new Set());
    setFilterTags(new Set());
    setChannelsInitialized(false);
  }, [currentRole, currentTenantId]);

  const activeTenantId = filterTenantId !== "__all__" ? filterTenantId : "";

  const { data: tenantChannelTypes = [] } = useQuery<string[]>({
    queryKey: ["/api/inbox/channel-types", activeTenantId],
    queryFn: () => apiRequest("GET", `/api/inbox/channel-types?tenantId=${activeTenantId}`).then(r => r.json()),
    enabled: !!activeTenantId,
  });

  useEffect(() => {
    if (tenantChannelTypes.length > 0 && !channelsInitialized) {
      setFilterChannels(new Set(tenantChannelTypes));
      setChannelsInitialized(true);
    }
  }, [tenantChannelTypes, channelsInitialized]);

  const { data: tenantTags = [] } = useQuery<TagItem[]>({
    queryKey: ["/api/tags", activeTenantId],
    queryFn: () => apiRequest("GET", `/api/tags?tenantId=${activeTenantId}&scope=conversation`).then(r => r.json()),
    enabled: !!activeTenantId,
  });

  const convQueryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filterTenantId !== "__all__") p.set("tenantId", filterTenantId);
    if (search) p.set("search", search);
    p.set("tab", filterTab);
    if (filterChannels.size > 0 && activeTenantId) {
      const allSelected = tenantChannelTypes.length > 0 && filterChannels.size === tenantChannelTypes.length;
      if (!allSelected) {
        p.set("channels", Array.from(filterChannels).join(","));
      }
    }
    if (filterStatuses.size > 0) {
      p.set("statuses", Array.from(filterStatuses).join(","));
    }
    if (filterTags.size > 0) {
      p.set("tags", Array.from(filterTags).join(","));
    }
    if (filterStarred) {
      p.set("starred", "true");
    }
    if (filterAgentId) {
      p.set("agentId", filterAgentId);
    }
    return p.toString();
  }, [filterTenantId, search, filterTab, filterChannels, filterStatuses, filterTags, filterStarred, filterAgentId, tenantChannelTypes, activeTenantId]);

  const tabCountsParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filterTenantId !== "__all__") p.set("tenantId", filterTenantId);
    if (filterAgentId) p.set("agentId", filterAgentId);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [filterTenantId, filterAgentId]);
  const tabCountsTenantParam = tabCountsParams;

  return {
    search, setSearch,
    filterTenantId, setFilterTenantId,
    filterTab, setFilterTab,
    filterAgentId, setFilterAgentId,
    filterChannels, setFilterChannels,
    filterStatuses, setFilterStatuses,
    filterTags, setFilterTags,
    filterStarred, setFilterStarred,
    channelsInitialized, showFilters, setShowFilters,
    activeTenantId,
    tenantChannelTypes, tenantTags,
    convQueryParams, tabCountsTenantParam,
  };
}
