"use client"

import { useState } from "react"
import { ChatCircleIcon } from "@phosphor-icons/react"
import { Popover } from "@base-ui/react/popover"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { modifierLabel, usePlatform } from "@/components/sequence/use-platform"
import { cn, stagger } from "@/lib/utils"
import { FEEDBACK_MAX_LENGTH } from "@/lib/feedback-url"

/**
 * Bottom-left feedback control (R23). POSTs to `app/api/feedback/route.ts`,
 * which files it as a real GitHub issue on the server — see that route's
 * doc comment and CLAUDE.md's Hard rules for why a backend exists for this
 * one thing.
 *
 * Direct follow-up that replaced the original design: this used to compose
 * a prefilled `github.com/.../issues/new` URL and open it in a new tab,
 * which meant the bookmaker had to sign into GitHub themselves to actually
 * submit, and the maintainer got no notification either way. Neither was
 * the actual goal — "send my feedback to GitHub" — so the control now
 * submits directly and never opens GitHub at all.
 *
 * The screenshot/attachment picker from the URL-based version is gone with
 * it: it only ever worked by copying the image to the clipboard for the
 * bookmaker to paste into the GitHub compose page that used to open — with
 * no such page opening anymore, there's nowhere left to paste it, and
 * GitHub's REST API has no field for attaching an image to a freshly
 * created issue. Re-adding real attachment support is a distinct, bigger
 * feature (GitHub's image-upload flow is tied to its own web UI, not a
 * plain API call) than this fix, not a casual add-back.
 *
 * `email` is optional and folds into the issue body — see
 * `composeFeedbackBody`. It is the only contact field: the filed issue is
 * public, so there is no Name field (#70), just enough for a reply.
 *
 * The 2,000-character cap is enforced in the textarea itself (`maxLength`)
 * with a live counter, not just at submit time, so typing past the limit is
 * simply impossible rather than silently truncated later. The API route
 * re-checks it server-side too, since a client's own `maxLength` is never
 * trusted.
 *
 * The popover's fields cascade in via `.stagger-section` (globals.css) on
 * open — the same reveal the onboarding intro dialog and the export dialog
 * use, applied here at direct user request: title/description, the email
 * row, the textarea, then the counter/submit row each land on their own
 * delay rather than popping in together.
 *
 * Cmd/Ctrl+Enter in the textarea submits through the same `handleSubmit`
 * (#56); the Submit button names the shortcut in a `<kbd>`, as the canvas
 * toolbars' tooltips do.
 */
export function FeedbackControl() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [text, setText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const toastManager = useToastManager()
  const modifier = modifierLabel(usePlatform())
  const submitShortcut = modifier ? `${modifier} ↵` : null

  const canSubmit = text.trim().length > 0 && text.length <= FEEDBACK_MAX_LENGTH && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)

    // `toastManager.promise` (the base/toast reference's own pattern for
    // exactly this shape of work) shows the loading toast immediately and
    // morphs it in place into the success/error one once the request
    // settles, rather than this component juggling three separate
    // `.add()` calls itself.
    try {
      await toastManager.promise(
        submitFeedback({ feedback: text, contact: { email } }),
        {
          loading: { title: "Sending feedback…", type: "loading" },
          success: {
            title: "Feedback sent",
            description: "We'll review your feedback in 2–3 business days.",
            timeout: 3500,
            type: "success",
          },
          error: (error: unknown) => ({
            title: "Couldn't send feedback",
            description: error instanceof FeedbackError ? error.message : UNREACHABLE_MESSAGE,
            type: "error",
          }),
        },
      )

      setEmail("")
      setText("")
      setOpen(false)
    } catch (error) {
      // Already surfaced as the error toast above — swallowed here so the
      // popover stays open with the draft intact for a retry, rather than
      // an unhandled rejection.
      console.error("Failed to submit feedback:", error)
    } finally {
      setSubmitting(false)
    }
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
            <div className="stagger-section" style={stagger(0)}>
              <Popover.Title className="text-sm font-medium">Send feedback</Popover.Title>
              <Popover.Description className="pt-0.5 pb-2 text-xs text-muted-foreground">
                The more detail, the better: what you were doing, what you expected, and what happened.
              </Popover.Description>
            </div>

            {/* Optional — folded into the issue body on submit, not sent
                anywhere on its own. */}
            <div className="stagger-section pb-2" style={stagger(1)}>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email (optional)"
                aria-label="Email (optional)"
                disabled={submitting}
                className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus-ring disabled:opacity-50"
              />
            </div>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={FEEDBACK_MAX_LENGTH}
              placeholder="What's wrong, missing, or confusing?"
              aria-label="Feedback"
              rows={5}
              disabled={submitting}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
                if (event.nativeEvent.isComposing) return
                event.preventDefault()
                void handleSubmit()
              }}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              className="stagger-section w-full resize-none rounded-lg border bg-background p-2 text-sm outline-none focus-ring disabled:opacity-50"
              style={stagger(2)}
            />

            <div className="stagger-section flex items-center justify-between pt-2" style={stagger(3)}>
              <span
                className={cn(
                  "text-xs tabular-nums text-muted-foreground",
                  text.length >= FEEDBACK_MAX_LENGTH && "text-destructive",
                )}
              >
                {text.length} / {FEEDBACK_MAX_LENGTH}
              </span>
              {/* Both labels share one grid cell and the hidden one keeps its
                  space, so the button holds the wider label's width while
                  sending instead of shrinking (#56). */}
              <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
                <span className="grid justify-items-center">
                  <span className={cn("col-start-1 row-start-1 flex items-center gap-1.5", submitting && "invisible")}>
                    Submit feedback
                    {submitShortcut && (
                      <kbd data-slot="kbd" aria-hidden className="rounded bg-background/20 px-1 font-sans">
                        {submitShortcut}
                      </kbd>
                    )}
                  </span>
                  <span className={cn("col-start-1 row-start-1", !submitting && "invisible")}>Sending…</span>
                </span>
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

const UNREACHABLE_MESSAGE = "Couldn't reach Sequence's server. Check your connection; your note is still here."

/** A failure the route explained. Its message is written for the bookmaker
 *  (see `describeGitHubFailure` in the route), so the toast shows it as is. */
class FeedbackError extends Error {}

async function submitFeedback(payload: { feedback: string; contact: { email: string } }) {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (response.ok) return response

  const { error } = (await response.json().catch(() => ({}))) as { error?: unknown }
  throw new FeedbackError(
    typeof error === "string" ? error : `Feedback couldn't be sent (error ${response.status}). Please try again.`,
  )
}
