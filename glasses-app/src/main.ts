import {
  waitForEvenAppBridge,
  TextContainerProperty,
  ImageContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
  MenuContainerProperty,
  MenuItemProperty,
} from '@evenrealities/even_hub_sdk'
import { Glyph, tick, type GlyphState } from './glyph'
import { Waveform } from './wave'
import { cardText, drawChart, hasVisual, plain, type Presentation } from './cards'
import { sortTasks, taskDetail, taskRow } from './tasks'
import { png, sendImage } from './images'
import { ensureToken, forgetToken } from './pairing'
import {
  choiceAnswerText,
  configured,
  getHistory,
  getArtifact,
  getModels,
  getTasks,
  selectModel,
  getState,
  listen,
  sendText,
  transcribe,
  stop,
  type Activity,
  type NodMessage,
  type ModelsView,
  type NodState,
} from './nod'
import { mountPrompts, mountUi, setStatus, setTranscript } from './ui'

mountUi()
const bridge = await waitForEvenAppBridge()

// ---- containers -----------------------------------------------------------------
// IDs are stable across page rebuilds. 1 = body text, 2 = status, 3 = glyph, 4 = waveform, 5 = list.
const BODY = { id: 1, name: 'nod' }
const STATUS = { id: 2, name: 'status' }
const GLYPH = { id: 3, name: 'glyph' }
const WAVE = { id: 4, name: 'wave', width: 200, height: 28 } // only on the listening screen
const LIST = { id: 5, name: 'list' }
const CARD = { id: 6, name: 'card', width: 288, height: 144 } // the largest image a container takes
const MENU = { YES: 1, NO: 2, CHOICES: 3, PROMPTS: 4, TASKS: 5, CARD: 6, MODEL: 7, STOP: 8 }
const menu = () =>
  new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemName: 'Yes, go ahead', itemID: MENU.YES }),
      new MenuItemProperty({ itemName: 'No', itemID: MENU.NO }),
      new MenuItemProperty({ itemName: 'Answer question', itemID: MENU.CHOICES }),
      new MenuItemProperty({ itemName: 'Saved prompts', itemID: MENU.PROMPTS }),
      new MenuItemProperty({ itemName: 'Tasks', itemID: MENU.TASKS }),
      new MenuItemProperty({ itemName: 'Show card', itemID: MENU.CARD }),
      new MenuItemProperty({ itemName: 'Model', itemID: MENU.MODEL }),
      new MenuItemProperty({ itemName: 'Stop task', itemID: MENU.STOP }),
    ],
  })

// Splash: big bouncing glyph over "Opening Nod…", like nod's own loading screen.
// The input layer is full-screen and behind, so double-tap exit works while we connect.
const SPLASH_GLYPH = 96
const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [
      new TextContainerProperty({ xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, paddingLength: 0, containerID: BODY.id, containerName: BODY.name, content: ' ', isEventCapture: 1, zOrderIndex: 0 }),
      new TextContainerProperty({ xPosition: 0, yPosition: 168, width: 576, height: 40, borderWidth: 0, paddingLength: 0, containerID: STATUS.id, containerName: STATUS.name, content: centre('Opening Nod…'), isEventCapture: 0, zOrderIndex: 1 }),
    ],
    imageObject: [
      new ImageContainerProperty({ xPosition: (576 - SPLASH_GLYPH) / 2, yPosition: 56, width: SPLASH_GLYPH, height: SPLASH_GLYPH, containerID: GLYPH.id, containerName: GLYPH.name, zOrderIndex: 2 }),
    ],
    menuObject: menu(),
  }),
)
if (created !== 0) setStatus('error', `createStartUpPageContainer failed: ${created}`)

const glyph = new Glyph(bridge, { ...GLYPH, size: SPLASH_GLYPH })
glyph.set('boot')
void glyph.run()
const wave = new Waveform(bridge, WAVE)

// "Centering means padding with spaces" (display docs). Measured on the simulator's font:
// ~8 px per character, ~4.8 px per space. Approximate; the firmware font isn't monospaced.
function centre(text: string) {
  return ' '.repeat(Math.max(0, Math.round((576 - text.length * 8) / 2 / 4.8))) + text
}

// ---- views ------------------------------------------------------------------------
// chat: the conversation as text. list: a title (e.g. nod's question) over a native list;
// `tall` gives the title more room (the "You said" check). page: a full text page, optionally
// with a picture (a card, a task); tap closes it. listen: the voice screen.
type ListView = { kind: 'list'; title: string; items: string[]; pick: (index: number) => void; tall?: boolean }
type PageView = { kind: 'page'; text: string; image?: Uint8Array; close: () => void }
type View = { kind: 'chat' } | { kind: 'listen' } | ListView | PageView
let view: View = { kind: 'chat' }
let page: 'splash' | 'main' = 'splash'
const MAIN_GLYPH = 40
const LISTEN_GLYPH = 80
const LIST_ITEM_MAX = 60 // lists take 64 chars per item

