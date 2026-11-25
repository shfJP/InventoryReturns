type ComputerNames = {
  systemName: string | null;
  netbiosName: string | null;
  dnsName: string | null;
};

export function isAutomaticOwnerLaptop(device: ComputerNames): boolean {
  // Use the computer hostname, not a freely editable display/asset title.
  const hostname = [device.systemName, device.netbiosName, device.dnsName]
    .find((name) => name?.trim())?.trim().split(".")[0] ?? "";
  return hostname.toLowerCase().endsWith("-lt");
}
