/**
 * v1 of the product app is desktop-only, on purpose.
 *
 * A canvas tool with left and right panels has no honest mobile layout, and
 * none has been designed. Saying so plainly beats a half-considered squeeze.
 * The marketing site is a separate concern and stays responsive.
 */
export function DesktopOnlyNotice({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="font-heading text-lg font-medium">Loupe</span>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          Loupe needs a wider screen. Sequencing and laying out a book means
          seeing both facing pages at once — open this on a desktop.
        </p>
      </div>
    </div>
  )
}