// Main layout: Speck-style glyph top-left, status beside it, then the body. Lists can't be
// updated in place, so every view change is a page rebuild.
async function layout(next: View) {
  view = next
  if (next.kind === 'chat' && mode === 'idle') header = idleHeader() // back from a list: drop its prompt
  if (next.kind === 'listen') return layoutListen()
  const list = next.kind === 'list'
  const tall = list && next.tall
  const image = next.kind === 'page' ? next.image : undefined
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 3 + (list || image ? 1 : 0),
      textObject: [
        new TextContainerProperty({ xPosition: 0, yPosition: 48, width: 576, height: tall ? 108 : list || image ? 52 : 240, borderWidth: 0, paddingLength: 4, containerID: BODY.id, containerName: BODY.name, content: ' ', isEventCapture: list ? 0 : 1 }),
        new TextContainerProperty({ xPosition: 52, yPosition: 8, width: 520, height: 36, borderWidth: 0, paddingLength: 0, containerID: STATUS.id, containerName: STATUS.name, content: ' ', isEventCapture: 0 }),
      ],
      imageObject: [
        new ImageContainerProperty({ xPosition: 4, yPosition: 4, width: MAIN_GLYPH, height: MAIN_GLYPH, containerID: GLYPH.id, containerName: GLYPH.name }),
        ...(image ? [new ImageContainerProperty({ xPosition: (576 - CARD.width) / 2, yPosition: 104, width: CARD.width, height: CARD.height, containerID: CARD.id, containerName: CARD.name })] : []),
      ],
      ...(list
        ? {
            listObject: [
              new ListContainerProperty({
                xPosition: 0,
                yPosition: tall ? 156 : 100,
                width: 576,
                height: tall ? 132 : 188,
                borderWidth: 0,
                paddingLength: 4,
                containerID: LIST.id,
                containerName: LIST.name,
                isEventCapture: 1,
                itemContainer: new ListItemContainerProperty({ itemCount: next.items.length, itemWidth: 560, isItemSelectBorderEn: 1, itemName: next.items }),
              }),
            ],
          }
        : {}),
      menuObject: menu(), // omitting it on a rebuild would clear the menu
    }),
  )
  finishLayout(MAIN_GLYPH)
  // Images can only be sent once the page exists (display docs).
  if (image) void sendImage(bridge, CARD.id, CARD.name, image).catch((error) => console.warn('[card]', error))
}

// Voice screen: everything else cleared; a big logo whose dot circles it, the waveform under it,
// the timer, then what nod has heard so far.
async function layoutListen() {
  await bridge.rebuildPageContainer(
    new RebuildPageContainer({
      containerTotalNum: 4,
      textObject: [
        new TextContainerProperty({ xPosition: 0, yPosition: 168, width: 576, height: 120, borderWidth: 0, paddingLength: 8, containerID: BODY.id, containerName: BODY.name, content: ' ', isEventCapture: 1 }),
        new TextContainerProperty({ xPosition: 0, yPosition: 130, width: 576, height: 34, borderWidth: 0, paddingLength: 0, containerID: STATUS.id, containerName: STATUS.name, content: ' ', isEventCapture: 0 }),
      ],
      imageObject: [
        new ImageContainerProperty({ xPosition: (576 - LISTEN_GLYPH) / 2, yPosition: 8, width: LISTEN_GLYPH, height: LISTEN_GLYPH, containerID: GLYPH.id, containerName: GLYPH.name }),
        new ImageContainerProperty({ xPosition: (576 - WAVE.width) / 2, yPosition: 96, width: WAVE.width, height: WAVE.height, containerID: WAVE.id, containerName: WAVE.name }),
      ],
      menuObject: menu(),
    }),
  )
  finishLayout(LISTEN_GLYPH)
}

function finishLayout(glyphSize: number) {
  page = 'main'
  lastHeader = lastBody = '' // the rebuild blanked the text containers
  glyph.retarget({ ...GLYPH, size: glyphSize })
  void render()
}

// ---- display ------------------------------------------------------------------------
let header = ''
let you = ''
let reply = ''
let lastHeader = ''
let lastBody = ''
let rendering = false
let pumpQueued = false

// ---- reader: pages + natural text flow ---------------------------------------------
// A reply is split into glance-sized pages; swipe down past the end of a page for the next.
// Fresh replies are revealed at reading pace, easing at commas and full stops (OcuClaw's
// "Natural Text Flow"); history and anything already on screen at boot appear instantly.
const PAGE_CHARS = 330
const CHAR_MS = 26 // ~38 chars/s: a steady flow you can read along with
let pageIdx = 0
let readerKey = '' // identity of the reply being read; a new one resets the page and pacing
let pacedReply = false
let paceFrom = 0 // when revealing the current page began; 0 = show it all

function paginate(text: string): string[] {
  // Units to pack: paragraphs, else sentences, else words.
  const units: { text: string; sep: string }[] = []
  for (const paragraph of text.split(/\n{2,}/)) {
    const sentences = paragraph.length <= PAGE_CHARS ? [paragraph] : (paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph])
    sentences.forEach((sentence, i) => {
      const sep = i === 0 ? '\n\n' : ' '
      if (sentence.length <= PAGE_CHARS) return void units.push({ text: sentence.trim(), sep })
      sentence.split(/\s+/).forEach((word, j) => units.push({ text: word, sep: j === 0 ? sep : ' ' }))
    })
  }
  const pages: string[] = []
  let current = ''
  for (const unit of units) {
    if (!unit.text) continue
    const next = current ? current + unit.sep + unit.text : unit.text
    if (next.length > PAGE_CHARS && current) {
      pages.push(current)
      current = unit.text
    } else current = next
  }
  if (current) pages.push(current)
  return pages.length ? pages : ['']
}

