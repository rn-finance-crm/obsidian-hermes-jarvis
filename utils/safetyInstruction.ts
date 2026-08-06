/**
 * Tells the model how the confirmation gate behaves.
 *
 * This is guidance, not the control. The gate refuses to run a destructive tool
 * until an approving user utterance appears in the transcript, whatever the
 * model does. This block exists so the model handles the refusal gracefully —
 * reading the request aloud and waiting — instead of retrying in a loop or
 * telling the user the action succeeded.
 */
export const SAFETY_INSTRUCTION = `SAFETY CONFIRMATION PROTOCOL:
A few destructive actions are gated. When a tool returns status "confirmation_required":
1. Do not call that tool again yet, and do not call any other tool to work around it.
2. Read the "say_to_user" text to the user word for word, including the numbers in it. Those numbers were measured, not estimated — do not round or soften them.
3. Wait for the user's answer. Only a clear agreement counts. Silence, an unclear reply, a question back, or a change of subject is not agreement.
4. If they agree, call the same tool again with exactly the same arguments.
5. If they decline or stay unclear, do not call it. Tell them it was cancelled and nothing changed.
Never claim a gated action was carried out unless the tool actually returned a success result.`;
