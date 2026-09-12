"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import {
  CopilotChatToggleButton,
  CopilotPopup,
  useAgent,
  useAgentContext,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { BookOpenText, Mic, MicOff, Sparkles } from "lucide-react";
import { z } from "zod";
import type { ReaderContext } from "@/lib/reader-types";
import { VisualCard } from "./visual-card";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const ReaderBubble = forwardRef<HTMLButtonElement, React.ComponentProps<typeof CopilotChatToggleButton>>(function ReaderBubble(props, ref) {
  return (
    <CopilotChatToggleButton
      {...props}
      ref={ref}
      aria-label="Open Marginalia"
      className={`reader-bubble ${props.className || ""}`}
      openIcon={() => (
        <span className="reader-bubble__mark" aria-hidden="true">
          <BookOpenText size={25} />
          <Sparkles size={12} />
        </span>
      )}
    />
  );
});

type ReaderCompanionProps = {
  context: ReaderContext;
  canNavigate: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
};

const POLITE_COMMAND = "(?:please\\s+)?";
const NEXT_PAGE_COMMAND = new RegExp(`^${POLITE_COMMAND}(?:next page|turn (?:the )?page|page forward|go forward|move forward)[.!]?$`, "i");
const PREVIOUS_PAGE_COMMAND = new RegExp(`^${POLITE_COMMAND}(?:previous page|last page|page back|go back|move back|turn back)[.!]?$`, "i");
const OPEN_COMPANION_COMMAND = new RegExp(`^${POLITE_COMMAND}(?:open|show) (?:marginalia|the (?:assistant|companion))[.!]?$`, "i");
const CLOSE_COMPANION_COMMAND = new RegExp(`^${POLITE_COMMAND}(?:close|hide) (?:marginalia|the (?:assistant|companion))[.!]?$`, "i");
const STOP_LISTENING_COMMAND = new RegExp(`^${POLITE_COMMAND}(?:stop listening|disable (?:voice|hands[- ]free)(?: mode)?)[.!]?$`, "i");