// How much of `text` has been revealed by now, snapped back to a word boundary.
function revealed(text: string) {
  if (!paceFrom) return text
  let budget = Date.now() - paceFrom
  let i = 0
  for (; i < text.length; i++) {
    const c = text[i]
    // Short beats at punctuation only; long pauses read as lag on the glasses.
    budget -= CHAR_MS + (',;:'.includes(c) ? 50 : '.!?'.includes(c) ? 120 : 0)
    if (budget < 0) break
  }
  if (i >= text.length) return text
  const cut = text.lastIndexOf(' ', i)
  return text.slice(0, cut > 0 ? cut : i)
}

const replyPages = () => paginate(plain(reply))

function startReading(key: string, paced: boolean) {
  if (key === readerKey) return
  readerKey = key
  pageIdx = 0
  pacedReply = paced
  paceFrom = paced ? Date.now() : 0
}

function turnPage(step: 1 | -1) {
  pageIdx += step
  paceFrom = step === 1 && pacedReply ? Date.now() : 0 // pages you go back to are already read
  show(idleHeader())
}

function body() {
  if (view.kind === 'list') return view.title
  if (view.kind === 'listen') return heard
  if (view.kind === 'page') return view.text
  if (back > 0) return exchangeText(exchanges()[exchanges().length - 1 - back] ?? [])
  const page = replyPages()[pageIdx] ?? ''
  return [pageIdx === 0 && you && `> ${clip(you, 100)}`, revealed(page)].filter(Boolean).join('\n\n')
}

// Keep rendering while a page is still being revealed (tick(): a frame or 50 ms, so it also runs hidden).
function pump() {
  if (pumpQueued || page !== 'main' || view.kind !== 'chat' || back > 0 || !paceFrom) return
  const text = replyPages()[pageIdx] ?? ''
  if (revealed(text) === text) return void (paceFrom = 0) // fully shown: stop pacing
  pumpQueued = true
  void tick().then(() => {
    pumpQueued = false
    void render()
  })
}

// BLE writes are slow: at most one in flight; when it lands, write the newest content if it changed.
// (No timers: the Even SDK's ShadowTimers can stall setTimeout/setInterval.)
async function render() {
  setTranscript(body(), '')
  if (rendering) return
  rendering = true
  try {
    for (;;) {
      const nextHeader = page === 'splash' || view.kind === 'listen' ? centre(header) : header || ' '
      // textContainerUpgrade takes at most 2,000 chars; keep the head so the user scrolls forward.
      const nextBody = body().slice(0, 1900) || ' '
      if (nextHeader !== lastHeader) {
        lastHeader = nextHeader
        await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: STATUS.id, containerName: STATUS.name, content: nextHeader }))
      } else if (page === 'main' && nextBody !== lastBody) {
        lastBody = nextBody
        await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: BODY.id, containerName: BODY.name, content: nextBody }))
      } else break
    }
  } finally {
    rendering = false
    pump()
  }
}

function show(nextHeader: string) {
  // Any request answered 401 surfaces as "unpaired" (nod.ts): this device was revoked.
  if (nextHeader === '! unpaired') {
    unpaired = true
    void forgetToken(bridge)
    nextHeader = '! Device unpaired · reopen the app to pair again'
  }
  header = nextHeader
  setStatus(nextHeader.startsWith('!') ? 'error' : 'listening', nextHeader)
  if (nextHeader.startsWith('!')) glyph.play('droop', restingGlyph())
  void render()
}

const IDLE = 'Tap or hold to talk'

// ---- nod state ------------------------------------------------------------------------
let state: NodState | null = null
let streaming: string | null = null // streamId currently arriving via deltas
let activity: Activity[] = []
let lastSeenNodId: string | undefined // newest nod message we've already shown
let newFromNod = false // nod spoke without being asked from the glasses (schedule, nudge, desktop)
let notice: string | undefined // a confirmation (e.g. "Model: …") kept until you next act
let dismissedQuestion: string | undefined // a choice question the user put off with "Not now"

