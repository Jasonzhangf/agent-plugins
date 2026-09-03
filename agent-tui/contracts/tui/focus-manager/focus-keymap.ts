import type { TuiFocusViewId } from './focus-manager.types.ts'

export const FOCUS_KEYMAP: Readonly<Record<TuiFocusViewId, ReadonlyArray<readonly [string, string]>>> = Object.freeze({
  'composer.editor': Object.freeze([
    Object.freeze(['Enter', 'submit']) as readonly [string, string],
    Object.freeze(['Shift+Enter', 'newline']) as readonly [string, string],
    Object.freeze(['/help', 'commands']) as readonly [string, string],
    Object.freeze(['Ctrl+C×2', 'quit']) as readonly [string, string],
  ]),
  'composer.queue': Object.freeze([
    Object.freeze(['Up/Down', 'pick queued']) as readonly [string, string],
    Object.freeze(['Enter', 'send']) as readonly [string, string],
    Object.freeze(['Esc', 'back to editor']) as readonly [string, string],
  ]),
  'composer.command-picker': Object.freeze([
    Object.freeze(['Up/Down', 'pick command']) as readonly [string, string],
    Object.freeze(['Enter', 'select']) as readonly [string, string],
    Object.freeze(['Esc', 'cancel']) as readonly [string, string],
  ]),
  command: Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'select']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'interaction.approval': Object.freeze([
    Object.freeze(['Left/Right', 'choose']) as readonly [string, string],
    Object.freeze(['Enter', 'confirm']) as readonly [string, string],
    Object.freeze(['Esc', 'reject']) as readonly [string, string],
  ]),
  'interaction.question': Object.freeze([
    Object.freeze(['Type', 'answer']) as readonly [string, string],
    Object.freeze(['Enter', 'send']) as readonly [string, string],
  ]),
  'selector.resume-current-cwd': Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'resume']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'selector.model': Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'pick']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'selector.provider': Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'pick']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'selector.permission': Object.freeze([
    Object.freeze(['Left/Right', 'choose']) as readonly [string, string],
    Object.freeze(['Enter', 'confirm']) as readonly [string, string],
  ]),
  'selector.agent-preset': Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'pick']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'selector.settings': Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'edit']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'attachment.preview': Object.freeze([
    Object.freeze(['Up/Down', 'scroll']) as readonly [string, string],
    Object.freeze(['Esc', 'back']) as readonly [string, string],
  ]),
  'overlay.trajectory': Object.freeze([
    Object.freeze(['Up/Down', 'scroll']) as readonly [string, string],
    Object.freeze(['PgUp/PgDn', 'page']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'overlay.plan': Object.freeze([
    Object.freeze(['Up/Down', 'scroll']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'overlay.goal': Object.freeze([
    Object.freeze(['Up/Down', 'scroll']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'overlay.jobs': Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'focus job']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'overlay.settings': Object.freeze([
    Object.freeze(['Up/Down', 'move']) as readonly [string, string],
    Object.freeze(['Enter', 'toggle']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'overlay.plugin-inventory': Object.freeze([
    Object.freeze(['Up/Down', 'scroll']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
  'overlay.help': Object.freeze([
    Object.freeze(['Up/Down', 'scroll']) as readonly [string, string],
    Object.freeze(['Esc', 'close']) as readonly [string, string],
  ]),
})


export function focusKeymapLine(view: TuiFocusViewId): string {
  return FOCUS_KEYMAP[view].map(([key, action]) => `${key} ${action}`).join('  ·  ')
}
