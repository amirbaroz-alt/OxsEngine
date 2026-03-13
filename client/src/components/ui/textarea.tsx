import * as React from "react"
import { useTranslation } from "react-i18next"
import { isRtl } from "@/lib/i18n"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, dir, lang, spellCheck, autoCapitalize, ...props }, ref) => {
  const { i18n } = useTranslation()
  const rtl = isRtl(i18n.language)

  return (
    <textarea
      dir={dir ?? (rtl ? "rtl" : "ltr")}
      lang={lang ?? i18n.language}
      spellCheck={spellCheck ?? true}
      autoCapitalize={autoCapitalize ?? (rtl ? "none" : "sentences")}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