// nod's turns cover every source (your messages, schedules, app events), so the glyph shows
// nod working or waiting on you even when the glasses didn't start it.
const busy = () => !!state?.turns.some((t) => t.status === 'queued' || t.status === 'running')
const pendingQuestion = (): NodMessage | undefined =>
  [...(state?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.answerChoicesPending && m.answerChoices)
// Only the newest turn counts: an answered question's turn keeps status 'waiting' forever.
const asking = () => !!pendingQuestion() || state?.turns[0]?.status === 'waiting' || reply.trimEnd().endsWith('?')
// On the voice screen the big logo moves only while the mic is open; otherwise it holds still.
const restingGlyph = (): GlyphState =>
  mode === 'recording' ? 'listening' : view.kind === 'listen' ? 'idle' : mode !== 'idle' || busy() ? 'thinking' : asking() ? 'waiting' : 'idle'

// Same wording as nod's web live line (nod/src/web/components/live-line.tsx).
function activityLine() {
  const item = activity.find((a) => !a.background && !a.taskId) ?? activity[0]
  if (!item) return undefined
  const label = item.step?.trim() || (item.doing === 'tool' && item.site) || (item.doing === 'queued' ? 'Queued' : item.title?.trim() || 'Thinking')
  return `${label.slice(0, 44)}…`
}

function idleHeader() {
  if (view.kind === 'list' && openQuestion) return pendingQuestion()?.answerChoices?.multiple ? 'Pick any, then Send' : 'Pick an answer'
  if (back > 0) return `◀ ${back} back · swipe down for newer`
  const pages = replyPages().length
  const where = pages > 1 ? ` · ${pageIdx + 1}/${pages}` : ''
  if (busy()) return (activityLine() ?? 'nod is working…') + where
  if (newFromNod) return 'New from nod' + where
  if (notice) return notice
  if (pendingQuestion()) return 'Tap-hold menu: Answer question'
  if (asking()) return 'Tap-hold menu: Yes / No' + where
  return pages > 1 ? `Page ${pageIdx + 1}/${pages}${pageIdx < pages - 1 ? ' · swipe down' : ''}` : IDLE
}

async function refresh() {
  try {
    state = await getState()
  } catch (error) {
    return show(`! ${(error as Error).message}`)
  }
  const reversed = [...state.messages].reverse()
  const lastUser = reversed.find((m) => m.role === 'user')
  const lastNod = reversed.find((m) => m.role === 'assistant')
  if (lastUser) you = lastUser.text
  // Only show nod's message if it answers the latest question; don't clobber a live stream.
  // A stream whose end event was lost (SSE dropped mid-reply) must not freeze the reply.
  if (!busy()) streaming = null
  if (!streaming) {
    const answered = lastNod && reversed.indexOf(lastNod) < reversed.indexOf(lastUser!)
    reply = answered ? withCard(lastNod) : ''
    // Pace replies that arrive while the app is open; anything already there at boot shows at once.
    startReading(answered ? (lastNod.streamId ?? lastNod.id) : '', page === 'main')
  }

  // A new nod message the glasses didn't ask for: a schedule result, a nudge, a desktop reply.
  if (lastSeenNodId !== undefined && lastNod && lastNod.id !== lastSeenNodId && mode === 'idle') {
    newFromNod = true
    glyph.play('hop', restingGlyph())
  }
  if (lastNod) lastSeenNodId = lastNod.id

  // The turn has finished: nod answered, the turn failed/was stopped, or a turn that started
  // after your message ended without a reply (nod sometimes just carries on, e.g. "Keep going").
  const newest = state.turns[0]
  const finished =
    !busy() &&
    (reversed[0]?.role === 'assistant' ||
      ['failed', 'cancelled'].includes(newest?.status ?? '') ||
      (!!newest && !!lastUser && newest.createdAt >= lastUser.createdAt))
  if (mode === 'thinking' && finished) {
    mode = 'idle'
    glyph.play(state.turns[0]?.status === 'failed' ? 'droop' : 'hop', restingGlyph())
  }

  // A structured question wants an answer: offer the choices (unless the user put it off).
  const question = pendingQuestion()
  // Only from the chat: a question arriving while another list or page is open must not
  // swap that list out from under the user's next tap.
  if (page === 'main' && mode === 'idle' && back === 0 && (view.kind === 'chat' || openQuestion)) {
    if (question && question.id !== dismissedQuestion && !(view.kind === 'list' && openQuestion === question.id)) {
      await openChoices(question)
    } else if (!question && openQuestion) {
      openQuestion = undefined
      await layout({ kind: 'chat' })
    }
  }

  // Lists and pages keep their own header ("Send this to nod?", "Pick an answer"); only the chat resets.
  if (mode === 'idle' && view.kind === 'chat') {
    glyph.set(restingGlyph())
    show(idleHeader())
  } else void render()
}

// Same pattern as render(): one request in flight, one more queued if events arrive meanwhile.
let refreshing = false
let refreshAgain = false
async function scheduleRefresh() {
  if (refreshing) return void (refreshAgain = true)
  refreshing = true
  try {
    do {
      refreshAgain = false
      await refresh()
    } while (refreshAgain)
  } finally {
    refreshing = false
  }
}

// ---- history ------------------------------------------------------------------------
// Swipe up past the top of the chat to step back one exchange (your message + nod's reply),
// down past the bottom to step forward. Starts from what /api/state already loaded; older
// messages are fetched 5 at a time only when you scroll past them.
let older: NodMessage[] = [] // fetched history, oldest first
let olderExhausted = false
let back = 0 // 0 = live; n = n exchanges back
let fetchingOlder = false

function allMessages() {
  const seen = new Set<string>()
  return [...older, ...(state?.messages ?? [])].filter((m) => !seen.has(m.id) && seen.add(m.id))
}

// Group messages into exchanges: each user message starts one; nod-only runs (schedules) stand alone.
function exchanges(): NodMessage[][] {
  const groups: NodMessage[][] = []
  for (const m of allMessages()) {
    const current = groups[groups.length - 1]
    if (m.role === 'user' || !current) groups.push([m])
    else current.push(m)
  }
  return groups
}

const exchangeText = (group: NodMessage[]) => group.map((m) => (m.role === 'user' ? `> ${clip(m.text, 160)}` : withCard(m))).join('\n\n')
// A structured reply reads as its text followed by the card's glance text.
const withCard = (m: NodMessage) => {
  const text = plain(m.text)
  return m.presentation ? [text, cardText(m.presentation)].filter(Boolean).join('\n\n') : text
}
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

async function goBack() {
  if (mode !== 'idle' || fetchingOlder) return
  newFromNod = false
  notice = undefined
  if (back + 1 < exchanges().length) {
    back++
    return show(idleHeader())
  }
  if (olderExhausted) return show('Start of conversation')
  const first = allMessages()[0]
  if (!first) return
  fetchingOlder = true
  show('Loading earlier…')
  try {
    const batch = await getHistory(first, 5)
    older = [...batch.messages, ...older]
    olderExhausted = !batch.hasMore
    if (back + 1 < exchanges().length) back++
    show(back + 1 >= exchanges().length && olderExhausted ? 'Start of conversation' : idleHeader())
  } catch (error) {
    show(`! ${(error as Error).message}`)
  } finally {
    fetchingOlder = false
  }
}

function goForward() {
  if (back === 0) return
  back--
  show(idleHeader())
}

// ---- choices ------------------------------------------------------------------------
// nod's structured questions (answerChoices) as a native list. The server accepts the answer only
// with questionAnswer.choiceIds AND text exactly choiceAnswerText(selected), as the web app sends.
let openQuestion: string | undefined

async function openChoices(question: NodMessage, selected = new Set<string>()) {
  const { options, multiple } = question.answerChoices!
  openQuestion = question.id
  const clip = (s: string) => (s.length > LIST_ITEM_MAX ? `${s.slice(0, LIST_ITEM_MAX - 1)}…` : s)
  const items = [
    ...options.map((o) => clip(multiple ? `${selected.has(o.id) ? '■' : '□'} ${o.label}` : o.label)),
    ...(multiple ? ['▶ Send'] : []),
    '◀ Not now',
  ]
  await layout({
    kind: 'list',
    title: question.text.slice(0, 160),
    items,
    pick: (index) => {
      const option = options[index]
      if (option && multiple) {
        const next = new Set(selected)
        if (!next.delete(option.id)) next.add(option.id)
        return void openChoices(question, next)
      }
      if (option) return void submitChoices(question, [option.id])
      if (multiple && index === options.length) {
        if (!selected.size) return show('Pick at least one')
        return void submitChoices(question, options.filter((o) => selected.has(o.id)).map((o) => o.id))
      }
      dismissedQuestion = question.id // "Not now": back to the chat; the menu reopens it
      openQuestion = undefined
      void layout({ kind: 'chat' })
    },
  })
  show(multiple ? 'Pick any, then Send' : 'Pick an answer')
}

async function submitChoices(question: NodMessage, ids: string[]) {
  const chosen = question.answerChoices!.options.filter((o) => ids.includes(o.id))
  if (await send(choiceAnswerText(chosen), { replyTo: question.id, choiceIds: ids })) openQuestion = undefined
}

// Every typed send (approvals, choices, saved prompts) goes through here: back to the live chat,
// then wait for nod. Returns false if the send failed (the error is on the status line).
async function send(text: string, options: { replyTo?: string; choiceIds?: string[] } = {}) {
  // Claim the send before the request goes out: a quick double tap must not send twice.
  if (!state || mode !== 'idle') return false
  mode = 'sending'
  try {
    await sendText(state.threadId, text, options.replyTo, options.choiceIds)
  } catch (error) {
    mode = 'idle'
    show(`! ${(error as Error).message}`)
    return false
  }
  you = text
  reply = ''
  back = 0
  newFromNod = false
  notice = undefined
  mode = 'thinking'
  glyph.set('thinking')
  if (view.kind !== 'chat') await layout({ kind: 'chat' })
  show('nod is thinking…')
  void scheduleRefresh()
  return true
}

// ---- saved prompts ---------------------------------------------------------------------
// Edited on the phone (Label | prompt per line), stored in the Even app, sent from the glasses.
const PROMPTS_KEY = 'nodPrompts'
const DEFAULT_PROMPTS = [
  "Morning brief | Give me today's calendar and my top three priorities, briefly.",
  "Catch me up | What's new since we last spoke? Keep it short.",
  'Next steps | Turn our conversation so far into a short list of next steps.',
].join('\n')
let promptsText = DEFAULT_PROMPTS

const parsePrompts = (text: string) =>
  text
    .split('\n')
    .map((line) => line.split('|'))
    .filter((parts) => parts.length >= 2 && parts[0].trim() && parts.slice(1).join('|').trim())
    .map((parts) => ({ label: parts[0].trim(), text: parts.slice(1).join('|').trim() }))
    .slice(0, 19) // lists hold 20 items, one is "Back"

async function loadPrompts() {
  promptsText = (await bridge.getLocalStorage(PROMPTS_KEY).catch(() => '')) || DEFAULT_PROMPTS
  mountPrompts(promptsText, async (text) => {
    if (!(await bridge.setLocalStorage(PROMPTS_KEY, text))) throw new Error('storage refused')
    promptsText = text
  })
}

function openPrompts() {
  const prompts = parsePrompts(promptsText)
  if (!prompts.length) return show('No saved prompts: add some on the phone')
  void layout({
    kind: 'list',
    title: 'Saved prompts',
    items: [...prompts.map((p) => clipItem(p.label)), '◀ Back'],
    pick: (index) => (prompts[index] ? void send(prompts[index].text) : void layout({ kind: 'chat' }).then(() => show(idleHeader()))),
  }).then(() => show('Pick a prompt to send'))
}

// ---- model picker ----------------------------------------------------------------------
// Two steps (lists hold at most 20 items): pick a connection, then one of its models.
async function openModels() {
  let models: ModelsView
  try {
    models = await getModels()
  } catch (error) {
    return show(`! ${(error as Error).message}`)
  }
  const { selection } = models
  const connections = models.connections.filter((c) => c.models.length && c.status !== 'reconnect')
  const current = connections.find((c) => c.id === selection?.connectionId)?.models.find((m) => m.id === selection?.modelId)
  const name = (c: (typeof connections)[number]) => `${c.id === selection?.connectionId ? '● ' : ''}${c.label || c.provider} (${c.method.replace('_', ' ')})`
  await layout({
    kind: 'list',
    title: `Model now: ${current?.name ?? selection?.modelId ?? 'none'}`,
    items: [...connections.map((c) => clipItem(name(c))), '◀ Back'],
    pick: (index) => {
      const connection = connections[index]
      if (!connection) return void layout({ kind: 'chat' }).then(() => show(idleHeader()))
      const choices = connection.models.slice(0, 19)
      void layout({
        kind: 'list',
        title: `${connection.label || connection.provider}: pick a model`,
        items: [...choices.map((m) => clipItem(`${m.id === selection?.modelId ? '● ' : ''}${m.name}`)), '◀ Back'],
        pick: async (i) => {
          const model = choices[i]
          if (!model) return void openModels()
          // Keep the reasoning effort if the new model supports it, else its middle setting.
          const efforts = model.efforts ?? []
          const effort = efforts.includes(selection?.effort ?? '') ? selection!.effort : (efforts[Math.floor(efforts.length / 2)] ?? 'off')
          try {
            await selectModel({ connectionId: connection.id, modelId: model.id, effort })
          } catch (error) {
            return show(`! ${(error as Error).message}`)
          }
          await layout({ kind: 'chat' })
          notice = `Model: ${model.name}`
          show(notice)
        },
      }).then(() => show('Pick a model'))
    },
  })
  show('Pick a connection')
}

const clipItem = (s: string) => clip(s, LIST_ITEM_MAX)

const backToChat = () => void layout({ kind: 'chat' }).then(() => show(idleHeader()))

// ---- tasks ------------------------------------------------------------------------------
// nod's multi-step work as a board: open tasks first; tap one for its steps and progress.
async function openTasks() {
  let tasks
  try {
    tasks = sortTasks(await getTasks()).slice(0, 19) // lists hold 20 items, one is "Back"
  } catch (error) {
    return show(`! ${(error as Error).message}`)
  }
  if (!tasks.length) return show('No tasks yet')
  const open = tasks.filter((t) => !['done', 'cancelled', 'failed'].includes(t.status)).length
  await layout({
    kind: 'list',
    title: `Tasks · ${open} open`,
    items: [...tasks.map((t) => clipItem(taskRow(t))), '◀ Back'],
    pick: (index) => {
      const task = tasks[index]
      if (!task) return backToChat()
      void layout({ kind: 'page', text: taskDetail(task), close: () => void openTasks() }).then(() => show('Tap to go back'))
    },
  })
  show('Pick a task')
}

// ---- cards ------------------------------------------------------------------------------
// "Show card": the structured reply (presentation) you're looking at, live or in history.
// Charts and pictures render as an image; everything else as its full card text.
async function openCard() {
  const messages = back > 0 ? [...(exchanges()[exchanges().length - 1 - back] ?? [])].reverse() : [...(state?.messages ?? [])].reverse()
  const presentation = messages.find((m) => m.role === 'assistant' && m.presentation)?.presentation
  if (!presentation) return show('No card in this reply')
  if (!hasVisual(presentation)) return void layout({ kind: 'page', text: cardText(presentation), close: backToChat }).then(() => show('Tap to close'))
  show('Drawing card…')
  let image: Uint8Array
  try {
    image = await cardImage(presentation)
  } catch (error) {
    return show(`! ${(error as Error).message}`)
  }
  const caption = [presentation.title, presentation.caption].filter(Boolean).join(' · ')
  await layout({ kind: 'page', text: clip(caption, 120), image, close: backToChat })
  show('Tap to close')
}

async function cardImage(p: Presentation): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD.width
  canvas.height = CARD.height
  if (p.type === 'chart') {
    drawChart(p, canvas)
    return png(canvas)
  }
  if (p.type !== 'image') throw new Error('No picture for this card')
  // Fit the picture inside 288x144; the SDK converts it to 4-bit greyscale.
  const url = URL.createObjectURL(await getArtifact(p.artifactId))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(CARD.width / img.naturalWidth, CARD.height / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, CARD.width, CARD.height)
    ctx.drawImage(img, (CARD.width - w) / 2, (CARD.height - h) / 2, w, h)
    return png(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---- recording ------------------------------------------------------------------------
type Mode = 'idle' | 'recording' | 'sending' | 'thinking'
let mode: Mode = 'idle'
let chunks: Uint8Array[] = []
let recordedBytes = 0
const BYTES_PER_SECOND = 32_000 // 16 kHz * 16-bit mono
const MAX_RECORD_BYTES = 60 * BYTES_PER_SECOND

// Voice: hold (or tap) to talk on a screen of its own. While you talk, the audio so far is
// re-transcribed every ~1.5 s (one request at a time) so you see what nod hears; on release a
// final pass is shown for you to send, say again, or cancel. Nothing reaches nod until you send.
let heard = '' // latest transcript of the current recording
let partialBusy = false
let partialAt = 0 // recordedBytes at the last live transcription
const PARTIAL_EVERY = 1.5 * BYTES_PER_SECOND

function recordedPcm() {
  const pcm = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) pcm.set(c, offset), (offset += c.length)
  return pcm
}

async function startRecording() {
  if (page !== 'main' || mode !== 'idle' || !state) return
  mode = 'recording'
  chunks = []
  recordedBytes = partialAt = 0
  heard = ''
  back = 0 // talking always returns to the live conversation
  newFromNod = false
  notice = undefined
  if (view.kind === 'list' && openQuestion) {
    dismissedQuestion = openQuestion // answering by voice instead
    openQuestion = undefined
  }
  header = '● Listening…'
  await layout({ kind: 'listen' })
  glyph.set('listening') // the dot circles only while the mic is open
  try {
    await bridge.audioControl(true)
  } catch (error) {
    mode = 'idle' // or every later tap and menu action is ignored
    await layout({ kind: 'chat' })
    glyph.set(restingGlyph())
    show(`! Microphone: ${(error as Error).message}`)
  }
}

function onPcm(pcm: Uint8Array) {
  if (mode !== 'recording') return
  const before = Math.floor(recordedBytes / BYTES_PER_SECOND)
  chunks.push(pcm)
  recordedBytes += pcm.length
  wave.push(pcm)
  if (recordedBytes >= MAX_RECORD_BYTES) return void finishRecording()
  const seconds = Math.floor(recordedBytes / BYTES_PER_SECOND)
  if (seconds !== before) show(`● Listening… ${seconds}s`)
  if (!partialBusy && recordedBytes - partialAt >= PARTIAL_EVERY) void livePartial()
}

async function livePartial() {
  partialBusy = true
  partialAt = recordedBytes
  try {
    const text = await transcribe(recordedPcm())
    if (mode === 'recording') (heard = text), void render()
  } catch {
    // silence so far ("No speech was detected") or a hiccup: the final pass decides
  } finally {
    partialBusy = false
  }
}

async function finishRecording() {
  if (mode !== 'recording') return
  mode = 'sending'
  glyph.set('idle') // mic closed: the big logo holds still while we transcribe
  wave.clear()
  await bridge.audioControl(false).catch(() => {}) // a failed mic-off must not strand mode on 'sending'
  const pcm = recordedPcm()
  chunks = []
  if (pcm.length < 16000) {
    // < 0.5 s of audio: treat as an accidental tap.
    mode = 'idle'
    await layout({ kind: 'chat' })
    glyph.set(restingGlyph())
    return show(idleHeader())
  }
  show('Getting that down…')
  let text: string
  try {
    text = await transcribe(pcm)
  } catch (error) {
    mode = 'idle'
    await layout({ kind: 'chat' })
    glyph.set(restingGlyph())
    const message = (error as Error).message
    if (message.startsWith('No speech')) return show("Didn't catch that · hold to try again")
    return show(`! ${message}`)
  }
  mode = 'idle'
  heard = text
  await confirmHeard(text)
}

// "You said": send it, say it again, or drop it.
async function confirmHeard(text: string) {
  await layout({
    kind: 'list',
    tall: true,
    title: `You said: "${clip(text, 300)}"`,
    items: ['▶ Send', '● Say it again', '◀ Cancel'],
    pick: (index) => {
      if (index === 0) return void send(text)
      if (index === 1) return void startRecording()
      void layout({ kind: 'chat' }).then(() => show(idleHeader()))
    },
  })
  glyph.set(restingGlyph())
  show('Send this to nod?')
}

// Approvals must be text: nod never accepts a voice note as a yes.
// Only answer when nod is actually asking, in the live view (not while browsing history).
async function answer(text: 'yes' | 'no') {
  if (!state || mode !== 'idle') return
  const question = state.messages[state.messages.length - 1]
  if (back > 0 || !asking() || question?.role !== 'assistant') return void show('Nothing to answer')
  await send(text, { replyTo: question.id })
}

// ---- events ------------------------------------------------------------------------
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  // CLICK_EVENT is 0 and protobuf omits zero fields, so a bare envelope is a click.
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

let unsubscribeNod = () => {}
let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  void bridge.audioControl(false)
  unsubscribeNod()
  unsubscribe()
}

