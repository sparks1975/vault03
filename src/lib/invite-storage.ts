export const INVITE_CODE_STORAGE_KEY = "v03_invite_code";
export const DEVICE_REGISTERED_KEY = "v03_device_registered";

/**
 * A verified invite code has to survive a full-page OAuth redirect (and on
 * some mobile browsers a brand new tab), so it is written to both session and
 * local storage and read back from either.
 */
export function setPendingInviteCode(code: string) {
  const value = code.trim().toUpperCase();
  try {
    window.sessionStorage.setItem(INVITE_CODE_STORAGE_KEY, value);
  } catch {
    /* storage blocked */
  }
  try {
    window.localStorage.setItem(INVITE_CODE_STORAGE_KEY, value);
  } catch {
    /* storage blocked */
  }
}

export function getPendingInviteCode(): string | null {
  try {
    const fromSession = window.sessionStorage.getItem(INVITE_CODE_STORAGE_KEY);
    if (fromSession) return fromSession;
  } catch {
    /* storage blocked */
  }
  try {
    return window.localStorage.getItem(INVITE_CODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInviteCode() {
  try {
    window.sessionStorage.removeItem(INVITE_CODE_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
  try {
    window.localStorage.removeItem(INVITE_CODE_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}
