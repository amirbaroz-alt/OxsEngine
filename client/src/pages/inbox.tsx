import { useState, useEffect, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  Send, CheckCircle2, Check, X, Pencil, Lightbulb, Loader2, Download, ExternalLink, Timer,
} from "lucide-react";
import { SendTemplateDialog } from "@/components/send-template-dialog";
import { ForwardMessageDialog } from "@/components/inbox/ForwardMessageDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useMailboxData } from "@/hooks/use-mailbox-data";
import { ConversationListPanel } from "@/components/inbox/ConversationListPanel";
import { ChatWindowPanel, renderContentFn } from "@/components/inbox/ChatWindowPanel";
import { CustomerDetailsPanel } from "@/components/inbox/CustomerDetailsPanel";

function PasteImagePreview({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!src) return null;
  return (
    <div className="p-4 flex items-center justify-center bg-muted/30">
      <img src={src} alt="Preview" className="max-h-[400px] max-w-full object-contain rounded-lg" data-testid="img-paste-preview" />
    </div>
  );
}

export default function InboxPage() {
  const d = useMailboxData();
  const { t } = useTranslation();
  const renderContent = (content: string) => renderContentFn(content, t);
  const [forwardPendingPhone, setForwardPendingPhone] = useState<string | null>(null);

  const acwMinutes = Math.floor(d.acwSecondsLeft / 60);
  const acwSecs = d.acwSecondsLeft % 60;
  const acwProgress = d.authUser?.acwTimeLimit ? (d.acwSecondsLeft / ((d.authUser.acwTimeLimit ?? 3) * 60)) * 100 : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden" dir={d.rtl ? "rtl" : "ltr"}>
      {d.acwActive && (
        <div className="shrink-0 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-3" data-testid="banner-acw">
          <Timer className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-pulse shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {t("inbox.acw.title", "Wrap-up Time (ACW)")}
              </span>
              <span className="text-sm font-mono font-bold text-amber-900 dark:text-amber-100" data-testid="text-acw-countdown">
                {String(acwMinutes).padStart(2, "0")}:{String(acwSecs).padStart(2, "0")}
              </span>
            </div>
            <div className="w-full bg-amber-200 dark:bg-amber-800 rounded-full h-1 mt-1">
              <div
                className="bg-amber-500 dark:bg-amber-400 h-1 rounded-full transition-all duration-1000"
                style={{ width: `${acwProgress}%` }}
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={d.dismissAcw}
            className="text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 shrink-0"
            data-testid="button-dismiss-acw"
          >
            <X className="h-3.5 w-3.5 me-1" />
            {t("inbox.acw.dismiss", "Done")}
          </Button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
      {/* Column 1: Conversations List */}
      <ConversationListPanel d={d} renderContent={renderContent} />

      {/* Resizer between List and Chat */}
      <div
        className="hidden md:flex items-center justify-center w-1 shrink-0 cursor-col-resize group hover-elevate"
        onMouseDown={d.handleListResizeStart}
        data-testid="list-panel-resizer"
      >
        <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
      </div>

      {/* Column 2: Chat Area */}
      <ChatWindowPanel d={d} />

      {/* Resolve Dialog */}
      <Dialog open={d.showResolveDialog} onOpenChange={d.setShowResolveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inbox.resolveConversation", "Resolve Conversation")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t("inbox.resolutionTag", "Tags")}</label>
              {d.sortedTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" data-testid="tag-list-resolve">
                  {d.sortedTags.map((tag) => {
                    const isSelected = d.resolveTags.includes(tag.name);
                    return (
                      <button
                        key={tag._id}
                        type="button"
                        className={`text-xs px-3 py-1.5 rounded-full border-2 transition-all font-medium ${isSelected ? "ring-2 ring-offset-1 shadow-sm" : "opacity-70 hover:opacity-100"}`}
                        style={{
                          borderColor: tag.color,
                          color: isSelected ? "white" : tag.color,
                          backgroundColor: isSelected ? tag.color : "transparent",
                          ringColor: tag.color,
                        }}
                        onClick={() => {
                          if (isSelected) {
                            d.setResolveTags(d.resolveTags.filter(t => t !== tag.name));
                          } else {
                            d.setResolveTags([...d.resolveTags, tag.name]);
                          }
                        }}
                        data-testid={`button-tag-${tag._id}`}
                      >
                        {isSelected && <Check className="h-3 w-3 inline-block me-1" />}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("inbox.resolutionSummary", "Summary")}</label>
              <Textarea
                value={d.resolveSummary}
                onChange={(e) => d.setResolveSummary(e.target.value)}
                placeholder={t("inbox.resolutionSummaryPlaceholder", "Brief summary of how the conversation was resolved...")}
                className="text-sm"
                rows={3}
                data-testid="textarea-resolve-summary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => d.setShowResolveDialog(false)} data-testid="button-resolve-cancel">
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => d.resolveMutation.mutate()} disabled={d.resolveMutation.isPending} data-testid="button-resolve-confirm">
              <CheckCircle2 className="h-4 w-4 me-1" />
              {t("inbox.resolve", "Resolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resizer between Chat and CRM panel */}
      {d.selectedConv && (
        <div
          className="hidden lg:flex items-center justify-center w-1 shrink-0 cursor-col-resize group hover-elevate"
          onMouseDown={d.handleResizeStart}
          data-testid="crm-panel-resizer"
        >
          <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
        </div>
      )}

      {/* Column 3: CRM / Customer Info + Journey Panel */}
      {d.selectedConv && <CustomerDetailsPanel d={d} />}
      </div>

      {/* Suggest Knowledge Dialog */}
      <Dialog open={d.showSuggestDialog} onOpenChange={(open) => { if (!open) { d.setShowSuggestDialog(false); d.setSuggestMessageId(null); d.setSuggestQuestion(""); d.setSuggestAnswer(""); d.setSuggestTeamId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              {t("inbox.suggestToAI", "Suggest to AI")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t("inbox.suggestQuestion", "Question / Topic")}</label>
              <Input
                value={d.suggestQuestion}
                onChange={(e) => d.setSuggestQuestion(e.target.value)}
                placeholder={t("inbox.suggestQuestionPlaceholder", "What question does this answer?")}
                data-testid="input-suggest-question"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("inbox.suggestAnswer", "Answer / Knowledge")}</label>
              <Textarea
                value={d.suggestAnswer}
                onChange={(e) => d.setSuggestAnswer(e.target.value)}
                rows={4}
                data-testid="input-suggest-answer"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("inbox.suggestTeam", "Team")}</label>
              <Select value={d.suggestTeamId} onValueChange={d.setSuggestTeamId}>
                <SelectTrigger data-testid="select-suggest-team">
                  <SelectValue placeholder={t("inbox.selectTeam", "Select team")} />
                </SelectTrigger>
                <SelectContent>
                  {d.inboxTeams.map((team) => (
                    <SelectItem key={team._id} value={team._id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => d.setShowSuggestDialog(false)} data-testid="button-cancel-suggest">
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!d.suggestMessageId || !d.suggestTeamId || !d.suggestQuestion.trim() || !d.suggestAnswer.trim()) return;
                d.suggestKnowledgeMutation.mutate({
                  messageId: d.suggestMessageId,
                  teamId: d.suggestTeamId,
                  question: d.suggestQuestion.trim(),
                  answer: d.suggestAnswer.trim(),
                });
              }}
              disabled={d.suggestKnowledgeMutation.isPending || !d.suggestTeamId || !d.suggestQuestion.trim() || !d.suggestAnswer.trim()}
              data-testid="button-submit-suggest"
            >
              {d.suggestKnowledgeMutation.isPending ? t("common.submitting", "Submitting...") : t("common.submit", "Submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Message Dialog */}
      <Dialog open={!!d.editingMessage} onOpenChange={(open) => { if (!open && !d.editMessageMutation.isPending) { d.setEditingMessage(null); d.setEditContent(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              {t("inbox.editMessage", "Edit Message")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground italic">
              {t("inbox.editNote", "The edited text will overwrite the original message on the customer's device.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={d.editContent}
              onChange={(e) => d.setEditContent(e.target.value)}
              rows={4}
              dir="auto"
              data-testid="input-edit-message"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { d.setEditingMessage(null); d.setEditContent(""); }} data-testid="button-cancel-edit">
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!d.editingMessage || !d.editContent.trim()) return;
                d.editMessageMutation.mutate({ messageId: d.editingMessage._id, content: d.editContent.trim() });
              }}
              disabled={d.editMessageMutation.isPending || !d.editContent.trim()}
              data-testid="button-submit-edit"
            >
              {d.editMessageMutation.isPending ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{t("common.saving", "Saving...")}</>
              ) : (
                t("common.save", "Save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paste Image Preview Modal */}
      {d.pastePreviewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { d.setPastePreviewFile(null); d.setPasteCaption(""); }}
          data-testid="paste-preview-overlay"
        >
          <div
            className="bg-background rounded-2xl shadow-2xl w-full max-w-[500px] mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            data-testid="paste-preview-modal"
          >
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-lg">{t("inbox.sendImage", "Send Image")}</h3>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => { d.setPastePreviewFile(null); d.setPasteCaption(""); }}
                data-testid="button-paste-preview-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <PasteImagePreview file={d.pastePreviewFile} />
            <div className="p-4 space-y-3">
              <Input
                value={d.pasteCaption}
                onChange={(e) => d.setPasteCaption(e.target.value)}
                placeholder={t("inbox.addCaption", "Add a caption...")}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); d.sendPastedImage(); } }}
                autoFocus
                data-testid="input-paste-caption"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => { d.setPastePreviewFile(null); d.setPasteCaption(""); }}
                  data-testid="button-paste-cancel"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={d.sendPastedImage}
                  className="bg-green-600 hover:bg-green-700 text-white"
                  data-testid="button-paste-send"
                >
                  <Send className="h-4 w-4 me-2" />
                  {t("common.send", "Send")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Media Preview Lightbox */}
      {d.previewMedia && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => d.setPreviewMedia(null)}
          data-testid="media-preview-lightbox"
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="absolute -top-10 end-0 flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:text-white/80"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = d.previewMedia!.url;
                  a.download = d.previewMedia!.name || "file";
                  a.click();
                }}
                data-testid="button-preview-download"
              >
                <Download className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:text-white/80"
                onClick={() => window.open(d.previewMedia!.url, "_blank")}
                data-testid="button-preview-newtab"
              >
                <ExternalLink className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-white hover:text-white/80"
                onClick={() => d.setPreviewMedia(null)}
                data-testid="button-close-preview"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            {d.previewMedia.type === "IMAGE" ? (
              <img
                src={d.previewMedia.url}
                alt={d.previewMedia.name}
                className="max-w-[90vw] max-h-[85vh] object-contain rounded-md"
              />
            ) : d.previewMedia.type === "VIDEO" ? (
              <video
                src={d.previewMedia.url}
                controls
                autoPlay
                className="max-w-[90vw] max-h-[85vh] rounded-md"
              />
            ) : null}
            <div className="text-center mt-2">
              <span className="text-white text-sm">{d.previewMedia.name}</span>
            </div>
          </div>
        </div>
      )}

      {d.selectedConv && (
        <SendTemplateDialog
          open={d.sendTemplateDialogOpen}
          onOpenChange={d.setSendTemplateDialogOpen}
          conversationId={String(d.selectedConv._id)}
          customerId={String(d.selectedConv.customerId)}
          tenantId={String(d.selectedConv.tenantId)}
        />
      )}

      {d.showForwardDialog && (
        <ForwardMessageDialog
          open={d.showForwardDialog}
          onOpenChange={(open) => { if (!open) { d.setShowForwardDialog(false); d.setForwardMessageId(null); setForwardPendingPhone(null); } }}
          activeTenantId={d.activeTenantId}
          isPending={d.forwardMutation.isPending}
          pendingPhone={forwardPendingPhone}
          excludePhone={d.selectedConv?.customer?.phone || null}
          onSelect={(phone) => {
            if (d.forwardMessageId) {
              setForwardPendingPhone(phone);
              d.forwardMutation.mutate({ messageId: d.forwardMessageId, targetPhone: phone });
            }
          }}
        />
      )}
    </div>
  );
}