const unsubscribe = bridge.onEvenHubEvent((event) => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm) return onPcm(pcm)

  const item = event.menuItemClickEvent?.itemID
  // Nothing in the menu works before the app is paired and connected.
  if (item !== undefined && page !== 'main') return show(header)
  if (item === MENU.YES) return void answer('yes')
  if (item === MENU.NO) return void answer('no')
  if (item === MENU.STOP) return void stop().then(() => scheduleRefresh(), (e) => show(`! ${e.message}`))
  if (item === MENU.PROMPTS) return mode === 'idle' ? openPrompts() : show('Busy: try again in a moment')
  if (item === MENU.MODEL) return mode === 'idle' ? void openModels() : show('Busy: try again in a moment')
  if (item === MENU.TASKS) return mode === 'idle' ? void openTasks() : show('Busy: try again in a moment')
  if (item === MENU.CARD) return mode === 'idle' ? void openCard() : show('Busy: try again in a moment')
  if (item === MENU.CHOICES) {
    const question = pendingQuestion()
    if (!question || mode !== 'idle') return show('No question waiting')
    dismissedQuestion = undefined
    back = 0
    return void openChoices(question)
  }

  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)
  const listType = eventTypeOf(event.listEvent)

  // Hold-to-talk. Long press always arrives on sysEvent.
  if (sysType === OsEventTypeList.LONG_PRESS_EVENT) return void startRecording()
  if (sysType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return void finishRecording()

  // Double press always exits (system confirm dialog), whatever we're doing.
  if ([sysType, textType, listType].includes(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    void bridge.shutDownPageContainer(1)
    return
  }
  // List pick. Index 0 can arrive as undefined (protobuf omits zero values).
  if (listType === OsEventTypeList.CLICK_EVENT && view.kind === 'list') return view.pick(event.listEvent?.currentSelectItemIndex ?? 0)

  // Swiping past the top/bottom of the chat text: pages of the current reply first, then history.
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT && view.kind === 'chat') {
    if (back === 0 && pageIdx > 0) return turnPage(-1)
    return void goBack()
  }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT && view.kind === 'chat') {
    if (back === 0 && pageIdx < replyPages().length - 1) return turnPage(1)
    return goForward()
  }

  // Tap toggles recording: the fallback when the OS keeps long press for its own menu.
  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    if (page === 'splash') return void boot() // tap to retry connecting
    if (view.kind === 'page') return view.close() // tap closes a card or task page
    if (mode === 'idle') void startRecording()
    else if (mode === 'recording') void finishRecording()
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) cleanup()
})
window.addEventListener('beforeunload', cleanup)

