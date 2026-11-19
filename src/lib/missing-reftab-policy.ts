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

export function houseReftabOwner<T extends { employeeId: string; displayName: string; email: string; upn: string | null; isActive: boolean }>(users: T[]) {
  const user = users.find((user) => user.isActive && [user.email, user.upn].some((email) =>
    email?.trim().toLowerCase() === HOUSE_REFTAB_EMAIL,
  ));
  return user ? { ...user, email: HOUSE_REFTAB_EMAIL } : {
    employeeId: HOUSE_REFTAB_EMAIL, displayName: "IT Help", email: HOUSE_REFTAB_EMAIL, upn: null, isActive: true,
  };
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