export function ReaderCompanion({
  context,
  canNavigate,
  onNextPage,
  onPreviousPage,
}: ReaderCompanionProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [handsFreeEnabled, setHandsFreeEnabled] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [lastHeard, setLastHeard] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const keepListeningRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const voiceCommandRef = useRef<(transcript: string) => void>(() => undefined);
  const { agent, isReady } = useAgent({ agentId: "reader" });

  useAgentContext({
    description: "The reader's current book, reading position, visible passage, nearby context, and selected text. Never spoil beyond this supplied position.",
    value: context,
  });

  useFrontendTool(
    {
      name: "illustrate_book_scene",
      description: "Generate an interpretive illustration grounded in the reader's visible passage. Use whenever the reader asks to imagine, picture, visualize, or illustrate a scene.",
      parameters: z.object({
        prompt: z.string().describe("A precise, historically plausible description of the requested scene, grounded in the passage"),
      }),
      handler: async ({ prompt }) => {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            title: context.title,
            year: context.published,
            passage: context.selectedText || context.visibleText,
          }),
        });
        const data = await response.json();
        return JSON.stringify(data);
      },
      render: ({ status, result }) => <VisualCard status={status} result={result} />,
    },
    [context],
  );

  useFrontendTool(
    {
      name: "find_historical_reference",
      description: "Find a real public-domain or freely licensed visual reference for a historical object, place, garment, vehicle, or practice mentioned on the page.",
      parameters: z.object({
        query: z.string().describe("A specific, era-aware Wikimedia Commons image search query"),
      }),
      handler: async ({ query }) => {
        const response = await fetch(`/api/reference?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        return JSON.stringify(data);
      },
      render: ({ status, result }) => <VisualCard status={status} result={result} />,
    },
    [],
  );

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setHandsFreeEnabled(false);
    setLastHeard("");
  }, []);

  const submitVoicePrompt = useCallback(async (transcript: string) => {
    setOpen(true);
    if (!isReady || agent.isRunning) {
      setDraft(transcript);
      setSpeechError(agent.isRunning
        ? "Marginalia is still answering. Your latest words are ready in the message box."
        : "Marginalia is connecting. Your words are ready in the message box.");
      return;
    }

    setDraft("");
    setSpeechError("");
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: transcript });
    try {
      await agent.runAgent();
    } catch {
      setDraft(transcript);
      setSpeechError("I couldn't send that request. It is ready in the message box so you can try again.");
    }
  }, [agent, isReady]);

  const handleVoiceCommand = useCallback((rawTranscript: string) => {
    const transcript = rawTranscript.replace(/^\s*(?:hey\s+)?marginalia[,:]?\s*/i, "").trim();
    if (!transcript) {
      setOpen(true);
      setLastHeard("Marginalia is ready");
      return;
    }

    setLastHeard(`Heard: “${transcript}”`);
    if (STOP_LISTENING_COMMAND.test(transcript)) {
      stopListening();
    } else if (NEXT_PAGE_COMMAND.test(transcript)) {
      if (canNavigate) onNextPage();
      else setSpeechError("Open a book before asking me to turn the page.");
    } else if (PREVIOUS_PAGE_COMMAND.test(transcript)) {
      if (canNavigate) onPreviousPage();
      else setSpeechError("Open a book before asking me to turn the page.");
    } else if (OPEN_COMPANION_COMMAND.test(transcript)) {
      setOpen(true);
    } else if (CLOSE_COMPANION_COMMAND.test(transcript)) {
      setOpen(false);
    } else {
      void submitVoicePrompt(transcript);
    }
  }, [canNavigate, onNextPage, onPreviousPage, stopListening, submitVoicePrompt]);

  useEffect(() => {
    voiceCommandRef.current = handleVoiceCommand;
  }, [handleVoiceCommand]);

  const startListening = useCallback(() => {
    if (keepListeningRef.current) {
      stopListening();
      return;
    }

    const host = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Recognition = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechError("Voice input works in Chrome, Edge, and supported mobile browsers.");
      setOpen(true);
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    setHandsFreeEnabled(true);
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => {
      setListening(true);
      setSpeechError("");
    };
    recognition.onresult = (event) => {
      const finalTranscript = Array.from(event.results)
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      if (finalTranscript) voiceCommandRef.current(finalTranscript);
    };
    recognition.onend = () => {
      setListening(false);
      if (!keepListeningRef.current) return;
      restartTimerRef.current = window.setTimeout(() => {
        try {
          recognition.start();
        } catch {
          keepListeningRef.current = false;
          setHandsFreeEnabled(false);
          setSpeechError("Hands-free mode stopped. Select the microphone to start it again.");
        }
      }, 250);
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        keepListeningRef.current = false;
        setHandsFreeEnabled(false);
        setSpeechError("Microphone access is blocked. Allow it in your browser, then turn hands-free mode on again.");
      } else {
        setSpeechError("I couldn't hear that. Hands-free mode will keep listening.");
      }
    };
    try {
      recognition.start();
    } catch {
      keepListeningRef.current = false;
      setHandsFreeEnabled(false);
      setSpeechError("Voice mode could not start. Check this site's microphone permission.");
    }
  }, [stopListening]);

  useEffect(() => () => {
    keepListeningRef.current = false;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.abort();
  }, []);

  return (
    <div className="companion-dock" aria-label="Reading companion controls">
      <button
        className={`voice-orb ${handsFreeEnabled ? "voice-orb--listening" : ""}`}
        onClick={startListening}
        aria-pressed={handsFreeEnabled}
        aria-label={handsFreeEnabled ? "Turn off hands-free mode" : "Turn on hands-free mode"}
        title={handsFreeEnabled ? "Turn off hands-free mode" : "Turn on hands-free mode"}
      >
        {handsFreeEnabled ? <MicOff size={19} /> : <Mic size={19} />}
        <span>{handsFreeEnabled ? "Listening" : "Hands-free"}</span>
      </button>

      {(handsFreeEnabled || lastHeard || speechError) && (
        <div className="speech-note" role="status" aria-live="polite">
          {handsFreeEnabled && <strong><span className="speech-note__pulse" /> {listening ? "Hands-free mode on" : "Reconnecting microphone…"}</strong>}
          {lastHeard && <span>{lastHeard}</span>}
          {speechError && <span className="speech-note__error">{speechError}</span>}
          {handsFreeEnabled && <small>Say “next page”, “previous page”, or ask anything about the passage.</small>}
        </div>
      )}

      <CopilotPopup
        agentId="reader"
        open={open}
        onOpenChange={setOpen}
        width="min(440px, calc(100vw - 28px))"
        height="min(680px, calc(100vh - 120px))"
        clickOutsideToClose
        toggleButton={ReaderBubble}
        header={{ title: "Marginalia" }}
        labels={{
          modalHeaderTitle: "Marginalia",
          welcomeMessageText: context.visibleText
            ? "I’m here in the margin. Ask me to picture this scene, explain an unfamiliar object, or untangle the passage."
            : "Upload an EPUB and I’ll read alongside you.",
          chatInputPlaceholder: "Ask about this page…",
        }}
        inputValue={draft}
        onInputChange={setDraft}
      />
    </div>
  );
}
