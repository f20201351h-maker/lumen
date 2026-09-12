# Marginalia

Marginalia is an AI reading companion that lives inside an EPUB reader. It understands the visible passage and reading position, explains unfamiliar language and historical objects, untangles difficult prose, and creates scene illustrations without requiring the reader to leave the book.

The repository is a hackathon-ready functional prototype built with Next.js, EPUB.js, CopilotKit, OpenAI, and optional OpenRouter routing.

## What works

- Upload and read a local EPUB in the browser
- Navigate between EPUB pages and track progress
- Capture book metadata, chapter, EPUB CFI, visible text, nearby text, and selected text
- Ask contextual questions through a floating CopilotKit companion
- Turn on hands-free mode once, then ask questions or control the reader continuously by voice
- Say “next page” or “previous page” to navigate without touching the reader
- Open the companion and submit spoken requests automatically, including scene-illustration requests
- Generate passage-grounded illustrations
- Find real historical reference images through Wikimedia Commons
- Switch text and image providers independently between OpenAI and OpenRouter
- Start with the included public-domain edition of *A Study in Scarlet*, opened at “The Lauriston Gardens Mystery” for the demo
- Keep agent answers inside the supplied reading context to reduce spoilers

## Run locally

Requirements: Node.js 20 or newer and an API key for the chosen provider.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

An OpenAI key has already been saved locally in this workspace. `.env.local` is ignored by Git and must never be committed. Each teammate should create their own local environment file.

## Provider configuration

Use OpenAI for both text and image generation:

```dotenv
AI_PROVIDER=openai
IMAGE_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_IMAGE_MODEL=gpt-image-1.5
```

Use the hackathon OpenRouter credit for both:

```dotenv
AI_PROVIDER=openrouter
IMAGE_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-5.6-luna
OPENROUTER_IMAGE_MODEL=openai/gpt-image-2.5-flare
```

You can mix providers. For example, set `AI_PROVIDER=openrouter` and `IMAGE_PROVIDER=openai`. Restart the development server after changing environment variables.

OpenRouter image models and parameters vary. Choose a model returned by its image-model catalog if the example slug is unavailable to your hackathon account.

## How the context works

EPUBs are reflowable and do not contain stable print page numbers. Marginalia passes the agent the current chapter, EPUB location (CFI), visible text, nearby chapter text, estimated screen page, selection, and progress percentage. The system prompt tells the model to treat this boundary as the reader's furthest known position and avoid later plot events.

The current prototype sends the rendered section text available around the current view. A production version should build a bounded context window from the current spine item plus adjacent spine items, and should persist the furthest-read CFI per book.

## Useful commands

```bash
npm run dev
npm run build
npm run lint
npm run check:provider
npm run check:openrouter # validates the saved OpenRouter key without printing it
npm run check:epub # with the app running on port 3000
npm start
```

The EPUB check opens the included public-domain fixture in a local Chrome or Brave browser and verifies that text remains visible while turning pages. Set `READER_URL` or `CHROME_PATH` when using a different port or browser location.

## Known limits

- Browser speech recognition is best supported by Chromium browsers.
- Browsers require one initial interaction to grant microphone permission; after that, hands-free mode automatically resumes listening until the reader says “stop listening” or selects the microphone again.
- EPUB presentation varies because publishers ship their own styles and markup.
- The generated OpenAI Platform key currently reaches the API, but its selected project has no remaining credits. Configure the supplied OpenRouter credit or add OpenAI credits for live generation.
- Historical references use the first suitable Wikimedia Commons image search result. The card links to its source page for date, creator, and license details.
- `npm audit` currently reports 10 transitive advisories: XML-parser findings through EPUB.js and networking findings through packages bundled by CopilotKit. The available EPUB.js audit fix is a breaking version change. Review these upgrades before treating arbitrary EPUBs as production-safe input.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for component boundaries and [TEAM_HANDOFF.md](./TEAM_HANDOFF.md) for suggested parallel work.
