import assert from "node:assert/strict";
import { test } from "node:test";
import { HOUSE_REFTAB_EMAIL, houseReftabOwner, isHouseNinjaLogin, missingReftabRecipient } from "./missing-reftab-policy";

test("House ownership keeps the designated email when the directory matches by UPN", () => {
  const user = { employeeId: "IT123", displayName: "IT Help", email: "alias@sevenhills.org", upn: HOUSE_REFTAB_EMAIL, isActive: true };
  assert.equal(houseReftabOwner([user]).email, HOUSE_REFTAB_EMAIL);
  assert.equal(houseReftabOwner([user]).employeeId, user.employeeId);
});

test("only the exact house domain login maps to IT Help, ignoring case and surrounding whitespace", () => {
  for (const login of ["7HILLS\\house", " 7hills\\HOUSE "]) {
    assert.equal(isHouseNinjaLogin(login), true);
    assert.deepEqual(missingReftabRecipient({ ninjaOwnerRaw: login, ninjaOwner: null }), {
      email: HOUSE_REFTAB_EMAIL, displayName: "IT Help", employeeId: null,
    });
  }
  for (const login of [null, undefined, "", "house", ".\\house", "OTHER\\house", "7HILLS\\house2", "7HILLS\\house.admin", "house@sevenhills.org"]) {
    assert.equal(isHouseNinjaLogin(login), false, String(login));
  }
});

test("the house mapping overrides any directory alias for the shared login", () => {
  assert.equal(missingReftabRecipient({
    ninjaOwnerRaw: "7HILLS\\house",
    ninjaOwner: { employeeId: "house", displayName: "House", email: "house@sevenhills.org", isActive: true },
  })?.email, HOUSE_REFTAB_EMAIL);
});

test("other logins retain the active owner requirement and existing recipient", () => {
  const owner = { employeeId: "123", displayName: "Employee", email: "employee@sevenhills.org", isActive: true };
  assert.deepEqual(missingReftabRecipient({ ninjaOwnerRaw: "7HILLS\\employee", ninjaOwner: owner }), {
    email: owner.email, displayName: owner.displayName, employeeId: owner.employeeId,
  });
  assert.equal(missingReftabRecipient({ ninjaOwnerRaw: "OTHER\\house", ninjaOwner: null }), null);
  assert.equal(missingReftabRecipient({ ninjaOwnerRaw: "7HILLS\\employee", ninjaOwner: { ...owner, isActive: false } }), null);
});
