import type { Metadata } from "next"

import "./globals.css"
import { FONT_VARIABLES } from "@/lib/fonts"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Loupe",
  description:
    "Sequence, design, and print-impose a photobook or zine in the browser.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={cn("antialiased", "font-sans", FONT_VARIABLES)}>
      <body>{children}</body>
    </html>
  )
}
