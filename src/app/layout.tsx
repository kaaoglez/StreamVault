import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StreamVault - Your Personal Streaming Hub",
  description:
    "Stream movies and series from your personal collection. A Netflix-style streaming experience for your own content.",
  keywords: [
    "StreamVault",
    "streaming",
    "movies",
    "series",
    "personal media",
    "Netflix clone",
  ],
  authors: [{ name: "StreamVault" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "StreamVault",
    description: "Your personal streaming hub",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "StreamVault",
    description: "Your personal streaming hub",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-stream-bg text-white`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
