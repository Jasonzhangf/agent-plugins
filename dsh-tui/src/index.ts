/**
 * Authoring-side marker only.
 *
 * The package public API is emitted by scripts/build-runtime.mjs from the
 * verified Active artifact. This module must not turn authoring source into a
 * runtime dependency.
 */
export const runtimeArtifactBoundary = 'active/lib'
