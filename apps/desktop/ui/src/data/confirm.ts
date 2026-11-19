/** Hermes asks the user to confirm before it writes a model (a pick that costs a lot or sends data somewhere a policy
 *  forbids): `message` is its own sentence, shown as it is. Nothing of the model was written; the rest of the change was. */
export class NeedsConfirmation extends Error {
  constructor(message: string) { super(message); this.name = 'NeedsConfirmation'; }
}
