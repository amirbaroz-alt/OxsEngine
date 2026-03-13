import * as React from "react"
import { useTranslation } from "react-i18next"
import { isRtl } from "@/lib/i18n"

import { cn } from "@/lib/utils"

const LTR_TYPES = new Set(["email", "password", "url", "tel", "number", "date", "time", "datetime-local"])

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, dir, lang, spellCheck, autoCapitalize, ...props }, ref) => {
    const { i18n } = useTranslation()
    const rtl = isRtl(i18n.language)
    const forceLtr = LTR_TYPES.has(type || "")

    return (
      <input
        type={type}
        dir={dir ?? (forceLtr ? "ltr" : rtl ? "rtl" : "ltr")}
        lang={lang ?? (forceLtr ? "en" : i18n.language)}
        spellCheck={spellCheck ?? !forceLtr}
        autoCapitalize={autoCapitalize ?? (forceLtr ? "none" : rtl ? "none" : "sentences")}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
