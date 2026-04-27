import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type StyleBlock = {
  id: string;
  content: string;
  createdAt: number;
};

export const MAX_STYLE_BLOCKS = 5;
export const MAX_STYLE_BLOCK_LENGTH = 5000;

type State = {
  styleBlocks: StyleBlock[];
  darkMode: boolean;
  lastOutput: string;
  lastPrompt: string;
};

type Actions = {
  addStyleBlock: (content: string) => void;
  removeStyleBlock: (id: string) => void;
  clearStyleBlocks: () => void;
  toggleDarkMode: () => void;
  setLastOutput: (output: string) => void;
  setLastPrompt: (prompt: string) => void;
};

export const useStore = create<State & Actions>()(
  persist(
    (set) => ({
      styleBlocks: [],
      darkMode: false,
      lastOutput: "",
      lastPrompt: "",

      addStyleBlock: (content) =>
        set((state) => {
          const trimmed = content.trim();
          if (!trimmed) return state;
          const next: StyleBlock = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            content: trimmed.slice(0, MAX_STYLE_BLOCK_LENGTH),
            createdAt: Date.now(),
          };
          const blocks = [next, ...state.styleBlocks].slice(0, MAX_STYLE_BLOCKS);
          return { styleBlocks: blocks };
        }),

      removeStyleBlock: (id) =>
        set((state) => ({
          styleBlocks: state.styleBlocks.filter((b) => b.id !== id),
        })),

      clearStyleBlocks: () => set({ styleBlocks: [] }),

      toggleDarkMode: () =>
        set((state) => {
          const next = !state.darkMode;
          if (typeof document !== "undefined") {
            document.documentElement.classList.toggle("dark", next);
          }
          return { darkMode: next };
        }),

      setLastOutput: (output) => set({ lastOutput: output }),
      setLastPrompt: (prompt) => set({ lastPrompt: prompt }),
    }),
    {
      name: "medium-writer-store",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      partialize: (state) => ({
        styleBlocks: state.styleBlocks,
        darkMode: state.darkMode,
        lastOutput: state.lastOutput,
        lastPrompt: state.lastPrompt,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.darkMode && typeof document !== "undefined") {
          document.documentElement.classList.add("dark");
        }
      },
    },
  ),
);
