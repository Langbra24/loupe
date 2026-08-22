"use client"

import { useState } from "react"
import { ChatCircleIcon } from "@phosphor-icons/react"
import { Popover } from "@base-ui/react/popover"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { composeGitHubIssueUrl, FEEDBACK_MAX_LENGTH } from "@/lib/feedback-url"

/**
 * Bottom-left feedback control (R23). Composes a prefilled GitHub issue URL
 * (KTD9) and opens it in a new tab — the bookmaker submits under their own
 * GitHub account, and nothing is ever sent from Loupe itself (AE6).
 *
 * The 2,000-character cap is enforced in the textarea itself (`maxLength`)
 * with a live counter, not just at submit time, so typing past the limit is
 * simply impossible rather than silently truncated later.
 */
export function FeedbackControl() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")

  const canSubmit = text.trim().length > 0 && text.length <= FEEDBACK_MAX_LENGTH

  const handleSubmit = () => {
    if (!canSubmit) return
    const url = composeGitHubIssueUrl(text)
    window.open(url, "_blank", "noopener,noreferrer")
    setText("")
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button variant="secondary" size="icon-sm" aria-label="Send feedback">
            <ChatCircleIcon />
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8}>
          <Popover.Popup className="z-50 w-80 origin-(--transform-origin) rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Popover.Title className="text-sm font-medium">Send feedback</Popover.Title>
            <Popover.Description className="pt-0.5 pb-2 text-xs text-muted-foreground">
              Opens a prefilled GitHub issue under your own account — nothing is sent from Loupe
              itself.
            </Popover.Description>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={FEEDBACK_MAX_LENGTH}
              placeholder="What's wrong, missing, or confusing?"
              rows={5}
              className="w-full resize-none rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />

            <div className="flex items-center justify-between pt-2">
              <span
                className={cn(
                  "text-xs tabular-nums text-muted-foreground",
                  text.length >= FEEDBACK_MAX_LENGTH && "text-destructive",
                )}
              >
                {text.length} / {FEEDBACK_MAX_LENGTH}
              </span>
              <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
                Open issue on GitHub
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
