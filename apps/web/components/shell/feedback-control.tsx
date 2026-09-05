"use client"

import { useRef, useState } from "react"
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
 *
 * The screenshot button (per direct follow-up) opens the OS file picker via
 * the exact same hidden-input pattern `ImportPhotosButton` uses — but there
 * is still nowhere in Loupe for a picked file to actually go: AE6 rules out
 * a backend to upload it to, and a GitHub issue URL has no query parameter
 * that attaches a file to the page it opens. The best this can honestly do
 * is copy the image to the OS clipboard, so the one remaining manual step
 * once the GitHub tab opens is a paste instead of a re-pick from disk.
 */
export function FeedbackControl() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [text, setText] = useState("")
  const [screenshot, setScreenshot] = useState<{ name: string; copied: boolean } | null>(null)
  const screenshotInputRef = useRef<HTMLInputElement | null>(null)
  const toastManager = useToastManager()

  const canSubmit = text.trim().length > 0 && text.length <= FEEDBACK_MAX_LENGTH

  const handleScreenshotChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset so re-picking the same file still fires a change event — same
    // reasoning as ImportPhotosButton's identical line.
    event.target.value = ""
    if (!file) return

    try {
      await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })])
      setScreenshot({ name: file.name, copied: true })
    } catch {
      // Clipboard image writes aren't universally supported (Safari's own
      // rules, a non-secure context, a permission denial) — the file was
      // still picked, so say so, just without promising a paste will work.
      setScreenshot({ name: file.name, copied: false })
    }
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    const url = composeGitHubIssueUrl(text, { name, email })
    window.open(url, "_blank", "noopener,noreferrer")
    setName("")
    setEmail("")
    setText("")
    setScreenshot(null)
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
                not sent anywhere on their own. Stacked, not side by side
                (user-directed). */}
            <div className="flex flex-col gap-2 pb-2">
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

            {/* Same hidden-input trigger `ImportPhotosButton` uses for the
                canvas's own "+" — see this component's doc comment for what
                actually happens to the picked file. */}
            <input
              ref={screenshotInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleScreenshotChange}
            />
            <div className="flex items-center gap-1.5 pt-1.5 text-xs text-muted-foreground">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Add a screenshot"
                onClick={() => screenshotInputRef.current?.click()}
              >
                <ImageIcon className="size-3.5" />
              </Button>
              {screenshot ? (
                <span className="truncate">
                  {screenshot.copied
                    ? `${screenshot.name} copied — paste it (⌘V/Ctrl+V) into the GitHub issue.`
                    : `${screenshot.name} selected — attach it manually on the GitHub issue page.`}
                </span>
              ) : (
                <span>Add a screenshot, or attach one directly on the GitHub issue page.</span>
              )}
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
