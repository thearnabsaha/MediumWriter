import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Medium Writer — AI articles that paste cleanly into Medium",
  description:
    "Generate or rewrite Medium-ready articles in your own writing style. Copy and paste into Medium with formatting preserved.",
  applicationName: "Medium Writer",
  authors: [{ name: "Medium Writer" }],
  keywords: [
    "medium",
    "ai writer",
    "article generator",
    "medium article",
    "rewrite article",
    "groq",
    "tavily",
  ],
  openGraph: {
    title: "Medium Writer — AI articles that paste cleanly into Medium",
    description:
      "Generate or rewrite Medium-ready articles in your own writing style.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1a8917" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var raw = localStorage.getItem('medium-writer-store');
                  if (raw) {
                    var parsed = JSON.parse(raw);
                    if (parsed && parsed.state && parsed.state.darkMode) {
                      document.documentElement.classList.add('dark');
                    }
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
