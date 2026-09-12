"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookMarked, ChevronLeft, ChevronRight, Library, Upload } from "lucide-react";
import type { ReaderContext } from "@/lib/reader-types";
import { ReaderCompanion } from "./reader-companion";

const SAMPLE_TEXT = `It was a large square room, looking all the larger from the absence of all furniture. A vulgar flaring paper adorned the walls, but it was blotched in places with mildew, and here and there great strips had become detached and hung down, exposing the yellow plaster beneath. Opposite the door was a showy fireplace, surmounted by a mantelpiece of imitation white marble. On one corner of this was stuck the stump of a red wax candle. The solitary window was so dirty that the light was hazy and uncertain, giving a dull grey tinge to everything, which was intensified by the thick layer of dust which coated the whole apartment.`;
const DEFAULT_BOOK_PATH = "/books/a-study-in-scarlet.epub";
const DEFAULT_DEMO_LOCATION = "text/chapter-1-3.xhtml";

const EMPTY_CONTEXT: ReaderContext = {
  title: "A Study in Scarlet",
  author: "Arthur Conan Doyle",
  published: "1887",
  chapter: "Chapter III — The Lauriston Garden Mystery",
  location: "Demo passage",
  estimatedPage: "Preview",
  progress: 18,
  visibleText: SAMPLE_TEXT,
  surroundingText: SAMPLE_TEXT,
  selectedText: "",
};

type EpubBook = {
  ready: Promise<unknown>;
  loaded: { metadata: Promise<Record<string, string>>; navigation: Promise<{ toc?: Array<{ href: string; label: string }> }> };
  renderTo: (element: HTMLElement, options: Record<string, unknown>) => EpubRendition;
  spine: { items: unknown[] };
  destroy: () => void;
};

type EpubRendition = {
  display: (target?: string) => Promise<unknown>;
  next: () => Promise<unknown>;
  prev: () => Promise<unknown>;
  on: {
    (event: "relocated", handler: (location: EpubLocation) => void): void;
    (event: "selected", handler: (cfiRange: string, contents: { window: Window }) => void): void;
    (event: "touchstart" | "touchend", handler: (event: TouchEvent) => void): void;
  };
  getContents: () => Array<{ document: Document }>;
  themes: { default: (styles: Record<string, Record<string, string>>) => void };
  destroy: () => void;
};

type EpubLocation = {
  start?: {
    cfi?: string;
    href?: string;
    index?: number;
    displayed?: { page: number; total: number };
  };
};

type SwipeOrigin = {
  x: number;
  y: number;
  startedAt: number;
  target: EventTarget | null;
};

type SwipeTouchEvent = {
  touches: TouchList;
  changedTouches: TouchList;
  target: EventTarget | null;
};

const SWIPE_DISTANCE = 54;
const SWIPE_MAX_DURATION = 800;

function closestInteractiveElement(target: EventTarget | null) {
  const node = target as (Node & { closest?: (selector: string) => Element | null }) | null;
  const element = typeof node?.closest === "function" ? node : node?.parentElement;
  return typeof element?.closest === "function"
    ? element.closest("a, button, input, textarea, select, [role='button'], [contenteditable='true']")
    : null;
}

