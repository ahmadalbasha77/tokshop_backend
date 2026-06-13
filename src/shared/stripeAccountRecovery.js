const isStripeIdempotencyMismatch = (error) =>
  error?.type === "StripeIdempotencyError" ||
  String(error?.raw?.message || error?.message || "").includes(
    "Keys for idempotent requests can only be used with the same parameters"
  );

const selectRecoverableStripeAccount = (
  accounts,
  { userId, email, country, linkedAccountIds = new Set() }
) => {
  const normalizedUserId = String(userId);
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedCountry = String(country || "").trim().toUpperCase();
  const unlinkedCandidates = accounts.filter((account) => {
    if (linkedAccountIds.has(account.id)) return false;
    const metadataMatch =
      account?.metadata?.tokshop_user_id === normalizedUserId;
    const legacyMatch =
      normalizedEmail &&
      account?.type === "custom" &&
      account?.business_type === "individual" &&
      String(account?.email || "").trim().toLowerCase() === normalizedEmail &&
      (!normalizedCountry ||
        String(account?.country || "").trim().toUpperCase() === normalizedCountry);
    return metadataMatch || legacyMatch;
  });

  const metadataCandidates = unlinkedCandidates.filter(
    (account) => account?.metadata?.tokshop_user_id === normalizedUserId
  );
  if (metadataCandidates.length === 1) return metadataCandidates[0];
  if (metadataCandidates.length > 1) return null;
  return unlinkedCandidates.length === 1 ? unlinkedCandidates[0] : null;
};

module.exports = {
  isStripeIdempotencyMismatch,
  selectRecoverableStripeAccount,
};
