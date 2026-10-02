import { Identity, Store } from './models';

/**
 * A non-admin who has exactly one shop has nothing to choose between, so the
 * shop list is only an operator's console to them — full of agent and version
 * vocabulary — standing between them and the one page they came for. Such a
 * viewer is sent straight to their shop, and the shop page drops its
 * "← All shops" link: otherwise that link would send them to a list that
 * redirects straight back (plan.md §809).
 *
 * Admins always keep the list; they manage it. Until both facts are known this
 * is false, so nothing redirects on a half-loaded page, and a failed request
 * never redirects either (an empty list is not "one shop").
 */
export function isSoleShopViewer(identity: Identity | null, stores: Store[] | null): boolean {
  return !!identity && !identity.isAdmin && stores !== null && stores.length === 1;
}