// ---- start ------------------------------------------------------------------------
let booting = false
let unpaired = false // set by show() when nod answers 401: the stored token was revoked
if (!configured) {
  show('! Set VITE_NOD_GATEWAY in .env.local')
} else void boot()

async function boot() {
  if (booting || page === 'main') return
  booting = true
  glyph.set('boot')
  show('Opening Nod…')
  try {
    // First launch pairs this device with the gateway (shows a 4-word code); later launches reuse
    // the token. A revoked stored token goes straight back into pairing (one retry).
    for (let attempt = 0; attempt < 2; attempt++) {
      unpaired = false
      await ensureToken(bridge, (line) => {
        show(line)
        setStatus('listening', `${line} · on the gateway host run: node pair.mjs approve "<those words>"`)
      })
      await refresh()
      if (state || !unpaired) break
      await forgetToken(bridge) // awaited: ensureToken must not read the revoked token again
    }
  } catch (error) {
    show(`! ${error instanceof TypeError ? "Can't reach nod" : (error as Error).message}`)
  } finally {
    booting = false // or every later tap is ignored
  }
  if (!state) {
    // refresh() already showed the error (and drooped); just add the retry hint.
    header = `${header} · tap to retry`
    return void render()
  }
  await layout({ kind: 'chat' })
  glyph.play('nod', restingGlyph()) // connected: the glyph nods hello
  void loadPrompts()
  void scheduleRefresh() // now on the main page: opens a waiting question, if any
  unsubscribeNod = listen(
    (event) => {
      if (event.type === 'refresh') return void scheduleRefresh()
      if (event.type === 'activity') {
        activity = event.items
        if (mode === 'thinking' || (mode === 'idle' && busy())) show(activityLine() ?? (mode === 'thinking' ? 'nod is thinking…' : idleHeader()))
        return
      }
      const id = event.streamId ?? `turn:${event.turnId}`
      if (event.done) {
        streaming = null
        return void scheduleRefresh()
      }
      if (!event.text) return
      if (streaming !== id) {
        streaming = id
        reply = ''
        startReading(id, true)
      }
      reply += event.text
      void render()
    },
    () => setStatus('error', 'Lost connection to nod, retrying…'),
  )
}
