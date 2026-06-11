/**
 * Ceremony arming — the god ceremony must feel like a RESPONSE to an action
 * (sign-in, plan switch), never page-load noise. User-action call sites arm
 * it; GodThemeLayer only plays a tier change observed while armed.
 */

const ARM_WINDOW_MS = 12_000;

let armedAt = 0;

export function armCeremony(): void {
  armedAt = Date.now();
}

export function disarmCeremony(): void {
  armedAt = 0;
}

export function ceremonyArmed(): boolean {
  return Date.now() - armedAt < ARM_WINDOW_MS;
}
