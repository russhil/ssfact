import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sport Sun — Production OS",
  description: "Garment production & inventory ERP",
  applicationName: "Sport Sun Production OS",
  // favicon.ico / icon.png / apple-icon.png sit next to this file and are picked
  // up by Next's file conventions; this only adds the ones it can't infer.
  manifest: "/site.webmanifest",
};

/* Colours the mobile browser chrome to match the app shell in each theme. */
export const viewport: Viewport = {
  // cover so `env(safe-area-inset-*)` reports real values on notched phones —
  // the bottom nav pads by inset-bottom.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1e" },
  ],
};

/**
 * Runs before first paint so the theme and density are already on <html> when
 * the page renders — otherwise a dark-mode user gets a white flash on every
 * navigation. Deliberately inline and synchronous; keep it tiny.
 */
const BOOT = `(function(){try{
var d=document.documentElement;
var t=localStorage.getItem('sportsun-theme');
if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
if(t==='dark')d.classList.add('dark');
d.dataset.density=localStorage.getItem('sportsun-density')||'comfortable';
}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
