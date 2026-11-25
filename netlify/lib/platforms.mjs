// Which ad platforms a client runs: 'google', 'meta' or 'both'.
// Set in Clients and goals ("Ad platforms"). Older clients without the setting are worked out from their IDs.
const dig = (s) => String(s || '').replace(/\D/g, '');
export function platformsOf(c) {
  const p = c && c.platforms;
  if (p === 'google' || p === 'meta' || p === 'both') return p;
  if (!c) return 'google';
  return dig(c.customer_id) ? (c.meta_ad_account ? 'both' : 'google') : (c.meta_ad_account ? 'meta' : 'google');
}
export const usesGoogle = (c) => platformsOf(c) !== 'meta';
export const usesMeta = (c) => platformsOf(c) !== 'google' && !!(c && c.meta_ad_account);
export const metaOnly = (c) => platformsOf(c) === 'meta';
// a client the reports, team page, Creative Hub and daily refresh can load
export const reportable = (c) => !!(c && c.token && !c.disabled && (metaOnly(c) ? dig(c.meta_ad_account) : dig(c.customer_id)));
// the id used to file saved reports
export const accountKey = (c) => (metaOnly(c) ? 'meta' + dig(c.meta_ad_account) : dig(c.customer_id));
export const metaAdsLink = (c) => 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=' + dig(c.meta_ad_account);
