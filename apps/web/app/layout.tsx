import type { Metadata } from "next"
import { Geist, Lora } from "next/font/google"

import "./globals.css"
import { cn } from "@/lib/utils";

const loraHeading = Lora({subsets:['latin'],variable:'--font-heading'});

const geist = Geist({subsets:['latin'],variable:'--font-sans'})

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
    <html
      lang="en"
      className={cn("antialiased", "font-sans", geist.variable, loraHeading.variable)}
    >
      <body>{children}</body>
    </html>
  )
}
