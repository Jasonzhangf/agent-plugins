// typed credential resolution — never enters business payload
export function resolveCredential(ref: unknown): unknown {
  void ref; throw new Error("binding-pending")
}
