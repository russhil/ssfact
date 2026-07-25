import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sportsun — Production OS",
  description: "Garment production & inventory ERP",
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
