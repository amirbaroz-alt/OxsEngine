import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { Color } from "@tiptap/extension-color";
import { Extension } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, LinkIcon, Type,
  AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2, Highlighter, Palette, Quote, RemoveFormatting,
} from "lucide-react";

const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize?.replace(/['"]+/g, "") || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
        },
      },
    ];
  },
});

const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
];

const FONT_SIZES = [
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "24", value: "24px" },
];

const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Black", value: "#000000" },
  { label: "Dark Gray", value: "#4a4a4a" },
  { label: "Gray", value: "#9b9b9b" },
  { label: "Red", value: "#e53e3e" },
  { label: "Orange", value: "#dd6b20" },
  { label: "Yellow", value: "#d69e2e" },
  { label: "Green", value: "#38a169" },
  { label: "Teal", value: "#319795" },
  { label: "Blue", value: "#3182ce" },
  { label: "Indigo", value: "#5a67d8" },
  { label: "Purple", value: "#805ad5" },
  { label: "Pink", value: "#d53f8c" },
];

const HIGHLIGHT_COLORS = [
  { label: "None", value: "" },
  { label: "Yellow", value: "#fefcbf" },
  { label: "Green", value: "#c6f6d5" },
  { label: "Blue", value: "#bee3f8" },
  { label: "Pink", value: "#fed7e2" },
  { label: "Purple", value: "#e9d8fd" },
  { label: "Orange", value: "#feebc8" },
  { label: "Red", value: "#fed7d7" },
  { label: "Teal", value: "#b2f5ea" },
];

interface RichTextEditorProps {
  onSend: (html: string, plainText: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  isNote?: boolean;
  onKeyDown?: (e: KeyboardEvent) => boolean | void;
  editorRef?: React.MutableRefObject<Editor | null>;
  initialContent?: string;
  leftActions?: React.ReactNode;
  rightActions?: React.ReactNode;
  showToolbar?: boolean;
}

export default function RichTextEditor({
  onSend,
  placeholder = "",
  disabled = false,
  className = "",
  isNote = false,
  onKeyDown,
  editorRef,
  initialContent,
  leftActions,
  rightActions,
  showToolbar,
}: RichTextEditorProps) {
  const { t } = useTranslation();
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkPopover, setShowLinkPopover] = useState(false);

