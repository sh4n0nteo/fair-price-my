// The only place the app talks to an analytics provider. Call sites use track(name, props) and
// never import a vendor SDK, so switching providers later means editing this one file.
// Custom events go to Umami Cloud (Vercel Hobby doesn't collect them); Vercel Analytics still
// records page views (see main.tsx). No personal data: only these event names and coarse props.

type EventName = 'price_checked' | 'share_clicked'
type Props = Record<string, string | number>

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Props) => unknown }
  }
}

/**
 * Fire-and-forget. A no-op when the Umami script is blocked (ad blockers), still loading,
 * disabled for this domain (localhost, preview deploys), or missing, and it never throws:
 * analytics must not be able to break a price check.
 */
export function track(name: EventName, props?: Props): void {
  try {
    globalThis.window?.umami?.track(name, props)
  } catch {
    // A broken or blocked tracker is not the user's problem.
  }
}
