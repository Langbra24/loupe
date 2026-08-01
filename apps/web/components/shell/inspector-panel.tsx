"use client"

import { checkPageCount, sizeForRole, vandeGraafMargins } from "@loupe/core"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useEditorStore } from "@/state/editor-store"

/**
 * The right panel. Grows downward out of the mode switcher — hence the top
 * padding, which clears the floating tab group above it.
 *
 * Contents are placeholders. The brief is explicit that print controls stay as
 * placeholders until the Sequence/Design shell is validated.
 */
export function InspectorPanel() {
  const mode = useEditorStore((state) => state.mode)

  return (
    <aside className="flex h-full w-72 flex-col border-l bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-3 pt-14 pb-4">
          {mode === "print" ? <PrintControls /> : <DesignControls />}
        </div>
      </ScrollArea>
    </aside>
  )
}

function DesignControls() {
  const project = useEditorStore((state) => state.project)
  const selection = useEditorStore((state) => state.selection)

  const page = selection ? project.pages.find((p) => p.id === selection.pageId) : undefined
  const element =
    selection?.kind === "element"
      ? page?.elements.find((e) => e.id === selection.elementId)
      : undefined

  if (!element) {
    return (
      <>
        <Section title="Spread">
          <Row label="Page size" value={project.pageSize.name} />
          <Row
            label="Trim"
            value={`${project.pageSize.width} × ${project.pageSize.height} mm`}
          />
        </Section>
        <Separator />
        <Section title="Type scale">
          <Row label="Base" value={`${project.typeBaseSize} pt`} />
          <Row label="Ratio" value={String(project.typeRatio)} />
          <Row
            label="Caption"
            value={`${sizeForRole("caption", project.typeBaseSize, project.typeRatio)} pt`}
          />
          <Row
            label="Title"
            value={`${sizeForRole("title", project.typeBaseSize, project.typeRatio)} pt`}
          />
        </Section>
        <Hint>Select an element on the canvas to edit it.</Hint>
      </>
    )
  }

  return (
    <>
      <Section title={element.kind === "image" ? "Image" : "Text"}>
        <Row label="Name" value={element.name} />
        <Row label="X" value={formatPercent(element.frame.x)} />
        <Row label="Y" value={formatPercent(element.frame.y)} />
        <Row label="W" value={formatPercent(element.frame.width)} />
        <Row label="H" value={formatPercent(element.frame.height)} />
      </Section>
      <Separator />
      {element.kind === "image" ? (
        <Section title="Fit">
          <Row label="Mode" value={element.fit} />
          <Hint>Crop and fit controls land with the canvas engine.</Hint>
        </Section>
      ) : (
        <Section title="Typography">
          <Row label="Role" value={element.role} />
          <Row
            label="Size"
            value={`${sizeForRole(element.role, project.typeBaseSize, project.typeRatio)} pt`}
          />
          <Row label="Align" value={element.align} />
        </Section>
      )}
    </>
  )
}

function PrintControls() {
  const project = useEditorStore((state) => state.project)
  const check = checkPageCount(project.pages.length)
  const margins = vandeGraafMargins(project.pageSize)

  return (
    <>
      <Section title="Page count">
        <div className="flex items-center gap-2 pb-1">
          <Badge variant={check.isValidForSaddleStitch ? "secondary" : "destructive"}>
            {check.count} pages
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{check.message}</p>
      </Section>
      <Separator />
      <Section title="Margins — Van de Graaf canon">
        <Row label="Top" value={`${margins.top} mm`} />
        <Row label="Inner" value={`${margins.inner} mm`} />
        <Row label="Outer" value={`${margins.outer} mm`} />
        <Row label="Bottom" value={`${margins.bottom} mm`} />
      </Section>
      <Separator />
      <Section title="Imposition">
        <Row label="Binding" value="Saddle stitch" />
        <Row label="Bleed" value="3 mm" />
        <Row label="Fold preview" value="—" />
        <Hint>Imposition, fold preview and soft-proof are placeholders.</Hint>
      </Section>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="pb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs">{value}</span>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}
