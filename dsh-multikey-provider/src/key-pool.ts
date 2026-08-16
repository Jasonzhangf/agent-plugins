// KeyPoolRuntime — typed control resource
export class KeyPoolRuntime {
  select(): unknown { throw new Error("binding-pending") }
  view(): unknown { throw new Error("binding-pending") }
}
