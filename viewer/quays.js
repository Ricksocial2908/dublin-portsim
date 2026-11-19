// Dublin Port quays are conventional STS / straddle yards (like Barcelona 24B / APM),
// not the automated BEST stacking terminal at 36A. Keep the original 24B/36A IDs so
// a Barcelona fixture still renders if loaded.
export const APM_LIKE = new Set(["24B", "50N", "MTL", "51", "32", "OB"]);
export const isAPM = (quay) => APM_LIKE.has(quay);
