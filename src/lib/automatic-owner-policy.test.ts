import assert from "node:assert/strict";
import { test } from "node:test";
import { isAutomaticOwnerLaptop } from "./automatic-owner-policy";

test("automatic laptop policy matches an exact hostname suffix with DNS and fallback names", () => {
  for (const device of [
    { systemName: " SHRI-123-LT ", netbiosName: null, dnsName: null },
    { systemName: "shri-123-lt.sevenhills.org", netbiosName: null, dnsName: null },
    { systemName: null, netbiosName: "SHRI-123-LT", dnsName: null },
    { systemName: " ", netbiosName: null, dnsName: "SHRI-123-LT.sevenhills.org" },
  ]) assert.equal(isAutomaticOwnerLaptop(device), true);
});

test("automatic laptop policy uses the primary hostname and ignores other suffixes and display names", () => {
  for (const device of [
    { systemName: "SHRI-123-TC", netbiosName: "SHRI-123-LT", dnsName: null },
    { systemName: "SHRI-123-LT-old", netbiosName: null, dnsName: null },
    { systemName: "SHRI-123-LT550", netbiosName: null, dnsName: null },
    { systemName: null, netbiosName: null, dnsName: null, displayName: "SHRI-123-LT" },
  ]) assert.equal(isAutomaticOwnerLaptop(device), false);
});
