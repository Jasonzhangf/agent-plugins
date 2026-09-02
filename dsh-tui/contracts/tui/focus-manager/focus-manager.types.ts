export const TUI_FOCUS_VIEWS = Object.freeze([
  'composer.editor',
  'composer.queue',
  'composer.command-picker',
  'command',
  'interaction.approval',
  'interaction.question',
  'selector.resume-current-cwd',
  'selector.model',
  'selector.provider',
  'selector.permission',
  'selector.agent-preset',
  'selector.settings',
  'attachment.preview',
  'overlay.trajectory',
  'overlay.plan',
  'overlay.goal',
  'overlay.jobs',
  'overlay.settings',
  'overlay.plugin-inventory',
  'overlay.help',
] as const)

export type TuiFocusViewId = (typeof TUI_FOCUS_VIEWS)[number]
