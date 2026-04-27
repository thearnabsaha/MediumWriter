import DarkModeToggle from "@/components/DarkModeToggle";
import StyleBlock from "@/components/StyleBlock";
import WriteBlock from "@/components/WriteBlock";

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white dark:bg-neutral-100 dark:text-ink">
              <span className="font-serif text-lg font-bold">M</span>
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight text-ink dark:text-neutral-100">
                Medium Writer
              </h1>
              <p className="text-xs text-ink-muted dark:text-neutral-400">
                AI articles, perfectly pasteable
              </p>
            </div>
          </div>
          <DarkModeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="min-h-[600px]">
            <WriteBlock />
          </div>
          <aside className="min-h-[600px] lg:sticky lg:top-20 lg:self-start">
            <StyleBlock />
          </aside>
        </div>
      </div>

      <footer className="mx-auto max-w-7xl px-4 py-8 text-center text-xs text-ink-muted dark:text-neutral-500 sm:px-6">
        Built with Next.js + Groq Llama 3.3 70B. Output tags are restricted to
        Medium&apos;s paste whitelist.
      </footer>
    </main>
  );
}
