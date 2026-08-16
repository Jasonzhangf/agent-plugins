// typed secret-control side-channel — loopback-only, explicit gesture
// Secret values never enter: settings, business payload, metadata, log, session, error
export class MultiKeySecretControl {
  async reveal(credentialRef: unknown): Promise<unknown> { void credentialRef; throw new Error("binding-pending") }
}