function documentHasSelection(target: EventTarget | null) {
  const document = (target as Node | null)?.ownerDocument;
  return Boolean(document?.getSelection?.() && !document.getSelection()?.isCollapsed);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function EpubReader() {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const swipeOriginRef = useRef<SwipeOrigin | null>(null);
  const [context, setContext] = useState<ReaderContext>(EMPTY_CONTEXT);
  const [hasBook, setHasBook] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
    };
  }, []);

  const captureVisibleText = useCallback(() => {
    const contents = renditionRef.current?.getContents() || [];
    const text = cleanText(contents.map((item) => item.document.body?.innerText || "").join(" "));
    const selection = cleanText(contents.map((item) => item.document.getSelection?.()?.toString() || "").join(" "));
    if (text) {
      setContext((current) => ({
        ...current,
        visibleText: text.slice(0, 6500),
        surroundingText: text.slice(0, 11000),
        selectedText: selection,
      }));
    }
  }, []);

  const beginSwipe = useCallback((event: SwipeTouchEvent) => {
    if (event.touches.length !== 1 || closestInteractiveElement(event.target)) {
      swipeOriginRef.current = null;
      return;
    }

    const touch = event.touches[0];
    swipeOriginRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startedAt: performance.now(),
      target: event.target,
    };
  }, []);

  const finishSwipe = useCallback((event: SwipeTouchEvent) => {
    const origin = swipeOriginRef.current;
    swipeOriginRef.current = null;
    const touch = event.changedTouches[0];
    if (!origin || !touch || documentHasSelection(origin.target)) return;

    const deltaX = touch.clientX - origin.x;
    const deltaY = touch.clientY - origin.y;
    const duration = performance.now() - origin.startedAt;
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
    if (duration > SWIPE_MAX_DURATION || Math.abs(deltaX) < SWIPE_DISTANCE || !isHorizontal) return;

    if (deltaX < 0) {
      void renditionRef.current?.next();
    } else {
      void renditionRef.current?.prev();
    }
  }, []);

  const loadBook = useCallback(async (file: File, initialLocation?: string) => {
    setLoading(true);
    setError("");
    try {
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      if (mountRef.current) mountRef.current.innerHTML = "";

      const { default: ePub } = await import("epubjs");
      const buffer = await file.arrayBuffer();
      const book = ePub(buffer) as unknown as EpubBook;
      bookRef.current = book;
      await book.ready;
      const metadata = await book.loaded.metadata;
      const navigation = await book.loaded.navigation;
      if (!mountRef.current) return;
      const rendition = book.renderTo(mountRef.current, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
        manager: "default",
      });
      renditionRef.current = rendition;
      rendition.themes.default({
        body: {
          color: "#2f2922 !important",
          background: "#f5eddd !important",
          "font-family": "Georgia, 'Times New Roman', serif !important",
          "line-height": "1.68 !important",
          padding: "clamp(18px, 5vw, 30px) !important",
          "touch-action": "pan-y pinch-zoom !important",
        },
        p: { "font-size": "clamp(1rem, 2.3vw, 1.08rem) !important" },
        a: { color: "#7c3228 !important" },
      });

      const toc = navigation.toc || [];
      rendition.on("relocated", (location: EpubLocation) => {
        const cfi = location?.start?.cfi || "";
        const href = location?.start?.href || "";
        const chapter = toc.find((item) => href.includes(item.href.split("#")[0]))?.label || "Current chapter";
        const displayed = location?.start?.displayed;
        const sectionIndex = location?.start?.index || 0;
        const sectionProgress = displayed ? displayed.page / Math.max(displayed.total, 1) : 0;
        const progress = Math.min(100, Math.round(((sectionIndex + sectionProgress) / Math.max(book.spine.items.length, 1)) * 100));
        setContext((current) => ({
          ...current,
          chapter: cleanText(chapter),
          location: cfi || href || "Current location",
          estimatedPage: displayed ? `${displayed.page} of ${displayed.total}` : `${progress}%`,
          progress,
        }));
        window.setTimeout(captureVisibleText, 80);
      });
      rendition.on("selected", (cfiRange: string, contents: { window: Window }) => {
        const selection = cleanText(contents.window.getSelection?.()?.toString() || "");
        setContext((current) => ({ ...current, selectedText: selection, location: cfiRange || current.location }));
      });
      rendition.on("touchstart", beginSwipe);
      rendition.on("touchend", finishSwipe);

      setContext({
        ...EMPTY_CONTEXT,
        title: cleanText(metadata.title || file.name.replace(/\.epub$/i, "")),
        author: cleanText(metadata.creator || "Unknown author"),
        published: cleanText(metadata.pubdate || metadata.date || "Publication year unavailable"),
        chapter: "Opening the book…",
        location: "Opening location",
        estimatedPage: "—",
        progress: 0,
        visibleText: "",
        surroundingText: "",
      });
      setHasBook(true);
      await rendition.display(initialLocation);
      window.setTimeout(captureVisibleText, 160);
    } catch (cause) {
      setHasBook(false);
      setError(cause instanceof Error ? cause.message : "This EPUB could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [beginSwipe, captureVisibleText, finishSwipe]);

  useEffect(() => {
    const controller = new AbortController();
    const loadDefaultBook = window.setTimeout(() => {
      void fetch(DEFAULT_BOOK_PATH, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error("The included demo book could not be loaded.");
          return response.blob();
        })
        .then((blob) => loadBook(
          new File([blob], "AStudyInScarlet.epub", { type: "application/epub+zip" }),
          DEFAULT_DEMO_LOCATION,
        ))
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(cause instanceof Error ? cause.message : "The included demo book could not be loaded.");
        });
    }, 0);

    return () => {
      window.clearTimeout(loadDefaultBook);
      controller.abort();
    };
  }, [loadBook]);

  return (
    <main className="reader-shell">
      <header className="reader-header">
        <div className="brand-lockup">
          <span className="brand-lockup__rule" />
          <div>
            <span className="brand-lockup__name">Marginalia</span>
            <span className="brand-lockup__tagline">a companion inside the book</span>
          </div>
        </div>

        <div className="book-meta" aria-live="polite">
          <span>{context.author}</span>
          <strong>{context.title}</strong>
        </div>

        <button className="upload-button" onClick={() => fileRef.current?.click()} disabled={loading}>
          <Upload size={16} />
          {loading ? "Opening…" : hasBook ? "Change book" : "Upload EPUB"}
        </button>
        <input
          ref={fileRef}
          className="sr-only"
          type="file"
          accept=".epub,application/epub+zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadBook(file);
          }}
        />
      </header>

      <section className="reading-desk">
        <aside className="reading-rail reading-rail--left">
          <span className="rail-label">Now reading</span>
          <div className="rail-chapter">{context.chapter}</div>
          <div className="rail-detail"><BookMarked size={15} /> {context.published}</div>
        </aside>

        <article
          className={`book-page ${hasBook ? "book-page--epub" : ""}`}
          onTouchStart={(event) => beginSwipe(event.nativeEvent)}
          onTouchEnd={(event) => finishSwipe(event.nativeEvent)}
        >
          <div className="page-ornament" aria-hidden="true" />
          <div ref={mountRef} className="epub-mount" hidden={!hasBook} />
          {!hasBook && (
            <div className="sample-page">
              <div className="sample-page__kicker">A Study in Scarlet · 1887</div>
              <h1>The Lauriston Garden Mystery</h1>
              <div className="chapter-flourish"><span />III<span /></div>
              <p className="drop-cap">{SAMPLE_TEXT}</p>
              <p>“There was no furniture of any sort in the room.”</p>
              <div className="sample-invitation">
                <Library size={18} />
                <span>This sample is ready to explore. Ask Marginalia to help you picture the room, or upload your own EPUB.</span>
              </div>
            </div>
          )}
          {error && <div className="reader-error">{error}</div>}
        </article>

        <aside className="reading-rail reading-rail--right">
          <span className="rail-label">Your place</span>
          <div className="progress-number">{context.progress}<small>%</small></div>
          <div className="progress-track"><span style={{ height: `${Math.max(context.progress, 3)}%` }} /></div>
          <span className="rail-page">Page {context.estimatedPage}</span>
        </aside>
      </section>

      <footer className="reader-controls">
        <button onClick={() => void renditionRef.current?.prev()} disabled={!hasBook} aria-label="Previous page">
          <ChevronLeft size={19} /> Previous
        </button>
        <div className="reader-controls__status" aria-live="polite">
          <span className="reader-controls__desktop-status">
            {hasBook ? context.chapter : "A sample passage · upload any EPUB to begin"}
          </span>
          <span className="reader-controls__mobile-status">
            <span>{context.title}</span>
            <strong>{context.progress}%</strong>
          </span>
          <ReaderCompanion
            context={context}
            canNavigate={hasBook}
            onNextPage={() => void renditionRef.current?.next()}
            onPreviousPage={() => void renditionRef.current?.prev()}
          />
        </div>
        <button onClick={() => void renditionRef.current?.next()} disabled={!hasBook} aria-label="Next page">
          Next <ChevronRight size={19} />
        </button>
      </footer>

    </main>
  );
}
