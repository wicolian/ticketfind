// Share ticketfind with friends: the phone's share sheet when there is one, the clipboard when not.
export const SHARE_URL = "https://ticketfind.vercel.app";
export const SHARE_TEXT = "I use ticketfind to get pinged the second seats open for sold-out shows. Free, no account:";

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

export async function shareTicketfind(): Promise<ShareResult> {
  const data = { title: "ticketfind", text: SHARE_TEXT, url: SHARE_URL };
  if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      // The person closed the share sheet: that is a choice, not an error.
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // Any other failure (no user gesture, blocked by policy): fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(`${SHARE_TEXT} ${SHARE_URL}`);
    return "copied";
  } catch {
    return "failed";
  }
}
