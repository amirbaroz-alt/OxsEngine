import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/lib/role-context";
import { isRtl } from "@/lib/i18n";
import {
  Lightbulb, Check, X, Clock, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, ChevronLeft, User, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface SuggestedKnowledge {
  _id: string;
  tenantId: string;
  conversationId: string;
  messageId: string;
  teamId: string;
  question: string;
  answer: string;
  status: "pending" | "approved" | "rejected";
  suggestedBy: string;
  suggestedByName?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export default function KnowledgePage() {
  const { t, i18n } = useTranslation();
  const rtl = isRtl(i18n.language);
  const { toast } = useToast();
  const { currentTenantId: activeTenantId } = useRole();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [editingItem, setEditingItem] = useState<SuggestedKnowledge | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const suggestionsUrl = activeTenantId ? `/api/suggested-knowledge?tenantId=${activeTenantId}&status=${statusFilter}` : undefined;
  const { data: suggestions = [], isLoading } = useQuery<SuggestedKnowledge[]>({
    queryKey: [suggestionsUrl],
    enabled: !!suggestionsUrl,
  });

  const knowledgeTeamsUrl = activeTenantId ? `/api/teams?tenantId=${activeTenantId}` : undefined;
  const { data: teams = [] } = useQuery<{ _id: string; name: string }[]>({
    queryKey: [knowledgeTeamsUrl],
    enabled: !!knowledgeTeamsUrl,
  });

  const approveMutation = useMutation({
    mutationFn: async (data: { id: string; question: string; answer: string; reviewNotes?: string }) => {
      return apiRequest("PATCH", `/api/suggested-knowledge/${data.id}/approve?tenantId=${activeTenantId}`, {
        question: data.question,
        answer: data.answer,
        reviewNotes: data.reviewNotes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/suggested-knowledge") });
      toast({ title: t("knowledge.approved", "Knowledge approved") });
      setEditingItem(null);
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (data: { id: string; reviewNotes?: string }) => {
      return apiRequest("PATCH", `/api/suggested-knowledge/${data.id}/reject?tenantId=${activeTenantId}`, {
        reviewNotes: data.reviewNotes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/suggested-knowledge") });
      toast({ title: t("knowledge.rejected", "Knowledge rejected") });
      setEditingItem(null);
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const teamName = (teamId: string) => teams.find(t => t._id === teamId)?.name || teamId;

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"><Clock className="h-3 w-3 me-1" />{t("knowledge.pending", "Pending")}</Badge>;
      case "approved":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 me-1" />{t("knowledge.approved", "Approved")}</Badge>;
      case "rejected":
        return <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"><XCircle className="h-3 w-3 me-1" />{t("knowledge.rejected", "Rejected")}</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-auto" dir={rtl ? "rtl" : "ltr"} data-testid="knowledge-page">
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          {t("knowledge.title", "Knowledge Suggestions")}
        </h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-knowledge-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">{t("knowledge.pending", "Pending")}</SelectItem>
            <SelectItem value="approved">{t("knowledge.approved", "Approved")}</SelectItem>
            <SelectItem value="rejected">{t("knowledge.rejected", "Rejected")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : suggestions.length === 0 ? (
        <div className="text-center p-8 text-muted-foreground">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>{t("knowledge.empty", "No knowledge suggestions found")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {suggestions.map((item) => {
            const isExpanded = expandedId === item._id;
            return (
              <Card key={item._id} data-testid={`card-knowledge-${item._id}`}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : item._id)}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : rtl ? (
                      <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <CardTitle className="text-sm font-medium truncate">{item.question}</CardTitle>
                    {statusBadge(item.status)}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{teamName(item.teamId)}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" })}
                    </span>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="space-y-3 pt-0">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("knowledge.questionLabel", "Question")}</label>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{item.question}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("knowledge.answerLabel", "Answer")}</label>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{item.answer}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {t("knowledge.suggestedBy", "Suggested by")}: {item.suggestedByName || item.suggestedBy}
                      </span>
                      {item.reviewedByName && (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {t("knowledge.reviewedBy", "Reviewed by")}: {item.reviewedByName}
                        </span>
                      )}
                    </div>
                    {item.reviewNotes && (
                      <div className="text-sm bg-muted/50 p-2 rounded-md">
                        <span className="font-medium">{t("knowledge.reviewNotes", "Review notes")}:</span> {item.reviewNotes}
                      </div>
                    )}
                    {item.status === "pending" && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditingItem(item);
                            setEditQuestion(item.question);
                            setEditAnswer(item.answer);
                            setReviewNotes("");
                          }}
                          data-testid={`button-review-${item._id}`}
                        >
                          {t("knowledge.review", "Review")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600"
                          onClick={() => approveMutation.mutate({ id: item._id, question: item.question, answer: item.answer })}
                          disabled={approveMutation.isPending}
                          data-testid={`button-quick-approve-${item._id}`}
                        >
                          <Check className="h-3.5 w-3.5 me-1" />
                          {t("knowledge.approve", "Approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => rejectMutation.mutate({ id: item._id })}
                          disabled={rejectMutation.isPending}
                          data-testid={`button-quick-reject-${item._id}`}
                        >
                          <X className="h-3.5 w-3.5 me-1" />
                          {t("knowledge.reject", "Reject")}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Review/Edit Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              {t("knowledge.reviewTitle", "Review Knowledge Suggestion")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t("knowledge.questionLabel", "Question")}</label>
              <Input
                value={editQuestion}
                onChange={(e) => setEditQuestion(e.target.value)}
                data-testid="input-edit-knowledge-question"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("knowledge.answerLabel", "Answer")}</label>
              <Textarea
                value={editAnswer}
                onChange={(e) => setEditAnswer(e.target.value)}
                rows={5}
                data-testid="input-edit-knowledge-answer"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("knowledge.reviewNotes", "Review Notes")}</label>
              <Textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={2}
                placeholder={t("knowledge.reviewNotesPlaceholder", "Optional notes about the review...")}
                data-testid="input-review-notes"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setEditingItem(null)}
              data-testid="button-cancel-review"
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="outline"
              className="text-red-600"
              onClick={() => {
                if (!editingItem) return;
                rejectMutation.mutate({ id: editingItem._id, reviewNotes: reviewNotes.trim() || undefined });
              }}
              disabled={rejectMutation.isPending}
              data-testid="button-reject-review"
            >
              <X className="h-3.5 w-3.5 me-1" />
              {t("knowledge.reject", "Reject")}
            </Button>
            <Button
              onClick={() => {
                if (!editingItem) return;
                approveMutation.mutate({
                  id: editingItem._id,
                  question: editQuestion.trim(),
                  answer: editAnswer.trim(),
                  reviewNotes: reviewNotes.trim() || undefined,
                });
              }}
              disabled={approveMutation.isPending || !editQuestion.trim() || !editAnswer.trim()}
              data-testid="button-approve-review"
            >
              <Check className="h-3.5 w-3.5 me-1" />
              {t("knowledge.approve", "Approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
