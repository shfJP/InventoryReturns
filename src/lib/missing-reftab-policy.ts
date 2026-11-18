export const HOUSE_NINJA_LOGIN = "7HILLS\\house";
export const HOUSE_REFTAB_EMAIL = "ithelp@sevenhills.org";

type MissingAssetOwner = {
  ninjaOwnerRaw: string | null;
  ninjaOwner: {
    employeeId: string;
    displayName: string;
    email: string;
    isActive: boolean;
  } | null;
};

export function isHouseNinjaLogin(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === HOUSE_NINJA_LOGIN.toLowerCase();
}

export function missingReftabRecipient(row: MissingAssetOwner) {
  if (isHouseNinjaLogin(row.ninjaOwnerRaw)) {
    return { email: HOUSE_REFTAB_EMAIL, displayName: "IT Help", employeeId: null };
  }
  const owner = row.ninjaOwner;
  return owner?.isActive
    ? { email: owner.email, displayName: owner.displayName, employeeId: owner.employeeId }
    : null;
}
