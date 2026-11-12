// nod's tasks (nod/src/shared/contracts.ts Task): multi-step work nod runs for you.
// Read-only on the glasses: nod's API only lets clients rename tasks, so this is a board to
// follow progress, not a checklist to tick.
import { plain } from './cards'

export type TaskStatus = 'queued' | 'working' | 'needs_you' | 'waiting' | 'scheduled' | 'failed' | 'done' | 'cancelled'
export interface Task {
  id: string
  title: string
  doneWhen: string
  now: string
  result: string
  status: TaskStatus
  question: string | null
  waitingFor: { who: string; via: string }[]
  nextCheck: string | null
  updatedAt: string
  closedAt: string | null
  steps?: string[]
  stepIndex?: number
}

// Only characters Even documents as present in the glasses font (others are silently dropped).
const MARK: Record<TaskStatus, string> = {
  needs_you: '★',
  working: '▶',
  queued: '○',
  waiting: '▽',
  scheduled: '▷',
  failed: 'x',
  done: '●',
  cancelled: '-',
}
const LABEL: Record<TaskStatus, string> = {
  needs_you: 'Needs you',
  working: 'Working',
  queued: 'Queued',
  waiting: 'Waiting',
  scheduled: 'Scheduled',
  failed: 'Failed',
  done: 'Done',
  cancelled: 'Cancelled',
}
// Open work first, the tasks that need you at the very top; then most recently updated.
const ORDER: TaskStatus[] = ['needs_you', 'working', 'queued', 'waiting', 'scheduled', 'failed', 'done', 'cancelled']

export function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt))
}

/** One list row: status mark + title. */
export const taskRow = (task: Task) => `${MARK[task.status] ?? '·'} ${task.title}`

/** The detail page: status, the steps as a checklist, what it's doing, waiting for, and the result. */
export function taskDetail(task: Task): string {
  const lines = [`${task.title}`, `${LABEL[task.status] ?? task.status}${task.nextCheck ? ` · next check ${task.nextCheck.slice(0, 16).replace('T', ' ')}` : ''}`]
  if (task.question) lines.push('', `? ${task.question}`)
  if (task.steps?.length) {
    const at = task.stepIndex ?? 0
    const finished = task.status === 'done'
    lines.push('', ...task.steps.map((step, i) => `${finished || i < at ? '■' : '□'} ${step}${!finished && i === at ? '  ◀ now' : ''}`))
  }
  if (task.now && task.status !== 'done') lines.push('', `Now: ${task.now}`)
  if (task.waitingFor.length) lines.push(`Waiting for: ${task.waitingFor.map((w) => `${w.who} (${w.via})`).join(', ')}`)
  if (task.result) lines.push('', `Result: ${plain(task.result)}`)
  else if (task.doneWhen) lines.push('', `Done when: ${task.doneWhen}`)
  return lines.join('\n')
}
