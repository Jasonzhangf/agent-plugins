// control-plane owner — typed control, never enters business payload
export class MultiKeyControl {
  async probe(route: string, keyId: string): Promise<unknown> { void route; void keyId; throw new Error("binding-pending") }
  async view(): Promise<unknown> { throw new Error("binding-pending") }
}
