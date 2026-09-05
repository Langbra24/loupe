"use client"

import { useState } from "react"
import { ChatCircleIcon } from "@phosphor-icons/react"
import { ImageIcon } from "lucide-react"
import { Popover } from "@base-ui/react/popover"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { composeGitHubIssueUrl, FEEDBACK_MAX_LENGTH } from "@/lib/feedback-url"

/**
 * Bottom-left feedback control (R23). Composes a prefilled GitHub issue URL
 * (KTD9) and opens it in a new tab — the bookmaker submits under their own
 * GitHub account, and nothing is ever sent from Loupe itself (AE6).
 *
 * `name`/`email` are both optional (R23's follow-up) and fold into the
 * issue body rather than going anywhere else — there is still no backend
 * here. No confirmation email is sent for a given email address: that would
 * need a real backend beyond the Stripe-only one CLAUDE.md allows, so an
 * email here is just contact info the maintainer can read in the filed
 * issue and reply to by hand, not something Loupe acts on itself.
 *
 * The 2,000-character cap is enforced in the textarea itself (`maxLength`)
 * with a live counter, not just at submit time, so typing past the limit is
 * simply impossible rather than silently truncated later.
 *
 * The GitHub tab opening is still the real mechanism — that's what AE6's "no
 * backend, nothing sent from Loupe itself" actually rests on — the toast
 * (user-directed) is a same-app acknowledgment on top of it, not a claim that
 * an issue was filed without the bookmaker doing anything in the new tab.
 */
export function FeedbackControl() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [text, setText] = useState("")
  const toastManager = useToastManager()

  const canSubmit = text.trim().length > 0 && text.length <= FEEDBACK_MAX_LENGTH

  const handleSubmit = () => {
    if (!canSubmit) return
    const url = composeGitHubIssueUrl(text, { name, email })
    window.open(url, "_blank", "noopener,noreferrer")
    setName("")
    setEmail("")
    setText("")
    setOpen(false)
    toastManager.add({
      title: "Feedback submitted",
      description: "Will be reviewed in 2–3 business days. Thank you.",
    })
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <Button variant="secondary" size="sm">
            <ChatCircleIcon />
            Provide feedback
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

            {/* Both optional (R23) — folded into the issue body on submit,
                not sent anywhere on their own. Two columns rather than
                stacked: neither needs more than a short single line, and it
                keeps this from pushing the textarea further down. */}
            <div className="grid grid-cols-2 gap-2 pb-2">
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name (optional)"
                className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email (optional)"
                className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={FEEDBACK_MAX_LENGTH}
              placeholder="What's wrong, missing, or confusing?"
              rows={5}
              className="w-full resize-none rounded-lg border bg-background p-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />

            {/* A hint, not an upload control — feedback still only ever
                composes a URL and opens a new tab (AE6), and GitHub's own
                issue form already accepts a dragged or pasted screenshot
                once the bookmaker is there. */}
            <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
              <ImageIcon className="size-3.5 shrink-0" />
              You can attach screenshots on the GitHub issue page after it opens.
            </div>

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
                Submit feedback
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