  const [, setForceUpdate] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        code: false,
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["paragraph", "heading"] }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent || "",
    editable: !disabled,
    onTransaction() {
      setForceUpdate((n) => n + 1);
    },
    editorProps: {
      attributes: {
        class: `outline-none min-h-[36px] max-h-[192px] overflow-y-auto px-3 py-2 text-sm ${className}`,
        "data-testid": "rich-text-editor-content",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          const html = editor?.getHTML() || "";
          const text = editor?.getText() || "";
          if (text.trim()) {
            onSend(html, text);
          }
          return true;
        }
        if (onKeyDown) {
          return onKeyDown(event) === true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  useEffect(() => {
    if (editorRef && editor) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  const setLink = useCallback(() => {
    if (!editor || !linkUrl) return;
    const url = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setLinkUrl("");
    setShowLinkPopover(false);
  }, [editor, linkUrl]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setShowLinkPopover(false);
  }, [editor]);

  const setFontSize = useCallback(
    (size: string) => {
      if (!editor) return;
      if (!size) {
        editor.chain().focus().unsetMark("textStyle").run();
      } else {
        editor.chain().focus().setMark("textStyle", { fontSize: size }).run();
      }
    },
    [editor],
  );

  if (!editor) return null;

  const currentFontSize =
    (editor.getAttributes("textStyle").fontSize as string) || "";
  const currentFontFamily =
    (editor.getAttributes("textStyle").fontFamily as string) || "";
  const currentColor =
    (editor.getAttributes("textStyle").color as string) || "";

  const activeClass = "bg-primary/15 text-primary";

  return (
    <div className="flex flex-col w-full" data-testid="rich-text-editor">
      <div className={`items-center gap-0.5 px-1 py-0.5 border-b flex-wrap ${showToolbar === false ? "hidden" : showToolbar === true ? "flex" : "hidden md:flex"}`} data-testid="rich-text-toolbar">
        <Select
          value={currentFontFamily || "default"}
          onValueChange={(val) => {
            if (val === "default") {
              editor.chain().focus().unsetFontFamily().run();
            } else {
              editor.chain().focus().setFontFamily(val).run();
            }
          }}
        >
          <SelectTrigger className="h-7 w-24 text-xs border-0 bg-transparent" data-testid="select-font-family">
            <SelectValue placeholder={t("editor.font", "Font")} />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((f) => (
              <SelectItem key={f.value || "default"} value={f.value || "default"} data-testid={`font-${f.label}`}>
                <span style={f.value ? { fontFamily: f.value } : undefined}>{f.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={currentFontSize || "default"}
          onValueChange={(val) => setFontSize(val === "default" ? "" : val)}
        >
          <SelectTrigger className="h-7 w-16 text-xs border-0 bg-transparent" data-testid="select-font-size">
            <SelectValue placeholder={t("editor.size", "Size")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default" data-testid="size-default">{t("editor.default", "Auto")}</SelectItem>
            {FONT_SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value} data-testid={`size-${s.label}`}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="w-px h-5 bg-border mx-0.5" />

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive("bold") ? activeClass : ""}
          onClick={() => editor.chain().focus().toggleBold().run()}
          data-testid="button-bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive("italic") ? activeClass : ""}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          data-testid="button-italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive("underline") ? activeClass : ""}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          data-testid="button-underline"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive("strike") ? activeClass : ""}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          data-testid="button-strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-0.5" />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="button-text-color"
            >
              <Palette className="h-3.5 w-3.5" />
              {currentColor && <span className="w-2 h-2 rounded-full ms-0.5" style={{ backgroundColor: currentColor }} />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="grid grid-cols-7 gap-1">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value || "default"}
                  className={`w-6 h-6 rounded-md border border-border flex items-center justify-center text-xs ${!c.value ? "bg-background" : ""}`}
                  style={c.value ? { backgroundColor: c.value } : undefined}
                  onClick={() => {
                    if (!c.value) {
                      editor.chain().focus().unsetColor().run();
                    } else {
                      editor.chain().focus().setColor(c.value).run();
                    }
                  }}
                  title={c.label}
                  data-testid={`color-${c.label}`}
                >
                  {!c.value && <RemoveFormatting className="h-3 w-3" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={editor.isActive("highlight") ? activeClass : ""}
              data-testid="button-highlight"
            >
              <Highlighter className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="grid grid-cols-5 gap-1">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value || "none"}
                  className={`w-6 h-6 rounded-md border border-border flex items-center justify-center text-xs ${!c.value ? "bg-background" : ""}`}
                  style={c.value ? { backgroundColor: c.value } : undefined}
                  onClick={() => {
                    if (!c.value) {
                      editor.chain().focus().unsetHighlight().run();
                    } else {
                      editor.chain().focus().toggleHighlight({ color: c.value }).run();
                    }
                  }}
                  title={c.label}
                  data-testid={`highlight-${c.label}`}
                >
                  {!c.value && <RemoveFormatting className="h-3 w-3" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <div className="w-px h-5 bg-border mx-0.5" />

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive("bulletList") ? activeClass : ""}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          data-testid="button-bullet-list"
        >
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive("orderedList") ? activeClass : ""}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          data-testid="button-ordered-list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive("blockquote") ? activeClass : ""}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          data-testid="button-blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-0.5" />

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive({ textAlign: "left" }) ? activeClass : ""}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          data-testid="button-align-left"
        >
          <AlignLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive({ textAlign: "center" }) ? activeClass : ""}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          data-testid="button-align-center"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={editor.isActive({ textAlign: "right" }) ? activeClass : ""}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          data-testid="button-align-right"
        >
          <AlignRight className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-0.5" />

        <Popover open={showLinkPopover} onOpenChange={setShowLinkPopover}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={editor.isActive("link") ? activeClass : ""}
              data-testid="button-link"
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="flex flex-col gap-2">
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setLink();
                  }
                }}
                data-testid="input-link-url"
              />
              <div className="flex gap-1">
                <Button size="sm" onClick={setLink} disabled={!linkUrl.trim()} data-testid="button-apply-link">
                  {t("editor.applyLink", "Apply")}
                </Button>
                {editor.isActive("link") && (
                  <Button size="sm" variant="ghost" onClick={removeLink} data-testid="button-remove-link">
                    {t("editor.removeLink", "Remove")}
                  </Button>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            const { from, to } = editor.state.selection;
            if (from === to) {
              editor.chain().focus().selectAll().unsetAllMarks().clearNodes().run();
            } else {
              editor.chain().focus().unsetAllMarks().clearNodes().run();
            }
          }}
          data-testid="button-clear-format"
        >
          <RemoveFormatting className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-0.5" />

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          data-testid="button-undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          data-testid="button-redo"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {(leftActions || rightActions) ? (
        <div className="flex items-end gap-1 px-1 py-1">
          {leftActions}
          <div className="flex-1 min-w-0">
            <EditorContent editor={editor} />
          </div>
          {rightActions}
        </div>
      ) : (
        <EditorContent editor={editor} />
      )}

      <style>{`
        .tiptap .is-empty::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
          font-size: 0.875rem;
        }
        [dir="rtl"] .tiptap .is-empty::before {
          float: right;
        }
        .tiptap { outline: none; width: 100%; }
        .tiptap p { margin: 0; }
        .tiptap ul, .tiptap ol { padding-inline-start: 1.2em; margin: 0.2em 0; }
        .tiptap ul { list-style-type: disc; }
        .tiptap ol { list-style-type: decimal; }
        .tiptap a { color: hsl(var(--primary)); text-decoration: underline; cursor: pointer; }
        .tiptap blockquote { border-inline-start: 4px solid #9ca3af; padding-inline-start: 0.75em; margin: 0.4em 0; background-color: rgba(0, 0, 0, 0.04); border-radius: 0 4px 4px 0; padding-block: 0.25em; }
        .dark .tiptap blockquote { border-inline-start-color: #6b7280; background-color: rgba(255, 255, 255, 0.06); }
        [dir="rtl"] .tiptap blockquote { border-radius: 4px 0 0 4px; }
        .tiptap mark { border-radius: 2px; padding: 0 2px; }
        .ProseMirror { width: 100%; }
      `}</style>
    </div>
  );
}
