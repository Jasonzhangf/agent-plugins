import { Service } from '@deepseek-ai/cordis';
const COLORS = Object.freeze({
    red: '#E06C75',
    white: '#DCDFE4',
    // One Dark cyan: clear against the neutral body while staying quieter than
    // the red command/error accent.
    tool: '#56B6C2',
    thinking: '#8F98A7',
    blue: '#61AFEF',
    green: '#98C379',
    yellow: '#E0C086',
    dim: '#8F98A7',
    black: '#1E2127',
    gray: '#313439',
    'dark-gray': '#282C34',
});
const SEMANTIC_STYLES = Object.freeze({
    'conversation.user': { color: 'white' },
    'conversation.assistant': { color: 'white' },
    'conversation.reasoning': { color: 'thinking', italic: true },
    'conversation.context': { color: 'white', dimColor: true },
    'conversation.steering': { color: 'white', dimColor: true },
    'conversation.command': { color: 'white', bold: true },
    'conversation.compaction': { color: 'white', dimColor: true },
    'conversation.retry': { color: 'white', bold: true },
    'conversation.turn-error': { color: 'red', bold: true },
    'conversation.max-tokens': { color: 'red', bold: true },
    'conversation.turn-tail': { color: 'white', dimColor: true },
    'conversation.unknown': { color: 'red', dimColor: true },
    'tool.card': { color: 'tool' },
    'error.terminal': { color: 'red', bold: true },
    'status.terminal': { color: 'white', dimColor: true },
    'composer.line': { color: 'white' },
    'status.session': { color: 'white', dimColor: true },
    'status.connection': { color: 'white' },
    'status.mode': { color: 'white' },
    'status.tool': { color: 'white', dimColor: true },
});
class TuiThemeService extends Service {
    name = 'tuiTheme';
    disposed = false;
    constructor(ctx) {
        super(ctx, 'tuiTheme');
        ctx.effect(() => () => this.dispose(), 'theme-plugin.dispose');
    }
    styleForSemanticKind(kind) {
        if (this.disposed)
            throw new Error('theme-plugin: disposed');
        return SEMANTIC_STYLES[kind] ?? Object.freeze({});
    }
    resolveColor(color) {
        if (this.disposed)
            throw new Error('theme-plugin: disposed');
        return COLORS[color];
    }
    dispose() { this.disposed = true; }
}
export function apply(ctx) { ctx.tuiTheme = new TuiThemeService(ctx); }
