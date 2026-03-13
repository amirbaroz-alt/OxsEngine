import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Users, Search, Phone, Mail, MessageCircle, UserCog } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableSkeleton } from "@/components/data-table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { useRole } from "@/lib/role-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPhoneDisplay } from "@/lib/format-utils";
import type { Tenant } from "@shared/schema";

interface Customer {
  _id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  assignedAgentId?: string;
  assignedAgentName?: string;
  createdAt: string;
  updatedAt: string;
}

interface Agent {
  _id: string;
  name: string;
  role: string;
  groupId?: string;
  isOnline: boolean;
}

interface CustomersResponse {
  customers: Customer[];
  total: number;
  page: number;
  totalPages: number;
}

const channelIcon: Record<string, typeof MessageCircle> = {
  WHATSAPP: MessageCircle,
  SMS: Phone,
  EMAIL: Mail,
};

const channelColor: Record<string, string> = {
  WHATSAPP: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SMS: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  EMAIL: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export default function CustomersPage() {
  const { t } = useTranslation();
  const { currentRole, currentTenantId } = useRole();
  const { toast } = useToast();
  const isSuperAdmin = currentRole === "superadmin";

  const [search, setSearch] = useState("");
  const [filterTenantId, setFilterTenantId] = useState<string>(() =>
    currentTenantId ? currentTenantId : "__all__"
  );
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (currentTenantId) {
      setFilterTenantId(currentTenantId);
    } else {
      setFilterTenantId("__all__");
    }
  }, [currentRole, currentTenantId]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filterTenantId !== "__all__") params.set("tenantId", filterTenantId);
    if (search) params.set("search", search);
    params.set("page", String(page));
    params.set("limit", "50");
    return params.toString();
  }, [filterTenantId, search, page]);

  const { data, isLoading } = useQuery<CustomersResponse>({
    queryKey: [`/api/customers?${queryParams}`],
  });

  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });

  const agentsTenantId = filterTenantId !== "__all__" ? filterTenantId : currentTenantId || "";
  const agentsUrl = agentsTenantId ? `/api/inbox/agents?tenantId=${agentsTenantId}` : undefined;
  const { data: agents } = useQuery<Agent[]>({
    queryKey: [agentsUrl],
    enabled: !!agentsUrl,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ customerId, agentId, tenantId: tid }: { customerId: string; agentId: string | null; tenantId: string }) => {
      await apiRequest("PATCH", `/api/customers/${customerId}/assign-agent?tenantId=${tid}`, {
        agentId: agentId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers?${queryParams}`] });
      toast({ title: t("customers.agentAssigned", "Account manager updated") });
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const customers = data?.customers || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const tenantMap = useMemo(() => {
    const map: Record<string, string> = {};
    tenants?.forEach((t: any) => { map[t._id] = t.nameHe || t.nameEn; });
    return map;
  }, [tenants]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Users className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-customers-title">
            {t("nav.customers")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("customers.subtitle", "Customers created from incoming messages")}
          </p>
        </div>
        <Badge variant="secondary" className="ms-auto" data-testid="badge-customers-total">
          {total}
        </Badge>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("common.search", "Search...")}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="ps-9"
            data-testid="input-customers-search"
          />
        </div>
        {isSuperAdmin && tenants && tenants.length > 0 && (
          <Select value={filterTenantId} onValueChange={(v) => { setFilterTenantId(v); setPage(1); }}>
            <SelectTrigger className="w-[200px]" data-testid="select-customers-tenant">
              <SelectValue placeholder={t("common.allBusinesses", "All businesses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("common.allBusinesses", "All businesses")}</SelectItem>
              {tenants.map((tn: any) => (
                <SelectItem key={tn._id} value={tn._id}>{tn.nameHe || tn.nameEn}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <DataTableSkeleton columns={5} rows={8} />
          ) : customers.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("customers.noCustomersFound", "No customers found")}
              description={t("customers.noCustomersDesc", "Customers are created automatically when messages arrive")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead data-testid="th-name">{t("common.name", "Name")}</TableHead>
                  <TableHead data-testid="th-phone">{t("common.phone", "Phone")}</TableHead>
                  <TableHead data-testid="th-email">{t("common.email", "Email")}</TableHead>
                  <TableHead data-testid="th-channel">{t("common.channel", "Channel")}</TableHead>
                  <TableHead data-testid="th-account-manager">{t("customers.accountManager", "Account Manager")}</TableHead>
                  {isSuperAdmin && <TableHead data-testid="th-tenant">{t("common.business", "Business")}</TableHead>}
                  <TableHead data-testid="th-created">{t("common.createdAt", "Created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => {
                  const ChannelIcon = channelIcon[customer.channel] || MessageCircle;
                  return (
                    <TableRow key={customer._id} data-testid={`row-customer-${customer._id}`}>
                      <TableCell className="font-medium" data-testid={`text-customer-name-${customer._id}`}>
                        {customer.firstName} {customer.lastName}
                      </TableCell>
                      <TableCell dir="ltr" data-testid={`text-customer-phone-${customer._id}`}>
                        {customer.phone ? formatPhoneDisplay(customer.phone) : "—"}
                      </TableCell>
                      <TableCell data-testid={`text-customer-email-${customer._id}`}>
                        {customer.email || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={channelColor[customer.channel] || ""}
                          data-testid={`badge-customer-channel-${customer._id}`}
                        >
                          <ChannelIcon className="h-3 w-3 me-1" />
                          {customer.channel}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`cell-customer-agent-${customer._id}`}>
                        <Select
                          value={customer.assignedAgentId || "__none__"}
                          onValueChange={(v) => {
                            assignMutation.mutate({
                              customerId: customer._id,
                              agentId: v === "__none__" ? null : v,
                              tenantId: customer.tenantId,
                            });
                          }}
                        >
                          <SelectTrigger className="w-[160px]" data-testid={`select-agent-${customer._id}`}>
                            <SelectValue>
                              {customer.assignedAgentName || (
                                <span className="text-muted-foreground text-xs">
                                  {t("customers.noAgent", "Unassigned")}
                                </span>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t("customers.noAgent", "Unassigned")}</SelectItem>
                            {(agents || []).map((ag) => (
                              <SelectItem key={ag._id} value={ag._id}>
                                <div className="flex items-center gap-2">
                                  <span className={`h-2 w-2 rounded-full ${ag.isOnline ? "bg-green-500" : "bg-gray-400"}`} />
                                  {ag.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {isSuperAdmin && (
                        <TableCell className="text-muted-foreground text-sm" data-testid={`text-customer-tenant-${customer._id}`}>
                          {tenantMap[customer.tenantId] || customer.tenantId}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground text-sm" data-testid={`text-customer-date-${customer._id}`}>
                        {new Date(customer.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 text-sm border rounded-md disabled:opacity-50"
            data-testid="button-prev-page"
          >
            {t("common.previous", "Previous")}
          </button>
          <span className="text-sm text-muted-foreground" data-testid="text-page-info">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 text-sm border rounded-md disabled:opacity-50"
            data-testid="button-next-page"
          >
            {t("common.next", "Next")}
          </button>
        </div>
      )}
    </div>
  );
}
